// services/rimeService.js
// Interfaces with Rime TTS API to synthesize high-quality speech with low latency.

const RIME_TTS_ENDPOINT = 'https://users.rime.ai/v1/rime-tts';

export async function synthesizeAudio({
  text,
  speaker = 'hawa',
  modelId = 'coda',
  lang = 'en',
  apiKey = process.env.RIME_API_KEY,
  timeoutMs = 5000,
  forceFail = false
}) {
  if (forceFail) {
    throw new Error('Artificially forced TTS failure for demo/testing fallback behavior');
  }

  if (!apiKey) {
    throw new Error('RIME_API_KEY is not configured in environment');
  }

  if (!text || !text.trim()) {
    throw new Error('No text provided for synthesis');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(RIME_TTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: text.trim(),
        modelId: modelId || 'coda',
        speaker: speaker || 'hawa',
        lang: lang || 'en',
        samplingRate: 24000
      }),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errDetail = await res.text();
      throw new Error(`Rime API responded with status ${res.status}: ${errDetail}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Rime TTS request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}
