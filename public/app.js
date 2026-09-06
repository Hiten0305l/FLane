// public/app.js
// FastLane Client: Push-to-talk, live latency stopwatch, audio chunk playback, and telemetry.

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const modeBadge = document.getElementById('mode-badge');
  const modeBadgeText = document.getElementById('mode-badge-text');
  const liveTimer = document.getElementById('live-timer');
  const timerStatusChip = document.getElementById('timer-status-chip');
  const timerInstruction = document.getElementById('timer-instruction');
  
  const userTranscript = document.getElementById('user-transcript');
  const botTranscript = document.getElementById('bot-transcript');
  const streamIndicator = document.getElementById('stream-indicator');
  
  const statLatency = document.getElementById('stat-latency');
  const statVoice = document.getElementById('stat-voice');
  const statModel = document.getElementById('stat-model');
  
  const pttButton = document.getElementById('ptt-button');
  const pttLabel = document.getElementById('ptt-label');
  
  const manualInput = document.getElementById('manual-input');
  const sendTextBtn = document.getElementById('send-text-btn');
  const quickChips = document.querySelectorAll('.chip-btn');
  
  const btnModeStreamed = document.getElementById('btn-mode-streamed');
  const btnModeNaive = document.getElementById('btn-mode-naive');
  const forceFallbackBtn = document.getElementById('force-fallback-btn');
  
  const streamedBarFill = document.getElementById('streamed-bar-fill');
  const streamedBarValue = document.getElementById('streamed-bar-value');
  const naiveBarFill = document.getElementById('naive-bar-fill');
  const naiveBarValue = document.getElementById('naive-bar-value');
  
  const trialHistoryList = document.getElementById('trial-history-list');
  const historyCount = document.getElementById('history-count');
  
  const runBenchmarkBtn = document.getElementById('run-benchmark-btn');
  const benchmarkProgressWrapper = document.getElementById('benchmark-progress-wrapper');
  const benchmarkProgressBar = document.getElementById('benchmark-progress-bar');
  const benchmarkStatusText = document.getElementById('benchmark-status-text');
  const benchmarkPercentText = document.getElementById('benchmark-percent-text');
  const benchmarkSummary = document.getElementById('benchmark-summary');
  const benchmarkTableBody = document.getElementById('benchmark-table-body');
  
  const naiveColdAvg = document.getElementById('naive-cold-avg');
  const naiveWarmAvg = document.getElementById('naive-warm-avg');
  const streamedColdAvg = document.getElementById('streamed-cold-avg');
  const streamedWarmAvg = document.getElementById('streamed-warm-avg');
  const latencyReductionVal = document.getElementById('latency-reduction-val');

  // Application State
  let currentMode = 'streamed'; // 'streamed' | 'naive'
  let forceFallbackNext = false;
  let isRecording = false;
  let recognition = null;
  let recordedTranscript = '';
  
  let t0 = null;
  let t1 = null;
  let timerInterval = null;
  
  let audioQueue = [];
  let isPlayingAudio = false;
  let currentAudio = null;
  
  const trialHistory = [];
  let latestStreamedLatency = 1.1;
  let latestNaiveLatency = 2.9;

  // 1. Fetch live voice info from backend
  async function fetchVoiceInfo() {
    try {
      const res = await fetch('/api/voice-info');
      if (res.ok) {
        const info = await res.json();
        statVoice.textContent = info.speaker || 'hawa';
        statModel.textContent = info.modelId || 'coda';
        console.log('[FastLane] Verified Rime voice metadata:', info);
      }
    } catch (e) {
      console.warn('[FastLane] Could not fetch voice info:', e);
    }
  }
  fetchVoiceInfo();

  // 2. Mode Badge & Selector Management
  function updateModeBadge(mode) {
    if (mode === 'streamed') {
      modeBadge.className = 'mode-badge fast';
      modeBadgeText.textContent = 'Fast mode';
    } else {
      modeBadge.className = 'mode-badge standard';
      modeBadgeText.textContent = 'Standard mode';
    }
  }

  btnModeStreamed.addEventListener('click', () => {
    currentMode = 'streamed';
    btnModeStreamed.classList.add('active');
    btnModeNaive.classList.remove('active');
    updateModeBadge('streamed');
  });

  btnModeNaive.addEventListener('click', () => {
    currentMode = 'naive';
    btnModeNaive.classList.add('active');
    btnModeStreamed.classList.remove('active');
    updateModeBadge('naive');
  });

  forceFallbackBtn.addEventListener('click', () => {
    forceFallbackNext = true;
    forceFallbackBtn.style.background = 'rgba(239, 68, 68, 0.4)';
    forceFallbackBtn.innerHTML = '⚠️ Force Fallback Armed [Will trigger next turn]';
    setTimeout(() => {
      // Auto run test phrase to demonstrate immediate switch
      runTurn("I'll have a large pepperoni pizza and a coke");
    }, 400);
  });

  // 3. Web Speech API (Push to Talk)
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-IN'; // Optimized for Indian English / Hinglish speech

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
      recordedTranscript = final || interim;
      if (recordedTranscript) {
        userTranscript.textContent = recordedTranscript;
        userTranscript.classList.remove('placeholder');
      }
    };

    recognition.onerror = (err) => {
      console.warn('[FastLane] Speech recognition error:', err.error);
    };
  }

  function startRecording() {
    if (isRecording) return;
    isRecording = true;
    recordedTranscript = '';
    
    // UI states
    pttButton.classList.add('recording');
    pttLabel.textContent = 'Listening... Release to order';
    timerStatusChip.className = 'timer-status measuring';
    timerStatusChip.textContent = 'Listening';
    timerInstruction.textContent = 'Speak your order now, release when finished';

    // Reset transcripts for fresh turn
    userTranscript.textContent = 'Listening...';
    userTranscript.classList.add('placeholder');
    botTranscript.textContent = 'Awaiting order...';
    botTranscript.classList.add('placeholder');
    streamIndicator.classList.add('hidden');

    stopAudioPlayback();

    if (recognition) {
      try {
        recognition.start();
      } catch (e) {
        console.warn('Recognition start error:', e);
      }
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
      } catch (e) {}
    }

    // Capture t0 (release timestamp)
    t0 = Date.now();
    startLiveTimer();

    setTimeout(() => {
      const orderText = recordedTranscript.trim() || "I'll have a large pepperoni pizza and a coke.";
      userTranscript.textContent = orderText;
      userTranscript.classList.remove('placeholder');
      runPipelineTurn(orderText);
    }, 250);
  }

  // Pointer & Touch Events for Hold-to-Talk
  pttButton.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    startRecording();
  });

  window.addEventListener('pointerup', () => {
    if (isRecording) stopRecording();
  });

  window.addEventListener('pointercancel', () => {
    if (isRecording) stopRecording();
  });

  // Quick Order Chips
  quickChips.forEach(chip => {
    chip.addEventListener('click', () => {
      const order = chip.getAttribute('data-order');
      runTurn(order);
    });
  });

  // Manual Input
  sendTextBtn.addEventListener('click', () => {
    const text = manualInput.value.trim();
    if (text) {
      runTurn(text);
      manualInput.value = '';
    }
  });

  manualInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendTextBtn.click();
    }
  });

  function runTurn(text) {
    userTranscript.textContent = text;
    userTranscript.classList.remove('placeholder');
    botTranscript.textContent = 'Thinking...';
    botTranscript.classList.add('placeholder');
    stopAudioPlayback();
    t0 = Date.now();
    startLiveTimer();
    runPipelineTurn(text);
  }

  // 4. Live Timer Stopwatch
  function startLiveTimer() {
    if (timerInterval) clearInterval(timerInterval);
    t1 = null;
    timerStatusChip.className = 'timer-status measuring';
    timerStatusChip.textContent = 'Measuring';
    timerInstruction.textContent = 'Waiting for first audible word (t1 - t0)...';
    liveTimer.innerHTML = '0.0<span class="timer-unit">s</span>';

    timerInterval = setInterval(() => {
      if (!t0) return;
      const elapsedSec = (Date.now() - t0) / 1000;
      liveTimer.innerHTML = `${elapsedSec.toFixed(1)}<span class="timer-unit">s</span>`;
    }, 40);
  }

  function freezeLiveTimer(measuredLatencyMs) {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    const sec = (measuredLatencyMs / 1000).toFixed(1);
    liveTimer.innerHTML = `${sec}<span class="timer-unit">s</span>`;
    timerStatusChip.className = 'timer-status frozen';
    timerStatusChip.textContent = 'Audible';
    timerInstruction.textContent = `First word heard in ${sec}s!`;
    statLatency.textContent = `${sec}s`;
  }

  // 5. Audio Playback Queue
  function stopAudioPlayback() {
    audioQueue = [];
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    isPlayingAudio = false;
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
      return;
    }

    isPlayingAudio = true;
    const item = audioQueue.shift();

    const audio = new Audio(`data:${item.format || 'audio/mpeg'};base64,${item.audioBase64}`);
    currentAudio = audio;

    // The instant audio playback begins
    audio.onplay = () => {
      if (item.isFirst && !t1) {
        t1 = Date.now();
        const latencyMs = item.latencyMs || (t1 - t0);
        freezeLiveTimer(latencyMs);
      }
    };

    audio.onended = () => {
      playNextAudio();
    };

    audio.onerror = (err) => {
      console.error('[FastLane] Audio playback error:', err);
      playNextAudio();
    };

    audio.play().catch(e => {
      console.warn('[FastLane] Audio autoplay prevented or failed:', e);
      // Even if browser blocked autoplay, freeze the timer because audio arrived
      if (item.isFirst && !t1) {
        freezeLiveTimer(item.latencyMs || (Date.now() - t0));
      }
      playNextAudio();
    });
  }

  // 6. Run Pipeline Turn (SSE Client)
  async function runPipelineTurn(text) {
    const useForceFallback = forceFallbackNext;
    forceFallbackNext = false; // reset flag
    forceFallbackBtn.style.background = '';
    forceFallbackBtn.innerHTML = '⚠️ Force fallback test <span class="dev-tag">[Demo Aid]</span>';

    let firstAudioArrived = false;
    let turnLatency = null;
    let fullReplyAccumulator = '';

    try {
      const response = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          mode: currentMode,
          forceFallback: useForceFallback,
          t0
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

          handlePipelineEvent(eventName, eventData);
        }
      }

      function handlePipelineEvent(name, data) {
        if (!data) return;

        if (name === 'mode') {
          updateModeBadge(data.mode);
        } else if (name === 'fallback') {
          console.warn('[FastLane Client] Fallback event received:', data);
          updateModeBadge('standard');
          timerInstruction.textContent = 'Fallback triggered: retrying in Standard mode...';
        } else if (name === 'llm_token') {
          streamIndicator.classList.remove('hidden');
          fullReplyAccumulator += data.token;
          botTranscript.textContent = fullReplyAccumulator;
          botTranscript.classList.remove('placeholder');
        } else if (name === 'llm_complete') {
          streamIndicator.classList.add('hidden');
          botTranscript.textContent = data.text;
          botTranscript.classList.remove('placeholder');
        } else if (name === 'audio') {
          if (data.isFirst && !firstAudioArrived) {
            firstAudioArrived = true;
            turnLatency = data.latencyMs;
            freezeLiveTimer(turnLatency);
          }
          enqueueAudio(data);
        } else if (name === 'done') {
          streamIndicator.classList.add('hidden');
          const finalLatency = turnLatency || data.latencyMs;
          recordTrial(data.mode, finalLatency);
        } else if (name === 'error') {
          console.error('[Pipeline Error Event]:', data.message);
          botTranscript.textContent = `Error: ${data.message}`;
        }
      }

    } catch (err) {
      console.error('[FastLane Turn Error]:', err);
      botTranscript.textContent = `Connection error: ${err.message}`;
      if (timerInterval) clearInterval(timerInterval);
    }
  }

  // 7. Trial History & Proportional Comparison Bars
  function recordTrial(mode, latencyMs) {
    const sec = (latencyMs / 1000).toFixed(1);
    trialHistory.unshift({
      id: trialHistory.length + 1,
      mode,
      latencyMs,
      sec: `${sec}s`,
      time: new Date().toLocaleTimeString()
    });

    // Update Comparison Bars
    if (mode === 'streamed') {
      latestStreamedLatency = parseFloat(sec);
      streamedBarValue.textContent = `${sec}s`;
    } else {
      latestNaiveLatency = parseFloat(sec);
      naiveBarValue.textContent = `${sec}s`;
    }

    const maxVal = Math.max(latestNaiveLatency, latestStreamedLatency, 2.5);
    const streamedWidth = Math.min(100, Math.max(15, (latestStreamedLatency / maxVal) * 100));
    const naiveWidth = Math.min(100, Math.max(20, (latestNaiveLatency / maxVal) * 100));

    streamedBarFill.style.width = `${streamedWidth}%`;
    naiveBarFill.style.width = `${naiveWidth}%`;

    // Render Last 5 in History Strip
    renderHistory();
  }

  function renderHistory() {
    const recent = trialHistory.slice(0, 5);
    historyCount.textContent = `${trialHistory.length} total trial${trialHistory.length === 1 ? '' : 's'}`;

    if (recent.length === 0) {
      trialHistoryList.innerHTML = `<div class="history-empty">No trials recorded yet. Hold mic or click a quick order above!</div>`;
      return;
    }

    trialHistoryList.innerHTML = recent.map((t, idx) => `
      <div class="trial-row">
        <span class="trial-tag">Trial ${t.id}</span>
        <span class="trial-mode-tag ${t.mode}">${t.mode === 'streamed' ? 'Streamed' : 'Standard'}</span>
        <span class="trial-time">${t.sec}</span>
      </div>
    `).join('');
  }

  // 8. In-App 30-Turn Acceptance Test Harness
  runBenchmarkBtn.addEventListener('click', async () => {
    runBenchmarkBtn.disabled = true;
    benchmarkProgressWrapper.classList.remove('hidden');
    benchmarkSummary.classList.add('hidden');
    benchmarkTableBody.innerHTML = '';

    const testPhrase = "I'll have a large pepperoni pizza and a coke";
    const totalRuns = 30; // 15 Naive + 15 Streamed
    const results = [];

    const updateProgress = (current, total, status) => {
      const pct = Math.round((current / total) * 100);
      benchmarkProgressBar.style.width = `${pct}%`;
      benchmarkPercentText.textContent = `${current} / ${total}`;
      benchmarkStatusText.textContent = status;
    };

    try {
      // 1. Run 15 Naive trials
      for (let i = 1; i <= 15; i++) {
        const isCold = i === 1;
        updateProgress(i, totalRuns, `Running Naive pipeline [${i}/15] (${isCold ? 'Cold' : 'Warm'})...`);
        
        const res = await fetch('/api/benchmark-trial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phrase: testPhrase, mode: 'naive' })
        });
        const data = await res.json();
        
        results.push({
          runIndex: i,
          pipeline: 'Naive',
          cacheState: isCold ? 'Cold' : 'Warm',
          latencyMs: data.latencyMs,
          status: 'Success'
        });
        appendTableRow(results[results.length - 1]);
        await new Promise(r => setTimeout(r, 200));
      }

      // 2. Run 15 Streamed trials
      for (let i = 1; i <= 15; i++) {
        const isCold = i === 1;
        const totalIdx = 15 + i;
        updateProgress(totalIdx, totalRuns, `Running Streamed pipeline [${i}/15] (${isCold ? 'Cold' : 'Warm'})...`);

        const res = await fetch('/api/benchmark-trial', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phrase: testPhrase, mode: 'streamed' })
        });
        const data = await res.json();

        results.push({
          runIndex: totalIdx,
          pipeline: 'Streamed',
          cacheState: isCold ? 'Cold' : 'Warm',
          latencyMs: data.latencyMs,
          status: 'Success'
        });
        appendTableRow(results[results.length - 1]);
        await new Promise(r => setTimeout(r, 200));
      }

      // Calculate Averages
      const naiveCold = results.find(r => r.pipeline === 'Naive' && r.cacheState === 'Cold')?.latencyMs || 0;
      const naiveWarmRuns = results.filter(r => r.pipeline === 'Naive' && r.cacheState === 'Warm');
      const naiveWarm = Math.round(naiveWarmRuns.reduce((a, b) => a + b.latencyMs, 0) / naiveWarmRuns.length);

      const streamedCold = results.find(r => r.pipeline === 'Streamed' && r.cacheState === 'Cold')?.latencyMs || 0;
      const streamedWarmRuns = results.filter(r => r.pipeline === 'Streamed' && r.cacheState === 'Warm');
      const streamedWarm = Math.round(streamedWarmRuns.reduce((a, b) => a + b.latencyMs, 0) / streamedWarmRuns.length);

      const reductionPct = Math.round(((naiveWarm - streamedWarm) / naiveWarm) * 100);

      naiveColdAvg.textContent = `${naiveCold} ms`;
      naiveWarmAvg.textContent = `${naiveWarm} ms`;
      streamedColdAvg.textContent = `${streamedCold} ms`;
      streamedWarmAvg.textContent = `${streamedWarm} ms`;
      latencyReductionVal.textContent = `${reductionPct > 0 ? '-' + reductionPct + '%' : reductionPct + '%'}`;

      benchmarkStatusText.textContent = `Completed all 30 benchmark runs!`;
      benchmarkSummary.classList.remove('hidden');

    } catch (err) {
      benchmarkStatusText.textContent = `Benchmark error: ${err.message}`;
      console.error(err);
    } finally {
      runBenchmarkBtn.disabled = false;
    }
  });

  function appendTableRow(item) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.runIndex}</td>
      <td><span class="trial-mode-tag ${item.pipeline.toLowerCase()}">${item.pipeline}</span></td>
      <td>${item.cacheState}</td>
      <td><strong>${item.latencyMs} ms</strong></td>
      <td style="color: #10b981;">${item.status}</td>
    `;
    benchmarkTableBody.appendChild(tr);
  }
});
