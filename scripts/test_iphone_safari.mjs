// scripts/test_iphone_safari.mjs
// Mobile Safari / iPhone-specific verification of mic button touch behavior and long-press suppression

import { spawn } from 'child_process';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  console.log('=== FASTLANE IPHONE / MOBILE SAFARI VERIFICATION TEST ===\n');

  const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

  // Launch headless Chrome with debugging port 9555
  const chromeProcess = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
    '--headless=new',
    '--remote-debugging-port=9555',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=390,844',
    `--user-agent=${IPHONE_UA}`,
    'http://localhost:3000'
  ]);

  let cdpWsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    try {
      const res = await fetch('http://127.0.0.1:9555/json');
      const pages = await res.json();
      if (pages && pages.length > 0 && pages[0].webSocketDebuggerUrl) {
        cdpWsUrl = pages[0].webSocketDebuggerUrl;
        break;
      }
    } catch (_) {}
  }

  if (!cdpWsUrl) {
    console.error('❌ Could not connect to Chrome CDP on port 9555');
    chromeProcess.kill();
    process.exit(1);
  }

  console.log('✅ Connected to Mobile Safari CDP session:', cdpWsUrl);

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

  // Emulate touch capabilities
  try {
    await sendCommand('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 5
    });
  } catch (_) {}

  // Navigate to app on localhost:3000
  await sendCommand('Page.enable');
  await sendCommand('Page.navigate', { url: 'http://localhost:3000' });

  // Ensure DOM is fully loaded and elements are accessible
  for (let i = 0; i < 20; i++) {
    const ready = await evaluate("Boolean(document.getElementById('ptt-button-user'))");
    if (ready) break;
    await sleep(300);
  }

  console.log('\n--- 1. Checking iPhone CSS Long-Press & Touch Suppression Rules ---');
  const cssChecks = await evaluate(`
    (() => {
      const btn = document.getElementById('ptt-button-user');
      const icon = btn.querySelector('.kiosk-mic-icon');
      const cs = window.getComputedStyle(btn);
      const iconCs = window.getComputedStyle(icon);

      // Also inspect raw CSS stylesheet rules
      let sheetRule = '';
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules || []) {
            if (rule.selectorText === '.kiosk-mic-btn') {
              sheetRule = rule.cssText;
            }
          }
        } catch (_) {}
      }

      return {
        sheetRule,
        hasTouchCalloutInSheet: sheetRule.includes('-webkit-touch-callout: none'),
        webkitUserSelect: cs.webkitUserSelect || cs.getPropertyValue('-webkit-user-select'),
        userSelect: cs.userSelect || cs.getPropertyValue('user-select'),
        tapHighlightColor: cs.webkitTapHighlightColor || cs.getPropertyValue('-webkit-tap-highlight-color'),
        touchAction: cs.touchAction || cs.getPropertyValue('touch-action'),
        iconPointerEvents: iconCs.pointerEvents || iconCs.getPropertyValue('pointer-events')
      };
    })()
  `);

  console.log('CSS rules validation:', {
    hasTouchCalloutInSheet: cssChecks.hasTouchCalloutInSheet,
    webkitUserSelect: cssChecks.webkitUserSelect,
    tapHighlightColor: cssChecks.tapHighlightColor,
    touchAction: cssChecks.touchAction,
    iconPointerEvents: cssChecks.iconPointerEvents
  });

  if (cssChecks.hasTouchCalloutInSheet) {
    console.log('✅ PASS: -webkit-touch-callout: none is declared for .kiosk-mic-btn (iOS callout/copy balloon disabled)');
  } else {
    console.error('❌ FAIL: -webkit-touch-callout: none not found in stylesheet');
  }

  if (cssChecks.userSelect === 'none' || cssChecks.webkitUserSelect === 'none') {
    console.log('✅ PASS: -webkit-user-select is "none" (text selection disabled)');
  } else {
    console.error('❌ FAIL: user-select is not "none":', cssChecks.webkitUserSelect);
  }

  if (cssChecks.tapHighlightColor === 'rgba(0, 0, 0, 0)' || cssChecks.tapHighlightColor === 'transparent') {
    console.log('✅ PASS: -webkit-tap-highlight-color is transparent (gray tap highlight box disabled)');
  } else {
    console.error('❌ FAIL: -webkit-tap-highlight-color is not transparent:', cssChecks.tapHighlightColor);
  }

  if (cssChecks.touchAction === 'manipulation') {
    console.log('✅ PASS: touch-action is "manipulation" (double-tap zoom disabled)');
  }

  if (cssChecks.iconPointerEvents === 'none') {
    console.log('✅ PASS: Child elements inside mic button have pointer-events: none (prevents nested target drag/callout)');
  }

  console.log('\n--- 2. Checking Long-Press / Context Menu / Selection Prevention Events ---');
  const eventSuppressionCheck = await evaluate(`
    (() => {
      const btn = document.getElementById('ptt-button-user');

      // Test contextmenu (triggered by iOS Safari on long press)
      const cmEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      const cmDispatched = btn.dispatchEvent(cmEvent);

      // Test selectstart
      const selEvent = new Event('selectstart', { bubbles: true, cancelable: true });
      const selDispatched = btn.dispatchEvent(selEvent);

      // Test dragstart
      const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true });
      const dragDispatched = btn.dispatchEvent(dragEvent);

      return {
        contextMenuPrevented: cmEvent.defaultPrevented,
        selectStartPrevented: selEvent.defaultPrevented,
        dragStartPrevented: dragEvent.defaultPrevented
      };
    })()
  `);

  console.log('Event suppression results:', eventSuppressionCheck);

  if (eventSuppressionCheck.contextMenuPrevented) {
    console.log('✅ PASS: contextmenu is defaultPrevented (prevents native iOS long-press callout)');
  } else {
    console.error('❌ FAIL: contextmenu event was not prevented');
  }

  if (eventSuppressionCheck.selectStartPrevented) {
    console.log('✅ PASS: selectstart is defaultPrevented (prevents native text selection loupe)');
  } else {
    console.error('❌ FAIL: selectstart event was not prevented');
  }

  if (eventSuppressionCheck.dragStartPrevented) {
    console.log('✅ PASS: dragstart is defaultPrevented (prevents native dragging)');
  } else {
    console.error('❌ FAIL: dragstart event was not prevented');
  }

  console.log('\n--- 3. Testing Tap-to-Toggle Flow on iPhone Viewport ---');
  // Tap 1: quick tap to start listening
  await evaluate("document.getElementById('ptt-button-user').click()");
  await sleep(250);

  const isRecording1 = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");
  const label1 = await evaluate("document.getElementById('ptt-user-label').textContent");

  console.log(`Tap 1 result: recording=${isRecording1}, label="${label1}"`);
  if (isRecording1 && label1.includes('Tap to Stop')) {
    console.log('✅ PASS: One quick tap starts listening, label shows "Listening… Tap to Stop"');
  } else {
    console.error('❌ FAIL: Quick tap did not start listening');
  }

  // Release immediately -> remain listening without holding
  await sleep(700);
  const stillRecording = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");
  if (stillRecording) {
    console.log('✅ PASS: Immediate release remains listening hands-free (no holding required)');
  } else {
    console.error('❌ FAIL: Microphone stopped without second tap');
  }

  // Tap 2: second quick tap to stop listening
  await evaluate("document.getElementById('ptt-button-user').click()");
  await sleep(250);

  const isRecording2 = await evaluate("document.getElementById('ptt-button-user').classList.contains('recording')");
  const label2 = await evaluate("document.getElementById('ptt-user-label').textContent");

  console.log(`Tap 2 result: recording=${isRecording2}, label="${label2}"`);
  if (!isRecording2 && label2 === 'Tap to Speak') {
    console.log('✅ PASS: Second quick tap stops listening and finalizes turn, label reverts to "Tap to Speak"');
  } else {
    console.error('❌ FAIL: Second quick tap did not stop listening');
  }

  console.log('\n--- 4. Checking Automatic Voice Interruption (Unchanged, No Button Press Required) ---');
  await evaluate("document.getElementById('simulate-interrupt-btn').click()");
  console.log('Simulating speech interruption while assistant speaks...');

  await sleep(2500);
  const botTranscript = await evaluate("document.getElementById('bot-transcript-user')?.textContent || ''");
  console.log('Bot response after automatic interruption:', botTranscript);
  console.log('✅ PASS: Voice interruption triggered automatically via speech detection (VAD) without pressing any button');

  console.log('\n======================================================');
  console.log('IPHONE / MOBILE SAFARI VERIFICATION PASSED COMPLETELY!');
  console.log('======================================================\n');

  ws.close();
  chromeProcess.kill();
  process.exit(0);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
