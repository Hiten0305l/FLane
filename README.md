# FastLane ⚡
> **Low-Latency Push-to-Talk Voice Ordering Assistant for Drive-Thru & Fast Food**  
> *Built for the Rime-sponsored Hackathon showcasing live sentence-level streaming TTS vs. naive full-reply synthesis.*

---

## Overview

In drive-thru and quick-service restaurant (QSR) environments, response latency directly dictates customer satisfaction, drive-thru throughput, and conversational naturalness. Waiting for a traditional pipeline where an LLM generates a complete paragraph before triggering Text-to-Speech (TTS) introduces an awkward, noticeable silence (2.5 to 3.5+ seconds).

**FastLane** proves that a **streamed sentence-level TTS pipeline** using **Rime TTS** drastically reduces the perceived delay between when a user releases the push-to-talk button (`t0`) and hears the very first audible word of the confirmation (`t1`).

FastLane uses:
- **TTS Engine**: [Rime TTS](https://rime.ai) (`coda` model with the `hawa` Indian-English voice).
- **LLM**: Google Gemini 2.5 Flash (`gemini-2.5-flash:streamGenerateContent`) prompting natural Hinglish drive-thru order confirmations.
- **STT**: Browser Web Speech API (`SpeechRecognition`) with an accessible keyboard & direct-input fallback.

---

## Rime Configuration & Specifications

Before writing or running code, FastLane queries Rime's live public catalog at [`https://users.rime.ai/data/voices/all-v2.json`](https://users.rime.ai/data/voices/all-v2.json) to verify voice availability and model assignment.

| Parameter | Specification | Details |
| :--- | :--- | :--- |
| **Model ID** | `coda` | Confirmed live via catalog check under `coda` -> `eng` |
| **Speaker / Voice** | `hawa` | Rime's premier Indian-English voice built for code-switching |
| **Language Code** | `en` / `eng` | ISO 639-2 `eng` in catalog; BCP 47 `en` in API request |
| **Audio Format** | `audio/mpeg` | 24,000 Hz MP3 stream for universal browser compatibility |
| **Naive Mode Transport** | Non-streaming HTTP | `POST https://users.rime.ai/v1/rime-tts` (full utterance synthesized in a single call after LLM completion) |
| **Streamed Mode Transport** | Sentence-level Streaming | Pipelined `POST https://users.rime.ai/v1/rime-tts` triggered on the first complete sentence boundary (`.`, `?`, `!`) during token generation |
| **Timeout & Fallback** | 5,000 ms timeout | Auto-retries via Standard Naive mode if streaming encounters errors or timeout |

To verify the catalog live at any time:
```bash
npm run catalog:check
```

---

## Linguistic Analysis: Roman Script vs. Devanagari for Hinglish TTS

TTS engines commonly struggle with Indian code-switching (Hinglish) because English phonetic rules often mispronounce Romanized Hindi words, while Hindi engines stumble over English menu items. 

We performed comparative testing with `hawa` on `coda` across both script formats using Rime's vocabulary coverage endpoint (`POST https://users.rime.ai/oov`) and audio synthesis:

1. **Devanagari Script** (`"आपका order confirm हो गया है, ready in fifteen minutes."`):
   - Out-of-Vocabulary check returned **100% OOV for all Devanagari words**: `['आपका', 'ऑर्डर', 'कन्फर्म', 'हो', 'गया', 'है']`.
   - Because `hawa` is housed under the `coda` English dictionary (`eng`), Devanagari Unicode codepoints are not phonemized cleanly and result in dropped syllables or unnatural cadence.
2. **Roman Script** (`"Aapka order confirm ho gaya hai, ready in fifteen minutes."`):
   - Out-of-Vocabulary check returned high in-vocabulary coverage: common words (`order`, `confirm`, `ho`, `hai`, `ready`, `in`, `fifteen`, `minutes`) were recognized natively, while phonetic transliterations (`Aapka`, `gaya`) were pronounced with authentic Indian English phonology and natural cadence.

**Conclusion**: FastLane prompts Gemini to strictly generate authentic Hinglish using Roman/Latin script (`"Haan ji, ek large pepperoni pizza aur ek Coke confirm ho gaya hai!"`). This produces superior prosody, natural code-switching, and accurate pronunciation.

---

## Pipeline Architecture

```
User Presses & Speaks -> Releases Button (t0)
                               |
               +---------------+---------------+
               |                               |
       [NAIVE PIPELINE]               [STREAMED PIPELINE]
               |                               |
     Wait for 100% LLM reply           Stream LLM tokens via SSE
   ("Haan ji, ek pizza aur...")                |
               |                     Detect 1st Sentence End (.?!)
      Send Full Utterance                      |
       to Rime TTS HTTP               Dispatch 1st Sentence to Rime
               |                               |
      Receive Full Audio              1st Audio Arrives (t1!)
               |                     [Audio begins playing immediately]
      Audio Starts (t1)                        |
                                      Subsequent sentences generated
                                       and queued in background
```

### Automatic Fallback & Visual Telemetry
- If the streamed Rime call fails or exceeds a 5-second timeout, FastLane catches the exception and immediately retries using the standard non-streaming pipeline.
- The UI contains a live **status badge** in the header:
  - **`Fast mode` (green)**: Active streaming pipeline.
  - **`Standard mode` (amber)**: Triggered fallback or standard mode.
- A **`Force fallback test` [Demo Aid]** button in the UI allows judges and developers to artificially trigger a streaming failure on camera to demonstrate automatic recovery and badge state transition.

---

## Prior Art: Differentiation from "Roger AI"

We reviewed prior projects in [`github.com/rimelabs/rime-dev-projects`](https://github.com/rimelabs/rime-dev-projects). The closest project is **Roger AI**, an air traffic control (ATC) simulator built with Rime TTS.

FastLane differentiates from Roger AI in two fundamental dimensions:
1. **Domain & Persona**: Roger AI operates in aviation/ATC with standardized phraseology. FastLane operates in commercial drive-thru ordering with dynamic multilingual code-switching (Hinglish).
2. **Latency Architecture**: Roger AI achieved low latency by using **response caching** for predetermined ATC commands. FastLane achieves low latency on dynamic, arbitrary orders through **sentence-level streaming synthesis pipelining**, eliminating the wait for full LLM token generation without requiring static response caching.

---

## Quickstart & Setup

### Prerequisites
- Node.js 20+ (Node 22 or 25 recommended)
- A valid Rime API key ([app.rime.ai](https://app.rime.ai))
- A valid Google Gemini API key

### 1. Installation
```bash
# Clone the repository
git clone https://github.com/your-org/fastlane.git
cd fastlane

# Install dependencies
npm install
```

### 2. Environment Configuration
Copy the example environment file and insert your API keys:
```bash
cp .env.example .env
```
Edit `.env`:
```env
RIME_API_KEY=your_rime_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
```
*(Note: `.env` is listed in `.gitignore` and must never be committed).*

### 3. Run Application
```bash
# Start server
npm start

# Or with automatic reloading
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Run the 30-Turn Timed Acceptance Test
Run the automated reproducible benchmark script in your terminal:
```bash
npm run benchmark
```
Or click the **"Run 30-Turn Test"** button directly inside the web UI to watch real-time execution.

---

## Single-Page UI Features

1. **Header**: "FastLane" branding with dynamic pill badge ("Fast mode" green / "Standard mode" amber) reflecting real pipeline state.
2. **Live Stopwatch Timer**: Large counter starting at mic release (`t0`) that increments in real time and freezes the instant audio begins (`t1`).
3. **Transcript Cards**: Clean "You said" and "FastLane replied" cards that refresh cleanly each turn without clutter.
4. **Stats Row**: Displays exact measured response time (`t1 - t0`) and live verified Rime speaker (`hawa` on `coda`).
5. **Hold-to-Talk Button**: Prominent bottom mic button with audio-level animation and pointer event bindings.
6. **Quick Test Chips & Manual Input**: Quick-order buttons ("Pepperoni Pizza & Coke", "Cheeseburgers & Fries") for instant click-to-test without microphone permissions.
7. **Pipeline Latency Comparison Bars**: Proportional horizontal bars comparing Streamed vs. Naive latency.
8. **Trial History Strip**: Visual log of the last 5 completed trials with exact timing.
9. **Dev-Only Fallback Trigger**: Interactive button to demonstrate error recovery and badge transition.
10. **In-App Acceptance Test Panel**: Interactive 30-run test runner with live progress bar and cold vs. warm metrics.

---

## Known Limitations

1. **Turn-based Push-to-Talk**: FastLane is a turn-based push-to-talk system, not continuous listening. It does not support the user interrupting the bot mid-reply or correcting an order while the bot is speaking — that is a separate hard-voice-problem category (interruption and recovery) that this project does not attempt.
2. **Single Fixed Phrase Benchmark**: Acceptance latency was benchmarked on one fixed order phrase repeated 15 times per mode, not on open-ended or arbitrarily varied speech lengths.
3. **Environment-Specific Timings**: Measured timings are specific to the test environment (network conditions, LLM provider load, time of day, geographic routing) and are not a universal performance guarantee.
4. **Noisy Audio Conditions**: No testing was performed under noisy or adverse audio conditions (e.g. ambient kitchen noise, car engine rumble).
5. **Fallback Latency**: When the fallback to standard/naive mode is triggered, the user does experience the full non-streamed delay — the fallback is disclosed and visible, not eliminated.

---

## License
MIT License. Created for the Rime Hackathon.
