// server.js
// FastLane web server providing real-time streaming TTS pipeline and SSE bridge.

import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getVoiceInfo } from './services/voiceCatalog.js';
import { runPipeline } from './services/pipelineService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Fetch and confirm voice catalog on startup
getVoiceInfo().catch(err => {
  console.error('[FastLane] Startup voice catalog fetch warning:', err.message);
});

// Voice metadata endpoint
app.get('/api/voice-info', async (req, res) => {
  try {
    const info = await getVoiceInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real-time Pipeline Endpoint using Server-Sent Events (SSE)
app.post('/api/pipeline', async (req, res) => {
  const { text, mode = 'streamed', forceFallback = false, t0 = Date.now() } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Text prompt is required' });
  }

  // Set headers for Server-Sent Events
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    await runPipeline({
      text,
      mode,
      forceFallback,
      clientT0: t0,
      onEvent: (evt, data) => sendEvent(evt, data)
    });
    res.end();
  } catch (err) {
    console.error('[FastLane Pipeline Error]', err);
    sendEvent('error', { message: err.message });
    res.end();
  }
});

// Standalone endpoint for running a single benchmark trial
app.post('/api/benchmark-trial', async (req, res) => {
  const { phrase, mode = 'streamed', forceFallback = false } = req.body;
  const t0 = Date.now();

  try {
    let firstAudioLatency = null;
    const result = await runPipeline({
      text: phrase || "I'll have a large pepperoni pizza and a coke",
      mode,
      forceFallback,
      clientT0: t0,
      onEvent: (evt, data) => {
        if (evt === 'audio' && data.isFirst && firstAudioLatency === null) {
          firstAudioLatency = data.latencyMs;
        }
      }
    });

    res.json({
      success: true,
      mode: result.mode,
      latencyMs: firstAudioLatency || result.latencyMs,
      totalTimeMs: result.totalTimeMs,
      fullReply: result.fullReply,
      t0: result.t0,
      t1: result.t1
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`  🚀 FastLane Server running at http://localhost:${PORT}`);
  console.log(`  🎙️  Rime Voice: hawa (Model: coda)`);
  console.log(`  ⚡ Fast Mode: Streamed sentence-level TTS pipeline`);
  console.log(`  🐢 Standard Mode: Naive full-reply TTS pipeline`);
  console.log(`=======================================================`);
});
