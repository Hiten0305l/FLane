// scripts/check_catalog.mjs
// Verifies live voice catalog at users.rime.ai for verified natural English voice.

import { getVoiceInfo } from '../services/voiceCatalog.js';

async function check() {
  console.log("Checking live Rime voice catalog for natural English conversational voice...");
  const info = await getVoiceInfo(true);
  console.log("\nVerified Voice Info:");
  console.log(JSON.stringify(info, null, 2));

  if (info.confirmedLive && info.speaker) {
    console.log(`\n✅ Success: Selected verified live natural English voice '${info.speaker}' on model '${info.modelId}' (${info.languageCode}).`);
  } else {
    console.warn(`\n⚠️ Warning: Live verification failed or used fallback.`);
  }
}

check();
