// services/pipelineService.js
// Orchestrates the Naive vs Streamed audio pipelines with live sentence-level synthesis, fallback, and structured order state.

import { generateFullReply, streamReply } from './geminiService.js';
import { synthesizeAudio } from './rimeService.js';
import { SentenceParser } from './sentenceParser.js';
import { getVoiceInfo } from './voiceCatalog.js';

export async function runPipeline({
  text,
  mode = 'streamed',
  orderState = { items: [], confirmed: false },
  isInterruption = false,
  forceFallback = false,
  clientT0 = null,
  isCancelled = null,
  onEvent
}) {
  const t0 = clientT0 || Date.now();
  const voiceInfo = await getVoiceInfo();
  let activeMode = mode;

  // Notify client of active mode & voice
  onEvent('mode', { mode: activeMode, voice: voiceInfo.speaker, model: voiceInfo.modelId });

  if (activeMode === 'streamed') {
    return await executeStreamedPipeline({ text, orderState, isInterruption, voiceInfo, t0, forceFallback, isCancelled, onEvent });
  } else {
    return await executeNaivePipeline({ text, orderState, isInterruption, voiceInfo, t0, onEvent, fallbackTriggered: false, isCancelled });
  }
}

async function executeStreamedPipeline({ text, orderState, isInterruption, voiceInfo, t0, forceFallback, isCancelled, onEvent }) {
  let firstAudioSent = false;
  let t1 = null;
  let fullReplyText = '';
  let updatedOrderState = orderState;
  let streamFailureError = null;

  const tGeminiStart = Date.now();
  let geminiFirstTextMs = null;
  let rimeFirstAudioMs = null;

  let synthChain = Promise.resolve();

  const parser = new SentenceParser((sentence, idx) => {
    if (isCancelled && isCancelled()) return;
    const isFirst = idx === 1;
    const forceThisFail = forceFallback && isFirst;

    if (isFirst && geminiFirstTextMs === null) {
      geminiFirstTextMs = Date.now() - tGeminiStart;
      onEvent('stage', { stage: 'gemini', label: 'Gemini → first text', durationMs: geminiFirstTextMs });
    }

    onEvent('sentence', { sentence, index: idx });

    // Begin synthesis immediately as sentence is parsed, chained sequentially so audio chunks arrive in order
    synthChain = synthChain.then(async () => {
      if (streamFailureError || (isCancelled && isCancelled())) return;

      const tSynthStart = Date.now();
      const audioBuffer = await synthesizeAudio({
        text: sentence,
        speaker: voiceInfo.speaker,
        modelId: voiceInfo.modelId,
        lang: voiceInfo.languageCode === 'eng' ? 'en' : voiceInfo.languageCode,
        timeoutMs: 10000,
        forceFail: forceThisFail
      });

      if (isCancelled && isCancelled()) return;

      if (!firstAudioSent) {
        firstAudioSent = true;
        t1 = Date.now();
        rimeFirstAudioMs = Date.now() - tSynthStart;
        onEvent('stage', { stage: 'rime', label: 'Rime → first audio', durationMs: rimeFirstAudioMs });
      }

      const latencyMs = (t1 || Date.now()) - t0;
      onEvent('audio', {
        sentence,
        sentenceIndex: idx,
        isFirst,
        latencyMs,
        audioBase64: audioBuffer.toString('base64'),
        format: 'audio/mpeg'
      });
    }).catch(err => {
      if (isCancelled && isCancelled()) return;
      console.warn(`[FastLane Pipeline] Sentence #${idx} synthesis error: ${err.message}`);
      streamFailureError = err;
    });
  });

  try {
    const result = await streamReply({
      text,
      orderState,
      isInterruption,
      onToken: (token) => {
        if (isCancelled && isCancelled()) return;
        onEvent('llm_token', { token });
        parser.addChunk(token);
      }
    });

    fullReplyText = result.reply;
    updatedOrderState = result.orderState;
  } catch (err) {
    if (isCancelled && isCancelled()) return;
    streamFailureError = err;
  }

  if (!streamFailureError) {
    parser.flush();
    if (geminiFirstTextMs === null) {
      geminiFirstTextMs = Date.now() - tGeminiStart;
      onEvent('stage', { stage: 'gemini', label: 'Gemini → first text', durationMs: geminiFirstTextMs });
    }

    // Emit structured order state event upon LLM completion immediately
    onEvent('order_state', updatedOrderState);
    onEvent('llm_complete', { text: fullReplyText, orderState: updatedOrderState });

    // Wait for all sentence audio synthesis to complete
    await synthChain;
  }

  if (streamFailureError) {
    console.warn(`[FastLane Pipeline] Streamed pipeline failed (${streamFailureError.message}). Triggering fallback.`);
    onEvent('fallback', {
      reason: streamFailureError.message,
      mode: 'standard',
      message: 'Streaming call failed or timed out. Falling back to Standard Naive mode.'
    });
    return await executeNaivePipeline({ text, orderState, isInterruption, voiceInfo, t0, onEvent, fallbackTriggered: true });
  }

  const totalTimeMs = Date.now() - t0;
  const finalLatencyMs = (t1 || Date.now()) - t0;

  onEvent('done', {
    mode: 'streamed',
    t0,
    t1: t1 || Date.now(),
    latencyMs: finalLatencyMs,
    totalTimeMs,
    fullReply: fullReplyText,
    orderState: updatedOrderState,
    stageTimings: {
      geminiMs: geminiFirstTextMs,
      rimeMs: rimeFirstAudioMs
    }
  });

  return {
    mode: 'streamed',
    t0,
    t1: t1 || Date.now(),
    latencyMs: finalLatencyMs,
    totalTimeMs,
    fullReply: fullReplyText,
    orderState: updatedOrderState,
    stageTimings: {
      geminiMs: geminiFirstTextMs,
      rimeMs: rimeFirstAudioMs
    }
  };
}

async function executeNaivePipeline({ text, orderState, isInterruption, voiceInfo, t0, onEvent, fallbackTriggered = false }) {
  const currentMode = fallbackTriggered ? 'standard' : 'naive';
  onEvent('mode', { mode: currentMode, voice: voiceInfo.speaker, model: voiceInfo.modelId });

  onEvent('status', { message: 'Generating full reply with Gemini...' });
  const tGeminiStart = Date.now();
  const { reply: fullReply, orderState: updatedOrderState } = await generateFullReply({
    text,
    orderState,
    isInterruption
  });
  const geminiFullMs = Date.now() - tGeminiStart;
  onEvent('stage', { stage: 'gemini', label: 'Gemini (full reply)', durationMs: geminiFullMs });
  
  onEvent('order_state', updatedOrderState);
  onEvent('llm_complete', { text: fullReply, orderState: updatedOrderState });

  onEvent('status', { message: 'Synthesizing entire reply with Rime...' });
  const tRimeStart = Date.now();
  const audioBuffer = await synthesizeAudio({
    text: fullReply,
    speaker: voiceInfo.speaker,
    modelId: voiceInfo.modelId,
    lang: voiceInfo.languageCode === 'eng' ? 'en' : voiceInfo.languageCode,
    timeoutMs: 10000,
    forceFail: false
  });
  const rimeAudioMs = Date.now() - tRimeStart;
  onEvent('stage', { stage: 'rime', label: 'Rime → first audio', durationMs: rimeAudioMs });

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
  onEvent('done', {
    mode: currentMode,
    t0,
    t1,
    latencyMs,
    totalTimeMs,
    fullReply,
    orderState: updatedOrderState,
    stageTimings: {
      geminiMs: geminiFullMs,
      rimeMs: rimeAudioMs
    }
  });

  return {
    mode: currentMode,
    t0,
    t1,
    latencyMs,
    totalTimeMs,
    fullReply,
    orderState: updatedOrderState,
    stageTimings: {
      geminiMs: geminiFullMs,
      rimeMs: rimeAudioMs
    }
  };
}
