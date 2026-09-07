# Rime TTS Latency Evidence & Benchmark Protocol: FastLane

## 1. Hard Voice Claim
Pipelining sentence-level speech synthesis with **Rime TTS** concurrently with LLM token generation reduces the perceived conversational response latency (**Time to First Audio**) compared to a standard Naive pipeline that waits for the entire LLM response to complete before dispatching text to speech synthesis.

## 2. Voice Engineering Problem
In conversational voice systems, conversational realism is dictated by the duration of silence immediately following the user's turn:

$$\text{Time to First Audio (TTFA)} = t_{\text{first\_audible\_playback}} - t_{\text{user\_turn\_end}}$$

When using large language models, generating a multi-sentence conversational confirmation typically takes 500ms to 1200ms of token generation time. If the Text-to-Speech (TTS) engine is only triggered *after* the entire LLM response has finished:
1. The user waits through 100% of LLM reasoning time.
2. The user then waits through 100% of TTS synthesis time for the entire multi-sentence paragraph.
3. Total latency accumulates sequentially ($\text{Latency}_{\text{total}} = \text{STT} + \text{LLM}_{\text{full}} + \text{TTS}_{\text{full}}$), resulting in 2.5s to 3.5s+ of dead air.

FastLane addresses this problem by decoupling sentence generation: as soon as sentence 1 is tokenized, it is dispatched to Rime TTS while the LLM continues generating subsequent sentences.

## 3. Acceptance Test
To evaluate this claim objectively, FastLane includes an automated 30-run test harness (`scripts/benchmark.mjs`):
- **Test Input Fixture**: A standardized drive-thru order utterance:
  `"I'll have a large pepperoni pizza and a coke"`
- **Rounds**:
  - **15 trials** using the **Naive Pipeline** (sequential: full LLM completion $\to$ full utterance Rime synthesis).
  - **15 trials** using the **Streamed Pipeline** (pipelined: token streaming $\to$ sentence 1 boundary $\to$ immediate Rime synthesis).
- **Evaluation Environment**: Controlled programmatic execution eliminating microphone acoustics and human reaction jitter.

## 4. Measurement Definition
All measurements record explicit, verifiable events:

| Milestone | Definition |
| :--- | :--- |
| **$t_0$ (User Release)** | The timestamp recorded the instant the user releases the push-to-talk button or submits the order turn. |
| **STT Completion** | When speech recognition finishes and the transcript is submitted to the pipeline. |
| **Gemini First Usable Text** | When the first complete sentence boundary (`.`, `!`, `?`) is detected in the LLM token stream. |
| **Rime First Audio Received** | When the first synthesized audio chunk (MP3) arrives from Rime's TTS API. |
| **$t_1$ (First Audible Playback)** | When the browser audio subsystem physically triggers the `onplay` event, emitting audible sound. |

$$\text{Primary Metric: Time to First Audio} = t_1 - t_0$$

> [!NOTE]
> In the CLI test harness (`scripts/benchmark.mjs`), $t_1$ corresponds to the exact millisecond when the first audio buffer chunk arrives from Rime ready for immediate audio buffer playback. In the browser UI, $t_1$ is measured directly when the HTML5 `Audio.onplay` event fires.

## 5. Test Procedure
1. Initialize environment with valid `RIME_API_KEY` and `GEMINI_API_KEY`.
2. Query Rime's live catalog (`https://users.rime.ai/data/voices/all-v2.json`) to confirm active model and voice metadata.
3. Execute 15 consecutive Naive pipeline trials, logging $t_0$, $t_1$, total completion time, and full confirmation text.
4. Insert a 400ms pause between runs to prevent rate-limit contention.
5. Execute 15 consecutive Streamed pipeline trials under the exact same network conditions and test phrase.
6. Isolate and distinguish:
   - **Cold Start (Run #1)**: Initial network handshake, TLS negotiation, and unprimed connection.
   - **Warm Runs (Runs #2 through #15)**: Steady-state conversational dialogue performance.
7. Compute average warm latency, cold start latency, absolute latency reduction, and percentage latency reduction.

## 6. Streamed Pipeline Behavior
1. User turn completes ($t_0$).
2. The order transcript is dispatched to Gemini using `streamGenerateContent` via SSE.
3. As token fragments stream from Gemini, `SentenceParser` buffers text and checks for grammatical sentence boundaries (`.`, `!`, `?`).
4. On the very first sentence boundary (e.g. *"Got it, I've added a large pepperoni pizza and a Coke to your order."*), FastLane immediately dispatches an HTTP request to `https://users.rime.ai/v1/rime-tts`.
5. Rime synthesizes audio for that single sentence and returns the MP3 buffer.
6. The client receives the audio chunk and begins audible playback immediately ($t_1$).
7. Meanwhile, Gemini continues generating sentence 2 in the background. Sentence 2 is parsed, dispatched to Rime, and seamlessly appended to the client's audio queue before sentence 1 finishes playing.

## 7. Naive Pipeline Behavior
1. User turn completes ($t_0$).
2. The order transcript is dispatched to Gemini using standard `generateContent`.
3. The system waits until 100% of the LLM response tokens are generated.
4. The entire multi-sentence response is packaged into a single monolithic HTTP request to `https://users.rime.ai/v1/rime-tts`.
5. Rime synthesizes the entire response and returns the full audio buffer.
6. The client receives the audio buffer and begins playback ($t_1$).

Because TTS synthesis cannot begin until the LLM generation has finished, the user experiences the combined cumulative delay of both stages.

## 8. Results & Empirical Observations

When executed against live cloud endpoints (Google Gemini Flash & Rime TTS `coda` model), the reproducible benchmark exhibits the following performance characteristics:

| Metric | Naive Pipeline (Baseline) | Streamed Pipeline (FastLane) | Impact |
| :--- | :---: | :---: | :---: |
| **Cold Start Latency ($t_1 - t_0$)** | ~2,400 ms – 2,700 ms | ~2,100 ms – 2,300 ms | ~10% – 18% reduction |
| **Warm Average Latency ($t_1 - t_0$)** | ~2,500 ms – 2,800 ms | ~1,400 ms – 1,750 ms | **~35% – 45% reduction (~1.0s to 1.3s faster)** |
| **Full LLM Waiting Delay** | Compounded before TTS | Overlapped during Sentence 1 playback | Zero perceived LLM tail delay |

> [!IMPORTANT]
> Live test results depend on real-time network conditions and API responsiveness. Reviewers can verify these numbers independently by executing the reproduction script below.

## 9. Exact Environment & Configuration

```json
{
  "tts_provider": "Rime Labs",
  "endpoint": "https://users.rime.ai/v1/rime-tts",
  "modelId": "coda",
  "speaker": "astra",
  "lang": "en",
  "samplingRate": 24000,
  "audioFormat": "audio/mpeg",
  "llm_provider": "Google",
  "llm_model": "gemini-flash-lite-latest",
  "test_phrase": "I'll have a large pepperoni pizza and a coke",
  "transport": "HTTP / Server-Sent Events (SSE)"
}
```

## 10. Limitations
1. **First Sentence Length**: If the LLM generates a very long first sentence before a punctuation boundary, the streaming advantage is reduced. The system instruction prompts Gemini to keep the opening confirmation sentence concise (8–14 words).
2. **Network Jitter**: Cloud roundtrips to both Google and Rime introduce network latency. Cold runs exhibit higher latency due to initial TLS connection establishment.
3. **Audio Autoplay Policies**: In browser environments, audio playback requires prior user interaction (such as holding the push-to-talk button or clicking a test chip) to satisfy browser autoplay security policies.

## 11. Reproduction Instructions

To reproduce the benchmark on your local machine:

```bash
# 1. Clone the repository
git clone https://github.com/Hiten0305l/fastlane.git
cd fastlane

# 2. Install dependencies
npm install

# 3. Set API keys in .env
echo "RIME_API_KEY=your_actual_rime_api_key" >> .env
echo "GEMINI_API_KEY=your_actual_gemini_api_key" >> .env

# 4. Confirm live voice catalog
npm run catalog:check

# 5. Run the 30-trial acceptance benchmark
npm run benchmark
```

The script will log individual run latencies (`t1 - t0`) to the terminal and write a structured audit record to `benchmark_results.json`.
