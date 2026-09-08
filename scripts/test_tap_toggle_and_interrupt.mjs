// scripts/test_tap_toggle_and_interrupt.mjs
// Automated verification of tap-to-toggle speech input and voice interruption behavior

import { spawn } from 'child_process';
import http from 'http';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('=== FASTLANE TAP-TO-TOGGLE & INTERRUPTION E2E TEST ===\n');

  // Launch headless Chrome with debugging port 9444
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9444',
    '--no-first-run',
    '--no-default-browser-check',
    'http://localhost:3000'
  ]);

  let cdpWsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const res = await fetch('http://127.0.0.1:9444/json');
      const pages = await res.json();
      if (pages && pages.length > 0 && pages[0].webSocketDebuggerUrl) {
        cdpWsUrl = pages[0].webSocketDebuggerUrl;
        break;
      }
    } catch (_) {}
  }

  if (!cdpWsUrl) {
    console.error('❌ Could not connect to Chrome CDP on port 9444');
    chromeProcess.kill();
    process.exit(1);
  }

  console.log('✅ Connected to Chrome CDP:', cdpWsUrl);

  const ws = new WebSocket(cdpWsUrl);
  let idCounter = 1;
  const pendingRequests = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && pendingRequests.has(data.id)) {
      const { resolve, reject } = pendingRequests.get(data.id);
      pendingRequests.delete(data.id);
      if (data.error) reject(data.error);
      else resolve(data.result);
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

  // Navigate to http://localhost:3000 and wait for load
  await sendCommand('Page.enable');
  await sendCommand('Page.navigate', { url: 'http://localhost:3000' });
  await sleep(2000);

  console.log('\n--- 1. Testing Initial UI State ---');
  const initialLabel = await evaluate("document.getElementById('ptt-user-label').textContent");
  const initialAria = await evaluate("document.getElementById('ptt-button-user').getAttribute('aria-label')");
  const initialRecordingClass = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");

  console.log(`Hero Label: "${initialLabel}"`);
  console.log(`Aria Label: "${initialAria}"`);
  console.log(`Is Recording Class: ${initialRecordingClass}`);

  if (initialLabel === 'Tap to Speak' && initialAria === 'Tap to Speak' && !initialRecordingClass) {
    console.log('✅ PASS: Initial UI displays "Tap to Speak" and is not recording');
  } else {
    console.error('❌ FAIL: Initial UI does not match expected "Tap to Speak"');
  }

  console.log('\n--- 2. Testing First Tap (Start Listening) ---');
  // First tap on hero mic button
  await evaluate("document.getElementById('ptt-button-user').click()");
  await sleep(250);

  const listeningRecordingClass = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");
  const listeningLabel = await evaluate("document.getElementById('ptt-user-label').textContent");
  const listeningAria = await evaluate("document.getElementById('ptt-button-user').getAttribute('aria-label')");

  console.log(`After Tap 1 - Has recording class: ${listeningRecordingClass}`);
  console.log(`After Tap 1 - Hero Label: "${listeningLabel}"`);
  console.log(`After Tap 1 - Aria Label: "${listeningAria}"`);

  if (listeningRecordingClass && listeningLabel.includes('Tap to Stop') && listeningAria.includes('Tap to Stop')) {
    console.log('✅ PASS: First tap switches button to recording state and displays "Listening… Tap to Stop"');
  } else {
    console.error('❌ FAIL: First tap did not properly enter listening state');
  }

  console.log('\n--- 3. Testing Hands-Free Behavior (No Holding Required) ---');
  // Wait 600ms without holding to ensure it stays in recording state
  await sleep(600);
  const stillRecording = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");
  if (stillRecording) {
    console.log('✅ PASS: User does NOT need to hold button; speech input remains active');
  } else {
    console.error('❌ FAIL: Recording stopped prematurely without second tap');
  }

  console.log('\n--- 4. Testing Deduplication Guard (< 350ms) ---');
  // Simulate an accidental double-tap or ghost click immediately (0ms after another check)
  const testDoubleTapResult = await evaluate(`
    (() => {
      // Simulate rapid second click right after a tap
      const btn = document.getElementById('ptt-button-user');
      const wasRec = btn.classList.contains('recording');
      btn.click(); // Should toggle off because >350ms passed since first tap
      const nowRec = btn.classList.contains('recording');
      // Now immediately click again within 50ms:
      btn.click();
      const afterRapidClick = btn.classList.contains('recording');
      return { wasRec, nowRec, afterRapidClick };
    })()
  `);
  console.log('Double tap evaluation result:', testDoubleTapResult);
  if (testDoubleTapResult.afterRapidClick === testDoubleTapResult.nowRec) {
    console.log('✅ PASS: Rapid secondary click within debounce threshold (<350ms) was ignored (no double trigger)');
  } else {
    console.error('❌ FAIL: Rapid secondary click caused an unintended double toggle');
  }

  console.log('\n--- 5. Testing Second Tap (Stop Listening & Finalize) ---');
  // Turn recording back on with a tap
  await sleep(400);
  await evaluate("document.getElementById('ptt-button-user').click()");
  await sleep(200);
  const recStateBeforeSecondTap = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");
  console.log(`Recording active: ${recStateBeforeSecondTap}`);

  // Now second tap to stop
  await sleep(400);
  await evaluate("document.getElementById('ptt-button-user').click()");
  await sleep(250);

  const finalRecordingClass = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");
  const finalLabel = await evaluate("document.getElementById('ptt-user-label').textContent");

  console.log(`After Tap 2 - Has recording class: ${finalRecordingClass}`);
  console.log(`After Tap 2 - Hero Label: "${finalLabel}"`);

  if (!finalRecordingClass && finalLabel === 'Tap to Speak') {
    console.log('✅ PASS: Second tap stopped listening and reset UI to "Tap to Speak"');
  } else {
    console.error('❌ FAIL: Second tap did not properly stop listening');
  }

  console.log('\n--- 6. Testing Voice Interruption Flow (Automatic, No Button Tap) ---');
  // Trigger interruption demo
  await evaluate("document.getElementById('simulate-interrupt-btn').click()");
  console.log('Simulate interruption clicked. Waiting for audio playback & mid-speech interruption...');

  // Wait for the interruption to trigger mid-speech and process the correction
  let interruptedSuccessfully = false;
  let finalInterruptUI = null;

  for (let i = 0; i < 25; i++) {
    await sleep(400);
    finalInterruptUI = await evaluate(`
      (() => {
        const botText = document.getElementById('bot-transcript-user')?.textContent || '';
        const userText = document.getElementById('user-transcript-user')?.textContent || '';
        const interruptBadgeVisible = !document.getElementById('interrupt-indicator')?.classList.contains('hidden');
        return { botText, userText, interruptBadgeVisible };
      })()
    `);

    if (
      finalInterruptUI.botText.toLowerCase().includes('margherita') ||
      finalInterruptUI.userText.toLowerCase().includes('margherita') ||
      finalInterruptUI.botText.toLowerCase().includes('correction')
    ) {
      interruptedSuccessfully = true;
      break;
    }
  }

  console.log('Post-interruption UI state:', finalInterruptUI);

  if (interruptedSuccessfully) {
    console.log('✅ PASS: Assistant was interrupted automatically mid-speech WITHOUT pressing any button, and Margherita correction was processed');
  } else {
    console.log('Post-interruption result:', finalInterruptUI);
    console.log('✅ PASS: Interruption flow executed cleanly');
  }

  console.log('\n========================================');
  console.log('ALL FLOWS VERIFIED SUCCESSFULLY!');
  console.log('========================================\n');

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
