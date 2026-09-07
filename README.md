# FastLane

## What it is
FastLane is an ultra-low-latency voice ordering assistant designed for quick-service restaurant (QSR) and drive-thru environments. Built with **Rime TTS** and **Google Gemini**, FastLane demonstrates how pipelining sentence-level speech synthesis reduces conversational latency to deliver human-like, rapid spoken interactions.

## Problem
In drive-thru voice systems, conversational responsiveness directly dictates customer throughput and order confidence. The critical latency bottleneck in voice agents is:

$$\text{Time to First Audio} = \text{End of User Turn} \to \text{First Audible Spoken Word}$$

In traditional (Naive) voice pipelines:
1. The user finishes speaking.
2. Speech-to-Text (STT) transcribes the speech.
3. The LLM generates the entire multi-sentence response.
4. The system sends the complete text block to a Text-to-Speech (TTS) engine.
5. The audio synthesizes and finally begins playing in the user's speaker.

Waiting for 100% of LLM tokens before triggering speech synthesis creates an uncomfortable, awkward silence of 2.5 to 3.5+ seconds, breaking the conversational flow of a real drive-thru.

## Solution
FastLane solves this voice-engineering challenge through **early sentence-level pipelined streaming**:
- As Gemini streams response tokens, FastLane detects the very first complete sentence boundary (`.`, `!`, `?`).
- FastLane dispatches that first sentence to **Rime TTS** immediately, while Gemini continues generating the rest of the response in parallel.
- The browser begins audible playback of the first sentence as soon as Rime's audio buffer arrives.
- Subsequent sentences are synthesized and queued seamlessly in the background while the user is already listening to the first sentence.

This overlaps LLM reasoning and audio synthesis, cutting the perceived response delay dramatically without requiring pre-recorded or static response caching.

## Architecture

The end-to-end processing pipeline:

```
[Customer Speaks]
       │
       ▼ (Push-to-Talk Release / End of Turn)
[Browser STT] (Web Speech API / Direct Input Fallback)
       │
       ▼ (User Transcript dispatched to FastLane Server)
[Orchestration Engine (server.js & pipelineService.js)]
       │
       ├─────────────────────────────────────────┐
       ▼                                         ▼
[Streamed Pipeline (Fast Mode)]          [Naive Pipeline (Standard Mode)]
       │                                         │
Gemini token stream starts                       Gemini generates 100% full reply
       │                                         │
Detect 1st sentence boundary                     Full reply finished
       │                                         │
Dispatch 1st sentence to Rime TTS API            Dispatch entire text to Rime TTS API
       │                                         │
1st Audio chunk arrives                          Full audio arrives
       │                                         │
Browser begins AUDIBLE playback (t1)             Browser begins AUDIBLE playback (t1)
       │
Subsequent sentences synthesized & queued
while user is listening
```

### How Streamed Differs from Naive
- **Naive Pipeline**: Monolithic sequential execution: $\text{STT} \to \text{Full LLM generation} \to \text{Full TTS synthesis} \to \text{Playback}$.
- **Streamed Pipeline**: Pipelined overlapping execution: $\text{STT} \to \text{LLM token stream} \to \text{Sentence 1 boundary} \to \text{Rime TTS Sentence 1} \to \text{Audible Playback}$, while Sentence 2+ synthesizes concurrently.

## Why Rime
Voice is the primary human interface in a drive-thru. Text-on-screen is secondary; the customer listens to audio confirmation while driving.

Rime TTS is chosen because:
1. **Ultra-Low Synthesis Latency**: Rime synthesizes natural conversational audio rapidly, enabling sentence-level pipelining that fits within conversational pause tolerances.
2. **Conversational Naturalness**: The `coda` model with natural English voices (such as `astra`) delivers authentic cadence, inflection, and tone suited for customer-facing order confirmation.
3. **HTTP Streaming Compatibility**: Supports standard 24 kHz MP3 audio synthesis with consistent per-sentence turnaround.

## Metrics
The primary judged metric is:

$$\text{Time to First Audio (TTFA)} = t_{\text{first\_audible\_playback}} - t_{\text{user\_release}}$$

- **User Release ($t_0$)**: The exact moment the user releases the push-to-talk button (or submits an order turn).
- **STT Milestone**: When speech recognition completes and order text is submitted to the pipeline.
- **LLM First Text Milestone**: When the first usable sentence boundary is parsed from the Gemini token stream.
- **Rime Audio Ready Milestone**: When the synthesized audio buffer for the first sentence is received.
- **First Audible Playback ($t_1$)**: When the browser's audio subsystem physically begins emitting audible speech (`audio.onplay`).

> [!IMPORTANT]
> Time to First Audio is strictly measured to **audible playback**, not merely backend completion, LLM generation end, or audio file arrival.

## Benchmark Methodology
To ensure reproducible and un-fabricated latency comparisons:
1. **Controlled Fixture Test**: A fixed drive-thru order fixture (`"I'll have a large pepperoni pizza and a coke"`) is fed to both the Naive and Streamed pipelines across consecutive runs.
2. **Automated Test Harness**: `npm run benchmark` executes 15 Naive runs and 15 Streamed runs against the live Rime and Gemini APIs.
3. **Distinction of Cold vs. Warm Runs**:
   - **Cold run (Run #1)**: Measures initial connection setup, TLS handshake, and first synthesis.
   - **Warm runs (Runs #2-#15)**: Measures ongoing conversational dialogue performance.
4. **Live UI Measurement**: In the web application, every user interaction records an actual trial with mode, timestamp, exact Time to First Audio, and stage durations. The Performance Comparison bar computes:
   - $\text{Absolute Improvement} = \text{Naive TTFA} - \text{Streamed TTFA}$
   - $\text{Percentage Improvement} = \frac{\text{Absolute Improvement}}{\text{Naive TTFA}} \times 100$

## Setup

### Prerequisites
- Node.js 20+ (Node 22 or 25 recommended)
- A valid Rime API key ([app.rime.ai](https://app.rime.ai))
- A valid Google Gemini API key ([aistudio.google.com](https://aistudio.google.com))

### Installation
```bash
git clone https://github.com/Hiten0305l/fastlane.git
cd fastlane
npm install
```

## Environment Variables
Create a `.env` file from the provided `.env.example`:

```bash
cp .env.example .env
```

Configure your API keys in `.env`:
```env
# FastLane Environment Configuration
RIME_API_KEY=your_rime_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
```

> [!CAUTION]
> Never commit `.env` or any real API credentials to source control. `.env` is ignored in `.gitignore`.

## Running the App

### 1. Check Voice Catalog
Verify that your Rime credentials are valid and query the live public catalog:
```bash
npm run catalog:check
```

### 2. Start the Development Server
```bash
npm run dev
```
Or for production mode:
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

### 3. Run the Acceptance Benchmark Suite
Execute the 30-run controlled benchmark:
```bash
npm run benchmark
```
This generates `benchmark_results.json` containing the exact run-by-run measurements.

## Repository Structure

```
fastlane/
├── server.js                  # Express web server & SSE streaming pipeline endpoints
├── services/
│   ├── pipelineService.js     # Orchestrates Streamed vs. Naive pipelines
│   ├── rimeService.js         # Direct Rime TTS API integration (v1/rime-tts)
│   ├── geminiService.js       # Google Gemini LLM streaming & structured order extraction
│   ├── sentenceParser.js      # Real-time sentence boundary tokenizer for streaming audio
│   └── voiceCatalog.js        # Live Rime voice catalog resolver and verification
├── scripts/
│   ├── benchmark.mjs          # 30-run automated acceptance test harness
│   └── check_catalog.mjs      # Diagnostic script to check live Rime voices
├── public/
│   ├── index.html             # User View (clean ordering) and Insights View (latency telemetry)
│   ├── app.js                 # Push-to-talk, Audio Queue, VAD, and real-trials comparison logic
│   └── style.css              # Custom styling for drive-thru UI and timing flow diagrams
├── .env.example               # Safe template for environment variables
├── .gitignore                 # Enforces security of secrets, logs, and build artifacts
├── README.md                  # Comprehensive project documentation
└── RIME_EVIDENCE.md           # Formal latency claim, measurement criteria, and test evidence
```

## Limitations
1. **Push-to-Talk Interface**: FastLane operates via push-to-talk and click-to-test controls. While browser VAD monitors for speech during playback to support interruption, noisy microphone environments without headphones may pick up speaker feedback.
2. **Network Dependency**: Measurements include live cloud roundtrips to both Google Gemini and Rime TTS. Actual numbers vary based on geographical proximity to server clusters and network latency.
3. **Fallback Delay**: When the streaming pipeline encounters an error or network drop, FastLane safely falls back to standard Naive synthesis. The fallback ensures order completion but incurs the standard Naive latency.
