// public/app.js
// FastLane Client: Explicit state machine, Web Audio API VAD interruption handling,
// structured order state tracking, and monotonic stage timings.

document.addEventListener('DOMContentLoaded', () => {
  // ─── Top View Switcher Elements ───
  const btnViewUser = document.getElementById('btn-view-user');
  const btnViewInsights = document.getElementById('btn-view-insights');
  const viewUser = document.getElementById('view-user');
  const viewInsights = document.getElementById('view-insights');
  const userViewHeaderText = document.getElementById('user-view-header-text');
  const insightsViewHeaderText = document.getElementById('insights-view-header-text');

  // ─── User View Specific Elements ───
  const modeBadgeUser = document.getElementById('mode-badge-user');
  const modeBadgeUserText = document.getElementById('mode-badge-user-text');
  const interruptIndicatorUser = document.getElementById('interrupt-indicator-user');
  const pttButtonUser = document.getElementById('ptt-button-user');
  const pttUserLabel = document.getElementById('ptt-user-label');
  const rippleOuter = document.getElementById('ripple-outer');
  const rippleMiddle = document.getElementById('ripple-middle');
  const userTranscriptUser = document.getElementById('user-transcript-user');
  const botTranscriptUser = document.getElementById('bot-transcript-user');
  const userTimeUser = document.getElementById('user-time-user');
  const botTimeUser = document.getElementById('bot-time-user');
  const soundwaveUser = document.getElementById('soundwave-user');
  const orderItemsListUser = document.getElementById('order-items-list-user');
  const manualInputUser = document.getElementById('manual-input-user');
  const sendTextBtnUser = document.getElementById('send-text-btn-user');

  // ─── DOM Elements (Insights View) ───
  const modeBadge = document.getElementById('mode-badge');
  const modeBadgeText = document.getElementById('mode-badge-text');
  const interruptIndicator = document.getElementById('interrupt-indicator');
  const btnModeStreamed = document.getElementById('btn-mode-streamed');
  const btnModeNaive = document.getElementById('btn-mode-naive');

  const pttButton = document.getElementById('ptt-button');
  const pttLabel = document.getElementById('ptt-label');
  const quickChips = document.querySelectorAll('.quick-chip');
  const manualInput = document.getElementById('manual-input');
  const sendTextBtn = document.getElementById('send-text-btn');

  // Conversational Cards & Order
  const userTranscript = document.getElementById('user-transcript');
  const botTranscript = document.getElementById('bot-transcript');
  const userTime = document.getElementById('user-time');
  const botTime = document.getElementById('bot-time');
  const soundwave = document.getElementById('soundwave');
  const streamIndicator = document.getElementById('stream-indicator');
  const statLatency = document.getElementById('stat-latency');
  const statVoice = document.getElementById('stat-voice');
  const statModel = document.getElementById('stat-model');

  // Structured Order State Elements
  const orderItemsList = document.getElementById('order-items-list');
  const orderConfirmedBadge = document.getElementById('order-confirmed-badge');

  // Donut Ring Gauge & Hero Timer
  const liveTimer = document.getElementById('live-timer');
  const donutMeter = document.getElementById('donut-meter');
  const timerStatusChip = document.getElementById('timer-status-chip');
  const speedCalloutPill = document.getElementById('speed-callout-pill');

  // Graphical 5-Node Timeline Flow
  const breakdownModeBadge = document.getElementById('breakdown-mode-badge');
  const flowStepRelease = document.getElementById('flow-step-release');
  const valRelease = document.getElementById('val-release');
  const flowConn1 = document.getElementById('flow-conn-1');
  const flowStepStt = document.getElementById('flow-step-stt');
  const valStt = document.getElementById('val-stt');
  const flowConn2 = document.getElementById('flow-conn-2');
  const flowStepGemini = document.getElementById('flow-step-gemini');
  const nameGemini = document.getElementById('name-gemini');
  const valGemini = document.getElementById('val-gemini');
  const flowConn3 = document.getElementById('flow-conn-3');
  const flowStepRime = document.getElementById('flow-step-rime');
  const valRime = document.getElementById('val-rime');
  const flowConn4 = document.getElementById('flow-conn-4');
  const flowStepTotal = document.getElementById('flow-step-total');
  const valTotal = document.getElementById('val-total');
  const advantageText = document.getElementById('advantage-text');

  // Performance Comparison & Dev Controls
  const streamedBarFill = document.getElementById('streamed-bar-fill');
  const streamedBarValue = document.getElementById('streamed-bar-value');
  const naiveBarFill = document.getElementById('naive-bar-fill');
  const naiveBarValue = document.getElementById('naive-bar-value');
  const fasterBadge = document.getElementById('faster-badge');
  const forceFallbackBtn = document.getElementById('force-fallback-btn');
  const simulateInterruptBtn = document.getElementById('simulate-interrupt-btn');

  // Recent Trials Table
  const trialsTableBody = document.getElementById('trials-table-body');
  const historyCount = document.getElementById('history-count');

  // ─── Explicit Pipeline State Machine ───
  const PipelineState = {
    IDLE: 'idle',
    RECORDING: 'recording',
    PROCESSING_STT: 'processing_stt',
    WAITING_FOR_GEMINI: 'waiting_for_gemini',
    GEMINI_FIRST_TEXT_RECEIVED: 'gemini_first_text_received',
    RIME_GENERATING: 'rime_generating',
    FIRST_AUDIO: 'first_audio',
    COMPLETE: 'complete'
  };

  let currentState = PipelineState.IDLE;
  let currentMode = 'streamed'; // 'streamed' | 'naive'
  let forceFallbackNext = false;
  let isRecording = false;
  let recognition = null;
  let recordedTranscript = '';

  // ─── Turn Tracking & Invalidation ───
  let activeTurnId = 0;
  let turnCounter = 0;

  // ─── Structured Order State (Prerequisite Object) ───
  let structuredOrderState = {
    items: [],
    confirmed: false
  };

  // ─── High-Resolution Monotonic Timestamps (measured via performance.now relative to user release) ───
  let tUserRelease = null;      // Point zero (when user releases mic or triggers order)
  let tSttDone = null;          // When speech-to-text transcript is finalized
  let tGeminiFirstText = null;  // When first meaningful text chunk is received (or full reply in Naive)
  let tRimeFirstAudio = null;   // When first synthesized audio chunk is received from Rime
  let tFirstAudioPlay = null;   // When browser physically begins audible sound playback

  let timerInterval = null;
  let audioQueue = [];
  let isPlayingAudio = false;
  let currentAudio = null;

  const DONUT_CIRCUMFERENCE = 427; // 2 * PI * 68
  let latestStreamedLatency = null;
  let latestNaiveLatency = null;

  // ─── Web Audio API Voice Activity Detection (VAD) for Real Interruptions ───
  let audioContext = null;
  let micStream = null;
  let analyserNode = null;
  let vadInterval = null;
  let sustainedSpeechCount = 0;
  let audioPlaybackStartTime = 0;
  let isListeningForCorrection = false;
  let correctionSilenceTimer = null;
  let correctionMaxTimer = null;
  let wasBotPlayingWhenRecorded = false;
  let wasInterrupted = false;
  const SPEECH_ENERGY_THRESHOLD = 0.08; // Voice energy threshold calibrated to ignore speaker feedback
  const REQUIRED_SUSTAINED_TICKS = 6;   // 6 ticks @ 30ms = ~180ms sustained intentional speech

  // Real trial history persisted in localStorage, initialized empty
  let trialHistory = [];
  try {
    const saved = localStorage.getItem('fastlane_trials_v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        trialHistory = parsed;
      }
    }
  } catch (e) {
    console.warn('[FastLane] Failed to read saved trial history:', e);
    trialHistory = [];
  }

  function formatTimeNow() {
    const d = new Date();
    let hours = d.getHours();
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${ampm}`;
  }

  // ─── Render Structured Order State ───
  function renderOrderState(state) {
    structuredOrderState = state || { items: [], confirmed: false };
    const html = (!structuredOrderState.items || structuredOrderState.items.length === 0)
      ? '<span class="empty-state-hint">(no items confirmed yet)</span>'
      : structuredOrderState.items.map(item => `
        <span class="order-item-chip">
          <span>✓</span> ${item}
        </span>
      `).join('');

    if (orderItemsList) orderItemsList.innerHTML = html;
    if (orderItemsListUser) orderItemsListUser.innerHTML = html;

    if (orderConfirmedBadge) {
      if (structuredOrderState.confirmed) {
        orderConfirmedBadge.className = 'confirmed-badge confirmed';
        orderConfirmedBadge.textContent = 'confirmed';
      } else {
        orderConfirmedBadge.className = 'confirmed-badge unconfirmed';
        orderConfirmedBadge.textContent = 'in progress';
      }
    }
  }

  // ─── 1. Fetch Live Verified Voice Info ───
  async function fetchVoiceInfo() {
    try {
      const res = await fetch('/api/voice-info');
      if (res.ok) {
        const info = await res.json();
        if (statVoice) statVoice.textContent = info.speaker || 'astra';
        if (statModel) statModel.textContent = info.modelId || 'coda';
        const footerVoice = document.getElementById('footer-voice');
        const footerModel = document.getElementById('footer-model');
        if (footerVoice) footerVoice.textContent = info.speaker || 'astra';
        if (footerModel) footerModel.textContent = info.modelId || 'coda';
        console.log('[FastLane] Verified live Rime voice metadata:', info);
      }
    } catch (e) {
      console.warn('[FastLane] Could not fetch voice info:', e);
    }
  }
  fetchVoiceInfo();

  // ─── 2. Single-Select Mode Toggle ───
  function setMode(mode) {
    currentMode = mode;

    if (mode === 'streamed') {
      btnModeStreamed.classList.add('active');
      btnModeStreamed.setAttribute('aria-pressed', 'true');
      btnModeNaive.classList.remove('active');
      btnModeNaive.setAttribute('aria-pressed', 'false');

      if (modeBadge) modeBadge.className = 'pill-badge fast';
      if (modeBadgeText) modeBadgeText.textContent = '⚡ Streamed';
      if (modeBadgeUser) {
        modeBadgeUser.className = 'pill-badge fast';
        if (modeBadgeUserText) modeBadgeUserText.textContent = '● Streamed';
      }

      if (breakdownModeBadge) {
        breakdownModeBadge.className = 'breakdown-badge';
        breakdownModeBadge.textContent = '⚡ Streamed Mode';
      }
      if (nameGemini) {
        nameGemini.innerHTML = 'Gemini first<br>response';
      }
      if (advantageText) {
        advantageText.innerHTML = '<strong>Streamed Advantage:</strong> Synthesizes sentence-by-sentence in parallel with Gemini text generation, eliminating the wait for the full response.';
      }
      if (speedCalloutPill) {
        speedCalloutPill.className = 'speed-callout-pill';
        speedCalloutPill.textContent = '⚡ Super fast response!';
      }
    } else {
      btnModeNaive.classList.add('active');
      btnModeNaive.setAttribute('aria-pressed', 'true');
      btnModeStreamed.classList.remove('active');
      btnModeStreamed.setAttribute('aria-pressed', 'false');

      if (modeBadge) modeBadge.className = 'pill-badge standard';
      if (modeBadgeText) modeBadgeText.textContent = '🐢 Naive';
      if (modeBadgeUser) {
        modeBadgeUser.className = 'pill-badge standard';
        if (modeBadgeUserText) modeBadgeUserText.textContent = '● Naive';
      }

      if (breakdownModeBadge) {
        breakdownModeBadge.className = 'breakdown-badge standard';
        breakdownModeBadge.textContent = '🐢 Naive Mode';
      }
      if (nameGemini) {
        nameGemini.innerHTML = 'Gemini full<br>reply';
      }
      if (advantageText) {
        advantageText.innerHTML = '<strong>Naive Pipeline:</strong> Blocks on full Gemini text completion before starting Rime TTS synthesis, resulting in higher latency.';
      }
      if (speedCalloutPill) {
        speedCalloutPill.className = 'speed-callout-pill slow';
        speedCalloutPill.textContent = '🐢 Standard response';
      }
    }

    if (currentState === PipelineState.IDLE) {
      resetTimingStages();
    }

    console.log(`[FastLane Mode] Active pipeline set to: ${currentMode}`);
  }

  btnModeStreamed.addEventListener('click', () => setMode('streamed'));
  btnModeNaive.addEventListener('click', () => setMode('naive'));

  forceFallbackBtn.addEventListener('click', () => {
    forceFallbackNext = true;
    forceFallbackBtn.style.background = 'rgba(239, 68, 68, 0.4)';
    forceFallbackBtn.innerHTML = '⚠️ Force Fallback Armed [Next turn]';
    setTimeout(() => {
      runTurn("I'll have a large pepperoni pizza and a coke", true);
    }, 400);
  });

  // ─── 3. Web Audio API VAD (Continuous Voice Activity Detection During Playback) ───
  async function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }
    if (!micStream) {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });
        const source = audioContext.createMediaStreamSource(micStream);
        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = 512;
        source.connect(analyserNode);
        console.log('[FastLane VAD] Microphone stream & AnalyserNode ready for interruption monitoring');
      } catch (err) {
        console.warn('[FastLane VAD] Microphone access not granted for VAD:', err.message);
      }
    }
  }

  function startVadMonitoring() {
    if (vadInterval) clearInterval(vadInterval);
    sustainedSpeechCount = 0;

    // Display "Listening for interruption..." indicator while audio is playing
    if (interruptIndicator) {
      interruptIndicator.classList.remove('hidden');
    }

    initAudioContext().then(() => {
      if (!analyserNode) return;

      const bufferLength = analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      vadInterval = setInterval(() => {
        if (!isPlayingAudio) {
          stopVadMonitoring();
          return;
        }

        // Grace period: ignore first 600ms of audio playback so speaker transients / initial playback won't trigger self-interruption
        if (Date.now() - audioPlaybackStartTime < 600) {
          sustainedSpeechCount = 0;
          return;
        }

        analyserNode.getByteTimeDomainData(dataArray);

        // Compute RMS audio energy
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          const norm = (dataArray[i] - 128) / 128;
          sum += norm * norm;
        }
        const rms = Math.sqrt(sum / bufferLength);

        if (rms > SPEECH_ENERGY_THRESHOLD) {
          sustainedSpeechCount++;
          if (sustainedSpeechCount >= REQUIRED_SUSTAINED_TICKS) {
            console.log(`[FastLane VAD] Interruption detected! (rms: ${rms.toFixed(3)}, ticks: ${sustainedSpeechCount})`);
            triggerInterruption({ simulated: false });
          }
        } else {
          sustainedSpeechCount = Math.max(0, sustainedSpeechCount - 1);
        }
      }, 30);
    });
  }

  function stopVadMonitoring() {
    if (vadInterval) {
      clearInterval(vadInterval);
      vadInterval = null;
    }
    sustainedSpeechCount = 0;
    if (interruptIndicator) {
      interruptIndicator.classList.add('hidden');
    }
  }

  // ─── 4. Interruption Trigger & Recovery Handler ───
  function triggerInterruption({ simulated = false, correction = null }) {
    console.log(`[FastLane Interruption] Handling interrupt (simulated: ${simulated})...`);

    // Step 2a: Immediately stop/mute the currently playing Rime audio
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
    isPlayingAudio = false;
    stopVadMonitoring();
    if (soundwave) soundwave.style.display = 'none';

    // Step 2b: Cancel all remaining queued/not-yet-played sentence chunks
    audioQueue = [];

    // Step 2c: Invalidate the previous LLM generation turn so incoming chunks are discarded
    activeTurnId = ++turnCounter;
    wasInterrupted = true;

    // Update UI to show the cut-off state cleanly
    if (botTranscript && !botTranscript.textContent.includes('[Interrupted]')) {
      botTranscript.textContent = (botTranscript.textContent.replace(/ \.\.\.$/, '') + ' — [Interrupted]').trim();
    }
    timerStatusChip.className = 'status-chip measuring';
    timerStatusChip.textContent = 'Interrupted';

    // Step 2d: Switch into capturing the user's new speech
    if (simulated) {
      const correctionText = correction || "Just give me the Margherita";
      userTranscript.textContent = correctionText;
      userTranscript.classList.remove('placeholder');
      if (userTime) userTime.textContent = formatTimeNow();

      setTimeout(() => {
        runTurn(correctionText, true, true);
      }, 450);
    } else {
      // Live hands-free speech capture on interruption
      startInterruptionSpeechCapture();
    }
  }

  function startInterruptionSpeechCapture() {
    clearTimeout(correctionSilenceTimer);
    clearTimeout(correctionMaxTimer);

    isListeningForCorrection = true;
    recordedTranscript = '';

    pttLabel.textContent = 'Listening to your correction... (Hold button or speak)';
    pttButton.classList.add('recording');
    userTranscript.textContent = 'Listening to your correction...';
    userTranscript.classList.add('placeholder');

    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      setTimeout(() => {
        if (!isListeningForCorrection) return;
        try {
          recognition.start();
        } catch (err) {
          console.warn('[FastLane Speech] Interruption recognition start error:', err.message);
        }
      }, 50);
    }

    // Safety timeout: if after 6.5s no words are transcribed, do NOT send a fake order!
    correctionMaxTimer = setTimeout(() => {
      if (!isListeningForCorrection) return;
      finalizeInterruptionCapture();
    }, 6500);
  }

  function finalizeInterruptionCapture() {
    if (!isListeningForCorrection) return;
    isListeningForCorrection = false;
    clearTimeout(correctionSilenceTimer);
    clearTimeout(correctionMaxTimer);

    pttButton.classList.remove('recording');
    pttLabel.textContent = 'Hold to talk';

    if (recognition) {
      try { recognition.stop(); } catch (_) {}
    }

    const correctionText = recordedTranscript.trim();
    wasInterrupted = false;

    if (correctionText) {
      userTranscript.textContent = correctionText;
      userTranscript.classList.remove('placeholder');
      if (userTime) userTime.textContent = formatTimeNow();
      runTurn(correctionText, false, true);
    } else {
      // Real speech wasn't transcribed: do NOT inject a fake order!
      userTranscript.textContent = "Didn't catch that.";
      userTranscript.classList.remove('placeholder');
      botTranscript.textContent = "I stopped for you — hold the button or type below to tell me what to change.";
      botTranscript.classList.remove('placeholder');
      timerStatusChip.className = 'status-chip ready';
      timerStatusChip.textContent = 'Ready';
    }
  }

  // Dev button: "Simulate interruption now"
  simulateInterruptBtn.addEventListener('click', () => {
    simulateInterruptBtn.style.borderColor = 'var(--primary)';
    simulateInterruptBtn.style.background = 'rgba(13, 148, 136, 0.2)';

    setTimeout(() => {
      simulateInterruptBtn.style.borderColor = '';
      simulateInterruptBtn.style.background = '';
    }, 600);

    if (isPlayingAudio || currentState === PipelineState.FIRST_AUDIO || currentState === PipelineState.RIME_GENERATING) {
      // Audio is actively playing or ready -> interrupt it right now!
      triggerInterruption({
        simulated: true,
        correction: "Just give me the Margherita"
      });
    } else {
      // Idle demo: kick off initial order "I want a large pizza", and interrupt it mid-speech!
      console.log('[FastLane Demo] Starting turn 1 for interruption simulation...');
      runTurn("I want a large pizza", true, false);

      // Trigger the interruption 1.5s in, exactly when bot starts speaking
      const checkAudioInterval = setInterval(() => {
        if (isPlayingAudio) {
          clearInterval(checkAudioInterval);
          setTimeout(() => {
            triggerInterruption({
              simulated: true,
              correction: "Just give me the Margherita"
            });
          }, 400);
        }
      }, 50);

      // Safety timeout in case audio takes longer
      setTimeout(() => {
        clearInterval(checkAudioInterval);
        if (isPlayingAudio) {
          triggerInterruption({
            simulated: true,
            correction: "Just give me the Margherita"
          });
        }
      }, 4000);
    }
  });

  // ─── 5. State Machine Transitions ───
  function transitionState(newState, payload = {}) {
    console.log(`[FastLane State] ${currentState} → ${newState}`, payload);
    currentState = newState;

    switch (newState) {
      case PipelineState.IDLE:
        timerStatusChip.className = 'status-chip ready';
        timerStatusChip.textContent = 'Ready';
        if (soundwave) soundwave.style.display = 'none';
        stopVadMonitoring();
        break;

      case PipelineState.RECORDING:
        resetTimingVariables();
        resetTimingStages();

        pttButton.classList.add('recording');
        pttLabel.textContent = 'Listening... Release to order';
        timerStatusChip.className = 'status-chip measuring';
        timerStatusChip.textContent = 'Listening';

        userTranscript.textContent = 'Listening to your voice...';
        userTranscript.classList.add('placeholder');
        botTranscript.textContent = 'Awaiting your order...';
        botTranscript.classList.add('placeholder');
        streamIndicator.classList.add('hidden');
        if (soundwave) soundwave.style.display = 'none';
        stopVadMonitoring();
        break;

      case PipelineState.PROCESSING_STT:
        tUserRelease = performance.now();
        valRelease.textContent = '0.00s ✓';
        flowStepRelease.className = 'flow-step completed';
        flowConn1.className = 'flow-connector active';

        flowStepStt.className = 'flow-step active';
        valStt.textContent = 'processing...';

        startLiveStopwatch();
        break;

      case PipelineState.WAITING_FOR_GEMINI:
        tSttDone = performance.now();
        const sttSec = payload.isDirectInput ? '0.00s' : `${Math.max(0, (tSttDone - tUserRelease) / 1000).toFixed(2)}s`;
        valStt.textContent = `${sttSec} ✓`;
        flowStepStt.className = 'flow-step completed';
        flowConn2.className = 'flow-connector active';

        flowStepGemini.className = 'flow-step active';
        valGemini.textContent = 'generating...';
        break;

      case PipelineState.GEMINI_FIRST_TEXT_RECEIVED:
        if (!tGeminiFirstText && tUserRelease) {
          tGeminiFirstText = performance.now();
          const geminiElapsedSec = Math.max(0, (tGeminiFirstText - tUserRelease) / 1000).toFixed(2);
          valGemini.textContent = `${geminiElapsedSec}s ✓`;
          flowStepGemini.className = 'flow-step completed';
          flowConn3.className = 'flow-connector active';
          console.log(`[FastLane Timing] Gemini milestone completed at ${geminiElapsedSec}s`);
        }
        transitionState(PipelineState.RIME_GENERATING);
        break;

      case PipelineState.RIME_GENERATING:
        if (!tRimeFirstAudio) {
          flowStepRime.className = 'flow-step active';
          valRime.textContent = 'synthesizing...';
        }
        break;

      case PipelineState.FIRST_AUDIO:
        if (payload.rimeAudioReceived && !tRimeFirstAudio && tUserRelease) {
          tRimeFirstAudio = performance.now();
          const rimeElapsedSec = Math.max(0, (tRimeFirstAudio - tUserRelease) / 1000).toFixed(2);
          valRime.textContent = `${rimeElapsedSec}s ✓`;
          flowStepRime.className = 'flow-step completed';
          flowConn4.className = 'flow-connector active';
          console.log(`[FastLane Timing] Rime first audio at ${rimeElapsedSec}s`);
        }

        if (payload.audioStartedPlaying && !tFirstAudioPlay && tUserRelease) {
          tFirstAudioPlay = performance.now();
          const totalFirstAudioSec = Math.max(0, (tFirstAudioPlay - tUserRelease) / 1000).toFixed(2);

          freezeLiveStopwatch(parseFloat(totalFirstAudioSec));

          valTotal.textContent = `${totalFirstAudioSec}s`;
          flowStepTotal.className = 'flow-step final completed';
          if (soundwave) soundwave.style.display = 'inline-flex';
          console.log(`[FastLane Timing] TIME TO FIRST AUDIO: ${totalFirstAudioSec}s`);

          if (currentMode === 'streamed') {
            latestStreamedLatency = parseFloat(totalFirstAudioSec);
          } else {
            latestNaiveLatency = parseFloat(totalFirstAudioSec);
          }

          // If a trial was recorded with server-arrival time before audible playback started, update it to physical playback latency
          if (trialHistory.length > 0 && trialHistory[0].pendingPhysicalPlayback) {
            const actualLatencyMs = Math.round(tFirstAudioPlay - tUserRelease);
            trialHistory[0].latencyMs = actualLatencyMs;
            trialHistory[0].sec = `${(actualLatencyMs / 1000).toFixed(2)}s`;
            delete trialHistory[0].pendingPhysicalPlayback;
            saveTrials();
            renderHistory();
          }

          recomputeComparisonMetrics();
        }
        break;

      case PipelineState.COMPLETE:
        streamIndicator.classList.add('hidden');
        if (soundwave) soundwave.style.display = 'none';
        stopVadMonitoring();
        break;
    }
  }

  // ─── 6. Timing Resets & Donut Stopwatch ───
  function resetTimingVariables() {
    tUserRelease = null;
    tSttDone = null;
    tGeminiFirstText = null;
    tRimeFirstAudio = null;
    tFirstAudioPlay = null;
  }

  function resetTimingStages() {
    flowStepRelease.className = 'flow-step completed';
    valRelease.textContent = '0.00s ✓';

    flowConn1.className = 'flow-connector active';
    flowStepStt.className = 'flow-step';
    valStt.textContent = '—';

    flowConn2.className = 'flow-connector';
    flowStepGemini.className = 'flow-step';
    valGemini.textContent = '—';

    flowConn3.className = 'flow-connector';
    flowStepRime.className = 'flow-step';
    valRime.textContent = '—';

    flowConn4.className = 'flow-connector';
    flowStepTotal.className = 'flow-step final';
    valTotal.textContent = '—';
  }

  function startLiveStopwatch() {
    if (timerInterval) clearInterval(timerInterval);
    timerStatusChip.className = 'status-chip measuring';
    timerStatusChip.textContent = 'Measuring';
    liveTimer.innerHTML = '0.00<span class="donut-unit">s</span>';
    if (donutMeter) donutMeter.style.strokeDashoffset = '427';

    timerInterval = setInterval(() => {
      if (!tUserRelease) return;
      const elapsedSec = Math.max(0, (performance.now() - tUserRelease) / 1000);
      liveTimer.innerHTML = `${elapsedSec.toFixed(2)}<span class="donut-unit">s</span>`;

      if (donutMeter) {
        const offset = Math.max(0, DONUT_CIRCUMFERENCE - (elapsedSec / 2.5) * DONUT_CIRCUMFERENCE);
        donutMeter.style.strokeDashoffset = offset.toFixed(1);
      }
    }, 25);
  }

  function freezeLiveStopwatch(totalSec) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    const secStr = totalSec.toFixed(2);
    liveTimer.innerHTML = `${secStr}<span class="donut-unit">s</span>`;
    timerStatusChip.className = 'status-chip frozen';
    timerStatusChip.textContent = 'Audible';
    statLatency.textContent = `${secStr}s`;

    if (donutMeter) {
      const fillRatio = Math.min(1, totalSec / 2.5);
      const offset = Math.max(0, DONUT_CIRCUMFERENCE - fillRatio * DONUT_CIRCUMFERENCE);
      donutMeter.style.strokeDashoffset = offset.toFixed(1);
    }

    if (speedCalloutPill) {
      if (currentMode === 'streamed') {
        speedCalloutPill.className = 'speed-callout-pill';
        speedCalloutPill.textContent = '⚡ Super fast response!';
      } else {
        speedCalloutPill.className = 'speed-callout-pill slow';
        speedCalloutPill.textContent = '🐢 Standard response';
      }
    }
  }

  // ─── 7. Web Speech API (Push-To-Talk) ───
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      recordedTranscript = (final || interim).trim();
      if (recordedTranscript) {
        userTranscript.textContent = recordedTranscript;
        userTranscript.classList.remove('placeholder');

        // If in hands-free interruption capture mode, reset silence timeout to 1.3 seconds after speech
        if (isListeningForCorrection) {
          clearTimeout(correctionSilenceTimer);
          correctionSilenceTimer = setTimeout(() => {
            finalizeInterruptionCapture();
          }, 1300);
        }
      }
    };

    recognition.onerror = (err) => {
      console.warn('[FastLane] Speech recognition error:', err.error);
    };
  }

  function startRecording() {
    if (isRecording) return;
    wasBotPlayingWhenRecorded = isPlayingAudio || (soundwave && soundwave.style.display !== 'none') || wasInterrupted;
    if (isListeningForCorrection) {
      clearTimeout(correctionSilenceTimer);
      clearTimeout(correctionMaxTimer);
      isListeningForCorrection = false;
    }
    isRecording = true;
    recordedTranscript = '';
    stopAudioPlayback();

    transitionState(PipelineState.RECORDING);

    if (recognition) {
      try { recognition.abort(); } catch (_) {}
      setTimeout(() => {
        try {
          recognition.start();
        } catch (e) {
          console.warn('Recognition start error:', e);
        }
      }, 30);
    }
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    pttButton.classList.remove('recording');
    pttLabel.textContent = 'Hold to talk';

    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        console.warn('[FastLane Speech] stop error:', e);
      }
    }

    transitionState(PipelineState.PROCESSING_STT);

    const isInterruptionTurn = wasBotPlayingWhenRecorded || wasInterrupted;
    wasBotPlayingWhenRecorded = false;
    wasInterrupted = false;

    setTimeout(() => {
      const orderText = recordedTranscript.trim();
      if (!orderText) {
        if (isInterruptionTurn) {
          userTranscript.textContent = "Didn't catch that.";
          userTranscript.classList.remove('placeholder');
          botTranscript.textContent = "I'm listening — please hold to talk or type your correction below.";
          botTranscript.classList.remove('placeholder');
          timerStatusChip.className = 'status-chip ready';
          timerStatusChip.textContent = 'Ready';
          return;
        } else {
          runTurn("I'll have a large pepperoni pizza and a coke.", false, false);
          return;
        }
      }

      userTranscript.textContent = orderText;
      userTranscript.classList.remove('placeholder');
      if (userTime) userTime.textContent = formatTimeNow();

      runTurn(orderText, false, isInterruptionTurn);
    }, 200);
  }

  // Pointer & Touch Events with pointer capture to guarantee release detection
  function attachPttEvents(btn) {
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (_) {}
      startRecording();
    });

    btn.addEventListener('pointerup', (e) => {
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch (_) {}
      if (isRecording) stopRecording();
    });

    btn.addEventListener('pointercancel', () => {
      if (isRecording) stopRecording();
    });
  }

  attachPttEvents(pttButton);
  attachPttEvents(pttButtonUser);

  window.addEventListener('pointerup', () => {
    if (isRecording) stopRecording();
  });
  window.addEventListener('mouseup', () => {
    if (isRecording) stopRecording();
  });
  window.addEventListener('touchend', () => {
    if (isRecording) stopRecording();
  });

  // ─── 8. Quick Chips & Manual Input (Both Views) ───
  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const order = chip.getAttribute('data-order');
      runTurn(order, true, false);
    });
  });

  function handleSendText(inputEl) {
    if (!inputEl) return;
    const text = inputEl.value.trim();
    if (!text) return;
    if (manualInput) manualInput.value = '';
    if (manualInputUser) manualInputUser.value = '';
    const isInterruptionTurn = wasInterrupted || isPlayingAudio;
    wasInterrupted = false;
    runTurn(text, true, isInterruptionTurn);
  }

  if (sendTextBtn) {
    sendTextBtn.addEventListener('click', () => handleSendText(manualInput));
  }
  if (manualInput) {
    manualInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSendText(manualInput);
    });
  }

  if (sendTextBtnUser) {
    sendTextBtnUser.addEventListener('click', () => handleSendText(manualInputUser));
  }
  if (manualInputUser) {
    manualInputUser.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSendText(manualInputUser);
    });
  }

  // ─── 9. View Switcher Logic (User View vs Insights View) ───
  function switchView(target) {
    if (target === 'user') {
      if (btnViewUser) {
        btnViewUser.classList.add('active');
        btnViewUser.setAttribute('aria-selected', 'true');
      }
      if (btnViewInsights) {
        btnViewInsights.classList.remove('active');
        btnViewInsights.setAttribute('aria-selected', 'false');
      }
      if (viewUser) viewUser.classList.remove('hidden');
      if (viewInsights) viewInsights.classList.add('hidden');
      if (userViewHeaderText) userViewHeaderText.classList.remove('hidden');
      if (insightsViewHeaderText) insightsViewHeaderText.classList.add('hidden');
    } else {
      if (btnViewInsights) {
        btnViewInsights.classList.add('active');
        btnViewInsights.setAttribute('aria-selected', 'true');
      }
      if (btnViewUser) {
        btnViewUser.classList.remove('active');
        btnViewUser.setAttribute('aria-selected', 'false');
      }
      if (viewInsights) viewInsights.classList.remove('hidden');
      if (viewUser) viewUser.classList.add('hidden');
      if (insightsViewHeaderText) insightsViewHeaderText.classList.remove('hidden');
      if (userViewHeaderText) userViewHeaderText.classList.add('hidden');
    }
  }

  if (btnViewUser) btnViewUser.addEventListener('click', () => switchView('user'));
  if (btnViewInsights) btnViewInsights.addEventListener('click', () => switchView('insights'));

  // ─── 10. Live Cross-View Synchronization Observers ───
  // Keep User View and Insights View perfectly synchronized without modifying backend/pipeline logic
  if (userTranscript && userTranscriptUser) {
    const userObserver = new MutationObserver(() => {
      userTranscriptUser.textContent = userTranscript.textContent;
      if (userTranscript.classList.contains('placeholder')) {
        userTranscriptUser.classList.add('placeholder');
      } else {
        userTranscriptUser.classList.remove('placeholder');
      }
    });
    userObserver.observe(userTranscript, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  if (botTranscript && botTranscriptUser) {
    const botObserver = new MutationObserver(() => {
      botTranscriptUser.textContent = botTranscript.textContent;
      if (botTranscript.classList.contains('placeholder')) {
        botTranscriptUser.classList.add('placeholder');
      } else {
        botTranscriptUser.classList.remove('placeholder');
      }
    });
    botObserver.observe(botTranscript, { childList: true, characterData: true, subtree: true, attributes: true });
  }

  if (userTime && userTimeUser) {
    const userTimeObserver = new MutationObserver(() => {
      userTimeUser.textContent = userTime.textContent;
    });
    userTimeObserver.observe(userTime, { childList: true, characterData: true, subtree: true });
  }

  if (botTime && botTimeUser) {
    const botTimeObserver = new MutationObserver(() => {
      botTimeUser.textContent = botTime.textContent;
    });
    botTimeObserver.observe(botTime, { childList: true, characterData: true, subtree: true });
  }

  if (soundwave && soundwaveUser) {
    const soundwaveObserver = new MutationObserver(() => {
      soundwaveUser.style.display = soundwave.style.display;
    });
    soundwaveObserver.observe(soundwave, { attributes: true, attributeFilter: ['style'] });
  }

  if (interruptIndicator && interruptIndicatorUser) {
    const interruptObserver = new MutationObserver(() => {
      if (interruptIndicator.classList.contains('hidden')) {
        interruptIndicatorUser.classList.add('hidden');
      } else {
        interruptIndicatorUser.classList.remove('hidden');
      }
    });
    interruptObserver.observe(interruptIndicator, { attributes: true, attributeFilter: ['class'] });
  }

  if (pttButton && pttButtonUser) {
    const pttObserver = new MutationObserver(() => {
      if (pttButton.classList.contains('recording')) {
        pttButtonUser.classList.add('recording');
        if (rippleOuter) rippleOuter.classList.add('recording');
        if (rippleMiddle) rippleMiddle.classList.add('recording');
        if (pttUserLabel) pttUserLabel.textContent = 'Listening... Release to order';
      } else {
        pttButtonUser.classList.remove('recording');
        if (rippleOuter) rippleOuter.classList.remove('recording');
        if (rippleMiddle) rippleMiddle.classList.remove('recording');
        if (pttUserLabel) pttUserLabel.textContent = 'Tap and hold to speak';
      }
    });
    pttObserver.observe(pttButton, { attributes: true, attributeFilter: ['class'] });
  }

  function runTurn(text, isDirectInput = false, isInterruption = false) {
    stopAudioPlayback();
    resetTimingVariables();
    resetTimingStages();

    userTranscript.textContent = text;
    userTranscript.classList.remove('placeholder');
    if (userTime) userTime.textContent = formatTimeNow();

    botTranscript.textContent = isInterruption ? 'Applying your correction...' : 'Processing order...';
    botTranscript.classList.add('placeholder');
    if (botTime) botTime.textContent = formatTimeNow();

    transitionState(PipelineState.PROCESSING_STT);

    if (isDirectInput) {
      transitionState(PipelineState.WAITING_FOR_GEMINI, { isDirectInput: true });
    } else {
      transitionState(PipelineState.WAITING_FOR_GEMINI, { isDirectInput: false });
    }

    runPipelineTurn({ text, isInterruption });
  }

  // ─── 9. Audio Playback Queue with Continuous VAD Interruption Listening ───
  function stopAudioPlayback() {
    audioQueue = [];
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    isPlayingAudio = false;
    stopVadMonitoring();
    if (soundwave) soundwave.style.display = 'none';
  }

  function enqueueAudio(item) {
    audioQueue.push(item);
    if (!isPlayingAudio) {
      playNextAudio();
    }
  }

  function playNextAudio() {
    if (audioQueue.length === 0) {
      isPlayingAudio = false;
      stopVadMonitoring();
      if (soundwave) soundwave.style.display = 'none';
      return;
    }

    isPlayingAudio = true;
    const item = audioQueue.shift();

    const audio = new Audio(`data:${item.format || 'audio/mpeg'};base64,${item.audioBase64}`);
    currentAudio = audio;

    audio.onplay = () => {
      audioPlaybackStartTime = Date.now();
      if (item.isFirst) {
        transitionState(PipelineState.FIRST_AUDIO, { audioStartedPlaying: true });
      }
      if (soundwave) soundwave.style.display = 'inline-flex';

      // Start monitoring microphone for interruptions with grace period
      startVadMonitoring();
    };

    audio.onended = () => {
      playNextAudio();
    };

    audio.onerror = (err) => {
      console.error('[FastLane] Audio playback error:', err);
      playNextAudio();
    };

    audio.play().catch(e => {
      console.warn('[FastLane] Audio autoplay prevented or delayed:', e);
      if (item.isFirst) {
        transitionState(PipelineState.FIRST_AUDIO, { audioStartedPlaying: true });
      }
      startVadMonitoring();
      playNextAudio();
    });
  }

  // ─── 10. Server SSE Pipeline Invocation ───
  async function runPipelineTurn({ text, isInterruption = false }) {
    const thisTurnId = ++turnCounter;
    activeTurnId = thisTurnId;

    const useForceFallback = forceFallbackNext;
    forceFallbackNext = false;
    forceFallbackBtn.style.background = '';
    forceFallbackBtn.innerHTML = '⚠️ Force fallback <span class="dev-label">[Demo]</span>';

    let fullReplyAccumulator = '';

    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          mode: currentMode,
          orderState: structuredOrderState,
          isInterruption,
          forceFallback: useForceFallback,
          t0: Date.now()
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // If turn was invalidated by an interruption while reading, discard immediately
        if (activeTurnId !== thisTurnId) {
          console.log(`[FastLane Pipeline] Discarding stale stream events for turn ${thisTurnId}`);
          try { reader.cancel(); } catch (_) {}
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evtBlock of events) {
          if (!evtBlock.trim()) continue;

          let eventName = 'message';
          let eventData = null;

          const lines = evtBlock.split('\n');
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.replace('event:', '').trim();
            } else if (line.startsWith('data:')) {
              try {
                eventData = JSON.parse(line.replace('data:', '').trim());
              } catch (e) {}
            }
          }

          if (activeTurnId === thisTurnId) {
            handlePipelineEvent(eventName, eventData);
          }
        }
      }

      function handlePipelineEvent(name, data) {
        if (!data || activeTurnId !== thisTurnId) return;

        if (name === 'fallback') {
          console.warn('[FastLane Client] Fallback event received:', data);
          setMode('naive');
        } else if (name === 'order_state') {
          renderOrderState(data);
        } else if (name === 'llm_token') {
          streamIndicator.classList.remove('hidden');
          fullReplyAccumulator += data.token;
          botTranscript.textContent = fullReplyAccumulator;
          botTranscript.classList.remove('placeholder');

          if (currentMode === 'streamed' && !tGeminiFirstText && data.token && data.token.trim()) {
            transitionState(PipelineState.GEMINI_FIRST_TEXT_RECEIVED);
          }
        } else if (name === 'sentence') {
          if (currentMode === 'streamed' && !tGeminiFirstText) {
            transitionState(PipelineState.GEMINI_FIRST_TEXT_RECEIVED);
          }
        } else if (name === 'llm_complete') {
          streamIndicator.classList.add('hidden');
          botTranscript.textContent = data.text;
          botTranscript.classList.remove('placeholder');

          if (data.orderState) {
            renderOrderState(data.orderState);
          }

          if (!tGeminiFirstText) {
            transitionState(PipelineState.GEMINI_FIRST_TEXT_RECEIVED);
          }
        } else if (name === 'audio') {
          if (data.isFirst) {
            if (!tGeminiFirstText) {
              transitionState(PipelineState.GEMINI_FIRST_TEXT_RECEIVED);
            }
            transitionState(PipelineState.FIRST_AUDIO, { rimeAudioReceived: true });
          }
          enqueueAudio(data);
        } else if (name === 'done') {
          transitionState(PipelineState.COMPLETE);
          if (data.orderState) {
            renderOrderState(data.orderState);
          }
          const finalLatency = tFirstAudioPlay && tUserRelease
            ? tFirstAudioPlay - tUserRelease
            : data.latencyMs;
          const isPending = !tFirstAudioPlay;
          recordTrial(data.mode, text, finalLatency, data.stageTimings, true, isPending);
        } else if (name === 'error') {
          console.error('[Pipeline Error Event]:', data.message);
          botTranscript.textContent = `Error: ${data.message}`;
          timerStatusChip.className = 'status-chip ready';
          timerStatusChip.textContent = 'Error';
        }
      }

    } catch (err) {
      if (activeTurnId === thisTurnId) {
        console.error('[FastLane Turn Error]:', err);
        botTranscript.textContent = `Connection error: ${err.message}`;
        if (timerInterval) clearInterval(timerInterval);
      }
    }
  }

  // ─── 11. Comparison Dashboard & Structured Trials Table ───
  function recomputeComparisonMetrics() {
    if (!streamedBarValue || !naiveBarValue) return;

    const validStreamed = trialHistory.filter(t => t.mode === 'streamed' && t.success && t.latencyMs > 0);
    const validNaive = trialHistory.filter(t => (t.mode === 'naive' || t.mode === 'standard') && t.success && t.latencyMs > 0);

    const hasStreamed = validStreamed.length > 0;
    const hasNaive = validNaive.length > 0;

    const streamedSec = hasStreamed
      ? (validStreamed.reduce((acc, t) => acc + t.latencyMs, 0) / validStreamed.length / 1000)
      : null;

    const naiveSec = hasNaive
      ? (validNaive.reduce((acc, t) => acc + t.latencyMs, 0) / validNaive.length / 1000)
      : null;

    streamedBarValue.textContent = streamedSec !== null ? `${streamedSec.toFixed(2)}s` : '—';
    naiveBarValue.textContent = naiveSec !== null ? `${naiveSec.toFixed(2)}s` : '—';

    if (hasStreamed && hasNaive) {
      const maxVal = Math.max(streamedSec, naiveSec, 0.1);
      const streamedWidth = Math.min(100, Math.max(14, Math.round((streamedSec / maxVal) * 100)));
      const naiveWidth = Math.min(100, Math.max(14, Math.round((naiveSec / maxVal) * 100)));

      if (streamedBarFill) streamedBarFill.style.width = `${streamedWidth}%`;
      if (naiveBarFill) naiveBarFill.style.width = `${naiveWidth}%`;

      if (fasterBadge) {
        if (naiveSec > streamedSec) {
          const absoluteImprovement = naiveSec - streamedSec;
          const percentageImprovement = Math.round((absoluteImprovement / naiveSec) * 100);
          fasterBadge.textContent = `⚡ Streamed responds ${absoluteImprovement.toFixed(2)}s faster · ${percentageImprovement}% faster`;
          fasterBadge.className = 'faster-badge faster-pill positive';
        } else if (streamedSec > naiveSec) {
          const delta = (streamedSec - naiveSec).toFixed(2);
          fasterBadge.textContent = `Naive was ${delta}s faster on recorded trials`;
          fasterBadge.className = 'faster-badge faster-pill neutral';
        } else {
          fasterBadge.textContent = `⚡ Streamed vs Naive equal on recorded trials`;
          fasterBadge.className = 'faster-badge faster-pill neutral';
        }
      }
    } else if (hasStreamed && !hasNaive) {
      if (streamedBarFill) streamedBarFill.style.width = '60%';
      if (naiveBarFill) naiveBarFill.style.width = '0%';
      if (fasterBadge) {
        fasterBadge.textContent = 'Run a Naive mode trial to compare performance.';
        fasterBadge.className = 'faster-badge faster-pill empty';
      }
    } else if (!hasStreamed && hasNaive) {
      if (streamedBarFill) streamedBarFill.style.width = '0%';
      if (naiveBarFill) naiveBarFill.style.width = '60%';
      if (fasterBadge) {
        fasterBadge.textContent = 'Run a Streamed mode trial to compare performance.';
        fasterBadge.className = 'faster-badge faster-pill empty';
      }
    } else {
      if (streamedBarFill) streamedBarFill.style.width = '0%';
      if (naiveBarFill) naiveBarFill.style.width = '0%';
      if (fasterBadge) {
        fasterBadge.textContent = 'Run more trials to compare performance.';
        fasterBadge.className = 'faster-badge faster-pill empty';
      }
    }
  }

  function saveTrials() {
    try {
      localStorage.setItem('fastlane_trials_v1', JSON.stringify(trialHistory));
    } catch (e) {
      console.warn('[FastLane] Failed to save trial history:', e);
    }
  }

  function recordTrial(mode, text, latencyMs, stageTimings = {}, success = true, pendingPhysical = false) {
    const sec = parseFloat((latencyMs / 1000).toFixed(2));
    const normalizedMode = mode === 'standard' ? 'naive' : mode;

    const newTrial = {
      id: 'trial_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      mode: normalizedMode,
      text: text || "Customer drive-thru order",
      latencyMs: Math.round(latencyMs),
      sec: `${sec.toFixed(2)}s`,
      timestamp: Date.now(),
      isoDate: new Date().toISOString(),
      stageTimings: {
        geminiMs: stageTimings?.geminiMs || null,
        rimeMs: stageTimings?.rimeMs || null
      },
      success: Boolean(success),
      pendingPhysicalPlayback: Boolean(pendingPhysical)
    };

    trialHistory.unshift(newTrial);
    if (trialHistory.length > 50) trialHistory.length = 50;

    saveTrials();
    renderHistory();
    recomputeComparisonMetrics();
    return newTrial;
  }

  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Just now';
    const elapsedSec = Math.floor((Date.now() - timestamp) / 1000);
    if (elapsedSec < 15) return 'Just now';
    if (elapsedSec < 60) return `${elapsedSec}s ago`;
    const elapsedMin = Math.floor(elapsedSec / 60);
    if (elapsedMin < 60) return `${elapsedMin}m ago`;
    const d = new Date(timestamp);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }

  function renderHistory() {
    if (!trialsTableBody) return;

    if (trialHistory.length === 0) {
      trialsTableBody.innerHTML = `
        <tr>
          <td colspan="4" class="empty-trials-cell" style="text-align: center; padding: 22px 12px; color: #94a3b8; font-size: 0.85rem;">
            No recorded trials yet. Push to talk or select a sample order to record your first trial.
          </td>
        </tr>
      `;
      if (historyCount) historyCount.textContent = '0 trials';
      return;
    }

    if (historyCount) {
      historyCount.textContent = `${trialHistory.length} trial${trialHistory.length === 1 ? '' : 's'}`;
    }

    const rows = trialHistory.slice(0, 10);
    trialsTableBody.innerHTML = rows.map(t => {
      const modeLabel = t.mode === 'streamed' ? 'Streamed' : 'Naive';
      const modeClass = t.mode === 'streamed' ? 'streamed' : 'naive';
      const timeStr = formatTimeAgo(t.timestamp);
      return `
        <tr>
          <td>
            <span class="trial-mode-dot ${modeClass}">
              <span class="dot-indicator"></span>
              ${modeLabel}
            </span>
          </td>
          <td class="trial-order-cell" title="${escapeHtml(t.text)}">
            ${escapeHtml(t.text)}
          </td>
          <td class="trial-time-cell">
            ${t.sec}
          </td>
          <td class="trial-date-cell">
            ${timeStr}
          </td>
        </tr>
      `;
    }).join('');
  }

  // Click on "X trials" to offer resetting trial history
  if (historyCount) {
    historyCount.style.cursor = 'pointer';
    historyCount.title = 'Click to clear recorded trial history';
    historyCount.addEventListener('click', () => {
      if (trialHistory.length === 0) return;
      if (window.confirm(`Clear all ${trialHistory.length} recorded trials?`)) {
        trialHistory = [];
        saveTrials();
        renderHistory();
        recomputeComparisonMetrics();
      }
    });
  }

  // Initial render with real data
  renderOrderState({ items: [], confirmed: false });
  renderHistory();
  recomputeComparisonMetrics();
  if (donutMeter) donutMeter.style.strokeDashoffset = '140';
  setMode('streamed');
  switchView('user');
});
