// scripts/check_catalog.mjs
// Verifies live voice catalog at users.rime.ai for voice hawa.

import { getVoiceInfo } from '../services/voiceCatalog.js';

async function check() {
  console.log("Checking live voice catalog...");
  const info = await getVoiceInfo();
  console.log("Result:", JSON.stringify(info, null, 2));
}

check();
