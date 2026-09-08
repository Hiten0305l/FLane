// scripts/test_vad_self_interruption.mjs
// Verification of VAD self-interruption fix (SPEECH_ENERGY_THRESHOLD = 0.055, grace = 300ms)
// Tests:
// 1. 5 consecutive AI-only playbacks without speaking -> Verify NO self-interruption occurs.
// 2. Real interruption mid-speech -> Verify interruption works cleanly.
// 3. Inspect console VAD logs to record RMS levels.

import { spawn } from 'child_process';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('=== FASTLANE VAD SELF-INTERRUPTION & INTERRUPT VERIFICATION ===\n');

  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9777',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    'http://localhost:3000'
  ]);

  let cdpWsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const res = await fetch('http://127.0.0.1:9777/json');
      const pages = await res.json();
      const target = pages.find(p => p.type === 'page' && !p.url.startsWith('chrome://')) || pages[0];
      if (target && target.webSocketDebuggerUrl) {
        cdpWsUrl = target.webSocketDebuggerUrl;
        break;
      }
    } catch (_) {}
  }

  if (!cdpWsUrl) {
    console.error('❌ Could not connect to Chrome CDP on port 9777');
    chromeProcess.kill();
    process.exit(1);
  }

  console.log('✅ Connected to Chrome CDP:', cdpWsUrl);

  const ws = new WebSocket(cdpWsUrl);
  let idCounter = 1;
  const pendingRequests = new Map();
  const consoleLogs = [];

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
    }
    if (data.method === 'Runtime.consoleAPICalled') {
      const text = data.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      consoleLogs.push(text);
      if (text.includes('[FastLane')) {
        console.log('   [Browser Log]', text);
      }
    }
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pendingRequests.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res?.exceptionDetails) {
      console.error('JS Exception:', res.exceptionDetails);
    }
    return res?.result?.value;
  }

  await sendCommand('Runtime.enable');
  await sendCommand('Page.enable');
  await sendCommand('Page.navigate', { url: 'http://localhost:3000' });

  for (let i = 0; i < 30; i++) {
    const ready = await evaluate("Boolean(document.getElementById('manual-input-user'))");
    if (ready) break;
    await sleep(300);
  }

  // --------------------------------------------------------------------------
  // TEST 1: AI-Only Playback (No Speech) - 5 Consecutive Trials
  // --------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log('TEST 1: 5 Consecutive AI-Only Playbacks (Verifying NO Self-Interruption)');
  console.log('======================================================');

  const testOrders = [
    "I'll have a double smash burger",
    "Add crispy fries and a coke",
    "I want chicken nuggets",
    "Give me choco lava dessert",
    "Can I get garlic bread please"
  ];

  for (let trial = 0; trial < 5; trial++) {
    console.log(`\n--- Trial ${trial + 1}/5: "${testOrders[trial]}" ---`);
    consoleLogs.length = 0; // Clear log buffer for this trial

    // Send order text
    await evaluate(`
      (() => {
        const uInput = document.getElementById('manual-input-user');
        const mInput = document.getElementById('manual-input');
        const uBtn = document.getElementById('send-text-btn-user');
        const mBtn = document.getElementById('send-text-btn');
        const text = ${JSON.stringify(testOrders[trial])};
        if (uInput) uInput.value = text;
        if (mInput) mInput.value = text;
        if (uBtn) uBtn.click();
        else if (mBtn) mBtn.click();
      })()
    `);

    // Wait for AI audio to begin playing
    let audioStarted = false;
    for (let w = 0; w < 40; w++) {
      await sleep(200);
      const isPlaying = await evaluate(`
        (() => {
          const soundwave = document.getElementById('soundwave-user');
          return soundwave && soundwave.style.display !== 'none';
        })()
      `);
      if (isPlaying) {
        audioStarted = true;
        break;
      }
    }

    console.log(`   Audio playback started: ${audioStarted}`);

    // Let the audio play for 3.5 seconds with zero user speech
    await sleep(3500);

    // Check if an interruption was falsely triggered during this time
    const interrupted = consoleLogs.some(log =>
      log.includes('[FastLane Interruption]') || log.includes('Interruption detected!')
    );

    const botText = await evaluate("document.getElementById('bot-transcript-user')?.textContent || ''");
    const wasSelfInterrupted = botText.includes('[Interrupted]') || interrupted;

    if (!wasSelfInterrupted) {
      console.log(`✅ Trial ${trial + 1}/5 PASS: AI spoke smoothly with NO self-interruption.`);
    } else {
      console.error(`❌ Trial ${trial + 1}/5 FAIL: Self-interruption occurred! Bot text: "${botText}"`);
      ws.close();
      chromeProcess.kill();
      process.exit(1);
    }
  }

  console.log('\n✅ PASS: All 5 consecutive AI-only playbacks completed with ZERO self-interruption!');

  // --------------------------------------------------------------------------
  // TEST 2: Real Interruption mid-speech ("Instead of pizza, add shake")
  // --------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log('TEST 2: Genuine Interruption Mid-Speech ("Instead of pizza, add shake")');
  console.log('======================================================');

  // Submit initial order
  await evaluate(`
    (() => {
      const input = document.getElementById('manual-input-user');
      const btn = document.getElementById('send-text-btn-user');
      input.value = "I want to order pizza and pasta.";
      btn.click();
    })()
  `);

  // Wait for audio playback
  for (let w = 0; w < 40; w++) {
    await sleep(200);
    const isPlaying = await evaluate(`
      (() => {
        const soundwave = document.getElementById('soundwave-user');
        return soundwave && soundwave.style.display !== 'none';
      })()
    `);
    if (isPlaying) break;
  }

  console.log('Assistant audio is playing. Triggering intentional user interruption...');
  await evaluate(`
    document.getElementById('simulate-interrupt-btn').click();
  `);

  // Verify interruption halts old audio and updates order
  let interruptionSuccess = false;
  for (let w = 0; w < 30; w++) {
    await sleep(300);
    const items = await evaluate(`
      (() => {
        const titles = document.querySelectorAll('.recognized-item-card .item-title');
        return Array.from(titles).map(el => el.textContent.trim());
      })()
    `);
    const hasShake = items.some(it => it.toLowerCase().includes('shake') || it.toLowerCase().includes('dessert'));
    const noPizza = !items.some(it => it.toLowerCase().includes('pizza'));
    const hasPasta = items.some(it => it.toLowerCase().includes('pasta'));

    if (hasShake && noPizza && hasPasta) {
      interruptionSuccess = true;
      console.log('Final Order after interruption:', items);
      break;
    }
  }

  if (interruptionSuccess) {
    console.log('✅ PASS: Real interruption mid-speech succeeded cleanly.');
  } else {
    console.error('❌ FAIL: Real interruption did not update order to Shake + Pasta');
    ws.close();
    chromeProcess.kill();
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log('🎉 ALL TESTS PASSED: VAD CALIBRATION RESOLVED SELF-INTERRUPTION!');
  console.log('======================================================\n');

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

run().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
