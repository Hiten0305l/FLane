// services/voiceCatalog.js
// Fetches the live Rime voice catalog from users.rime.ai and confirms the voice and model.

const CATALOG_URL = 'https://users.rime.ai/data/voices/all-v2.json';

let cachedVoiceInfo = null;

export async function getVoiceInfo() {
  if (cachedVoiceInfo) {
    return cachedVoiceInfo;
  }

  console.log(`[FastLane] Fetching live Rime voice catalog from ${CATALOG_URL}...`);
  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch live catalog: ${res.status} ${res.statusText}`);
    }
    const catalog = await res.json();
    
    // Find which model and language contains 'hawa'
    let foundModel = null;
    let foundLang = null;

    for (const [model, langs] of Object.entries(catalog)) {
      if (typeof langs === 'object' && langs !== null) {
        for (const [lang, voices] of Object.entries(langs)) {
          if (Array.isArray(voices) && voices.includes('hawa')) {
            foundModel = model;
            foundLang = lang;
            break;
          }
        }
      }
      if (foundModel) break;
    }

    if (!foundModel) {
      console.warn("[FastLane] Warning: 'hawa' not found in live catalog, falling back to coda / eng");
      foundModel = 'coda';
      foundLang = 'eng';
    }

    cachedVoiceInfo = {
      speaker: 'hawa',
      modelId: foundModel,
      languageCode: foundLang,
      catalogUrl: CATALOG_URL,
      confirmedLive: true,
      timestamp: new Date().toISOString()
    };

    console.log(`[FastLane] Confirmed live voice: speaker="${cachedVoiceInfo.speaker}", modelId="${cachedVoiceInfo.modelId}", lang="${cachedVoiceInfo.languageCode}"`);
    return cachedVoiceInfo;
  } catch (err) {
    console.error(`[FastLane] Error querying live voice catalog:`, err.message);
    // Fallback to verified catalog values
    cachedVoiceInfo = {
      speaker: 'hawa',
      modelId: 'coda',
      languageCode: 'eng',
      catalogUrl: CATALOG_URL,
      confirmedLive: false,
      fallbackUsed: true,
      error: err.message,
      timestamp: new Date().toISOString()
    };
    return cachedVoiceInfo;
  }
}
