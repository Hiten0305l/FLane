// services/pipelineService.js
// Orchestrates the Naive vs Streamed audio pipelines with live sentence-level synthesis and fallback.

import { generateFullReply, streamReply } from './geminiService.js';
import { synthesizeAudio } from './rimeService.js';
import { SentenceParser } from './sentenceParser.js';
import { getVoiceInfo } from './voiceCatalog.js';

export async function runPipeline({
  text,
  mode = 'streamed',
  forceFallback = false,
  clientT0 = null,
  onEvent
}) {
  const t0 = clientT0 || Date.now();
  const voiceInfo = await getVoiceInfo();
  let activeMode = mode;

  // Let client know active mode initially
  onEvent('mode', { mode: activeMode, voice: voiceInfo.speaker, model: voiceInfo.modelId });

  if (activeMode === 'streamed') {
    return await executeStreamedPipeline({ text, voiceInfo, t0, forceFallback, onEvent });
  } else {
    return await executeNaivePipeline({ text, voiceInfo, t0, onEvent, fallbackTriggered: false });
  }
}

async function executeStreamedPipeline({ text, voiceInfo, t0, forceFallback, onEvent }) {
  let firstAudioSent = false;
  let t1 = null;
  let fullReplyText = '';

  // We use a failure signal to trigger fallback from inside sentence callbacks
  let streamFailureError = null;

  // Queue of per-sentence synthesis Promises (in order). We resolve them
  // sequentially so that a failure in sentence 1 surfaces immediately.
  const sentenceQueue = [];

  const parser = new SentenceParser((sentence, idx) => {
    const isFirst = idx === 1;
    const forceThisFail = forceFallback && isFirst;

    onEvent('sentence', { sentence, index: idx });

    // Push a deferred synthesis task for this sentence
    const synthTask = async () => {
      const audioBuffer = await synthesizeAudio({
        text: sentence,
        speaker: voiceInfo.speaker,
        modelId: voiceInfo.modelId,
        lang: voiceInfo.languageCode === 'eng' ? 'en' : voiceInfo.languageCode,
        timeoutMs: 5000,
        forceFail: forceThisFail
      });

      if (!firstAudioSent) {
        firstAudioSent = true;
        t1 = Date.now();
      }

      const latencyMs = t1 - t0;
      onEvent('audio', {
        sentence,
        sentenceIndex: idx,
        isFirst,
        latencyMs,
        audioBase64: audioBuffer.toString('base64'),
        format: 'audio/mpeg'
      });
    };

    sentenceQueue.push(synthTask);
  });

  // Stream LLM tokens into the parser
  try {
    fullReplyText = await streamReply(text, (token) => {
      onEvent('llm_token', { token });
      parser.addChunk(token);
    });
  } catch (err) {
    // LLM streaming failure — trigger full fallback
    streamFailureError = err;
  }

  if (!streamFailureError) {
    parser.flush();
    onEvent('llm_complete', { text: fullReplyText });

    // Execute sentence synthesis tasks sequentially so errors surface cleanly
    for (const task of sentenceQueue) {
      try {
        await task();
      } catch (err) {
        streamFailureError = err;
        break; // Stop processing remaining sentences and fall back
      }
    }
  }

  if (streamFailureError) {
    console.warn(`[FastLane Pipeline] Streamed pipeline failed (${streamFailureError.message}). Triggering fallback to Standard Naive mode.`);
    onEvent('fallback', {
      reason: streamFailureError.message,
      mode: 'standard',
      message: 'Streaming call failed or timed out. Falling back to Standard Naive mode.'
    });
    return await executeNaivePipeline({ text, voiceInfo, t0, onEvent, fallbackTriggered: true });
  }

  const totalTimeMs = Date.now() - t0;
  const finalLatencyMs = (t1 || Date.now()) - t0;

  onEvent('done', {
    mode: 'streamed',
    t0,
    t1: t1 || Date.now(),
    latencyMs: finalLatencyMs,
    totalTimeMs,
    fullReply: fullReplyText
  });

  return {
    mode: 'streamed',
    t0,
    t1: t1 || Date.now(),
    latencyMs: finalLatencyMs,
    totalTimeMs,
    fullReply: fullReplyText
  };
}

async function executeNaivePipeline({ text, voiceInfo, t0, onEvent, fallbackTriggered = false }) {
  const currentMode = fallbackTriggered ? 'standard' : 'naive';
  onEvent('mode', { mode: currentMode, voice: voiceInfo.speaker, model: voiceInfo.modelId });

  // 1. Wait for complete LLM generation
  onEvent('status', { message: 'Generating full reply with Gemini...' });
  const fullReply = await generateFullReply(text);
  onEvent('llm_complete', { text: fullReply });

  // 2. Send entire reply to Rime in a single synthesis call
  onEvent('status', { message: 'Synthesizing entire reply with Rime...' });
  const audioBuffer = await synthesizeAudio({
    text: fullReply,
    speaker: voiceInfo.speaker,
    modelId: voiceInfo.modelId,
    lang: voiceInfo.languageCode === 'eng' ? 'en' : voiceInfo.languageCode,
    timeoutMs: 10000,
    forceFail: false
  });

  const t1 = Date.now();
  const latencyMs = t1 - t0;

  onEvent('audio', {
    sentence: fullReply,
    sentenceIndex: 1,
    isFirst: true,
    latencyMs,
    audioBase64: audioBuffer.toString('base64'),
    format: 'audio/mpeg'
  });

  const totalTimeMs = Date.now() - t0;
  onEvent('done', { mode: currentMode, t0, t1, latencyMs, totalTimeMs, fullReply });

  return { mode: currentMode, t0, t1, latencyMs, totalTimeMs, fullReply };
}
