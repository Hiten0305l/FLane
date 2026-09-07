// services/voiceCatalog.js
// Fetches Rime's live voice catalog and selects a verified natural English conversational voice.

const CATALOG_URL = 'https://users.rime.ai/data/voices/all-v2.json';

// Curated list of top natural English conversational voices optimized for low-latency dialogue
const PREFERRED_ENGLISH_VOICES = [
  'astra',     // Premier Rime English conversational voice
  'allison',
  'alpine',
  'amber',
  'abbie',
  'matilda',
  'mercury'
];

let cachedVoiceInfo = null;

export async function getVoiceInfo(forceRefresh = false) {
  if (cachedVoiceInfo && !forceRefresh) {
    return cachedVoiceInfo;
  }

  console.log(`[FastLane] Fetching live Rime voice catalog from ${CATALOG_URL}...`);
  try {
    const res = await fetch(CATALOG_URL);
    if (!res.ok) {
      throw new Error(`Failed to fetch live catalog: ${res.status} ${res.statusText}`);
    }
    const catalog = await res.json();

    let selectedSpeaker = null;
    let selectedModel = null;
    let selectedLang = 'eng';

    // 1. Search for preferred natural conversational English voice in coda first (flagship conversational model)
    const codaEngVoices = Array.isArray(catalog?.coda?.eng) ? catalog.coda.eng : [];
    for (const pref of PREFERRED_ENGLISH_VOICES) {
      if (codaEngVoices.includes(pref)) {
        selectedSpeaker = pref;
        selectedModel = 'coda';
        selectedLang = 'eng';
        break;
      }
    }

    // 2. If not found in coda, search preferred voices across all models in catalog
    if (!selectedSpeaker) {
      for (const [model, langs] of Object.entries(catalog)) {
        if (typeof langs === 'object' && langs !== null && Array.isArray(langs.eng)) {
          for (const pref of PREFERRED_ENGLISH_VOICES) {
            if (langs.eng.includes(pref)) {
              selectedSpeaker = pref;
              selectedModel = model;
              selectedLang = 'eng';
              break;
            }
          }
        }
        if (selectedSpeaker) break;
      }
    }

    // 3. If no preferred voice matched, pick the first verified English voice from coda or any model
    if (!selectedSpeaker) {
      if (codaEngVoices.length > 0) {
        selectedSpeaker = codaEngVoices[0];
        selectedModel = 'coda';
      } else {
        for (const [model, langs] of Object.entries(catalog)) {
          if (typeof langs === 'object' && langs !== null && Array.isArray(langs.eng) && langs.eng.length > 0) {
            selectedSpeaker = langs.eng[0];
            selectedModel = model;
            break;
          }
        }
      }
    }

    // 4. Verify strictly that the selected voice is currently in the live catalog
    const modelVoices = catalog?.[selectedModel]?.[selectedLang] || [];
    const isVerifiedInCatalog = modelVoices.includes(selectedSpeaker);

    if (!isVerifiedInCatalog) {
      throw new Error(`Voice selection error: '${selectedSpeaker}' is not present in the live catalog under model '${selectedModel}'`);
    }

    cachedVoiceInfo = {
      speaker: selectedSpeaker,
      modelId: selectedModel,
      languageCode: selectedLang,
      catalogUrl: CATALOG_URL,
      confirmedLive: true,
      availableEnglishVoicesInModel: modelVoices.length,
      timestamp: new Date().toISOString()
    };

    console.log(`[FastLane] Confirmed live natural English voice: speaker="${cachedVoiceInfo.speaker}", modelId="${cachedVoiceInfo.modelId}", lang="${cachedVoiceInfo.languageCode}" (out of ${modelVoices.length} verified English voices)`);
    return cachedVoiceInfo;
  } catch (err) {
    console.error(`[FastLane] Error querying live voice catalog:`, err.message);
    // Verified fallback if network fails
    cachedVoiceInfo = {
      speaker: 'astra',
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
