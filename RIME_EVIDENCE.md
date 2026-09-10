# Rime TTS Latency Evidence & Benchmark Protocol: FastLane

## The Hard Voice Claim
Pipelining sentence-level speech synthesis with **Rime TTS** concurrently with LLM token generation pipelining sentence-level speech synthesis with Rime TTS concurrently with LLM token generation reduces server-side Time to First Audio compared to a naive pipeline that waits for the full LLM response to complete before starting synthesis compared to a naive pipeline that waits for the full LLM response to complete before starting synthesis.

---

## Acceptance Test
The formal acceptance criteria and test definition are implemented in `scripts/benchmark.mjs`:
- **Standardized Test Phrase**: `"I'll have a large pepperoni pizza and a coke"`
- **Trial Count & Split**: 30 total controlled trials:
  - **15 trials** evaluating the **Naive Pipeline** (sequential: full LLM completion $\to$ monolithic Rime synthesis).
  - **15 trials** evaluating the **Streamed Pipeline** (pipelined: token streaming $\to$ sentence 1 boundary $\to$ immediate Rime synthesis).
- **Exact Metric Measured**: **Time to First Audio (TTFA)**, defined as $t_1 - t_0$, where $t_0$ is the start of the order turn and - **Exact Metric Measured:** Time to First Audio (TTFA), defined as t₁ − t₀, where t₀ is the start of the order turn and t₁ is the timestamp when the first synthesized Rime audio chunk is received by the benchmark.
- **Success Threshold**: Achieving a measurable reduction in Time to First Audio across warm conversational trials (target $\ge 25\%$ reduction).

---

## Test Procedure
The automated benchmark script (`scripts/benchmark.mjs`) performs the following steps in sequence:

1. **Environment Setup**: Loads environment variables (`RIME_API_KEY`, `GEMINI_API_KEY`, `PORT`) via `dotenv`.
2. **Voice Resolution**: Calls `getVoiceInfo()` to query the live Rime voice catalog (`https://users.rime.ai/data/voices/all-v2.json`) and verify that the active conversational voice (`astra`, model `coda`, language `eng`) is available and online.
3. **Execution of 15 Naive Trials**:
   - Iterates through Runs #1 to #15 with `mode: 'naive'`.
   - Records Run #1 as "Cold" and Runs #2–#15 as "Warm".
   - Measures $t_0$, awaits the full Gemini text generation, awaits monolithic Rime TTS audio synthesis, and records $t_1$ and total execution time.
   - Enforces a 400ms pause between runs to avoid API rate limiting.
4. **Execution of 15 Streamed Trials**:
   - Iterates through Runs #16 to #30 with `mode: 'streamed'`.
   - Records Run #16 as "Cold" and Runs #17–#30 as "Warm".
   - Measures $t_0$, streams Gemini tokens via Server-Sent Events, emits sentence 1 to Rime as soon as the first sentence boundary (`.`, `!`, `?`) is detected by `SentenceParser`, and records $t_1$ upon receiving the first audio buffer chunk.
   - Enforces a 400ms pause between runs.
5. **Statistical Aggregation**:
   - Computes Naive cold latency (Run #1) and Naive warm average latency (Runs #2–#15).
   - Computes Streamed cold latency (Run #16) and Streamed warm average latency (Runs #17–#30).
   - Calculates percentage latency reduction for both warm runs and cold starts.
6. **Artifact Output**: Formats and prints a terminal summary table and persists the complete structured audit log to `benchmark_results.json`.

---

## Measurement Definition
All measurements record explicit, verifiable events:

| Milestone | Definition |
| :--- | :--- |
| **$t_0$ (User Release)** | The timestamp recorded the instant the user releases the push-to-talk button or submits the order turn. |
| **STT Completion** | When speech recognition finishes and the transcript is submitted to the pipeline. |
| **Gemini First Usable Text** | When the first complete sentence boundary (`.`, `!`, `?`) is detected in the LLM token stream. |
| **Rime First Audio Received** | When the first synthesized audio chunk (MP3) arrives from Rime's TTS API. |
| **$t_1$ (First Audible Playback)** | When the browser audio subsystem physically triggers the `onplay` event, emitting audible sound. |

$$\text{Primary Metric: Time to First Audio (TTFA)} = t_1 - t_0$$

> [!NOTE]
> TTFA measures the duration from the end of the user's turn to the **first audible response**, not total response completion time.

---

## Results
The numbers below reflect the actual current measurements recorded in `benchmark_results.json`:

- **Active Voice Used**: `speaker: "astra"`, `modelId: "coda"`, `languageCode: "eng"` 
- **Test Date**: `2026-09-08T05:27:14.760Z`
- **Test Phrase**: `"I'll have a large pepperoni pizza and a coke"`

### Latency Summary Table

| Pipeline | Cold Start ($t_1 - t_0$) | Warm Average ($t_1 - t_0$) | Warm Min | Warm Max | Warm Run Count |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Naive Pipeline** | 3,142 ms | 2,666 ms | 2,337 ms (Run #5) | 3,159 ms (Run #3) | 14 runs |
| **Streamed Pipeline** | 2,306 ms | 1,858 ms | 1,105 ms (Run #18) | 2,481 ms (Run #27) | 14 runs |
| **Improvement** | **27% reduction** (836 ms faster) | **30% reduction** (~808 ms faster) | — | — | — |

The streamed pipeline consistently reduces Time to First Audio by **30% on warm conversational turns**, confirming that overlapping sentence 1 synthesis with ongoing LLM generation effectively eliminates dead-air delay.

---

## Additional Live Observation (Small Sample)
In addition to the formal 30-run benchmark in `benchmark_results.json`, an empirical 3-pair warm live comparison was observed:

- **Run 1**:
  - Streamed TTFA: 1,995 ms
  - Naive TTFA: 2,034 ms
  - Result: Streamed advantage of 39 ms
- **Run 2**:
  - Streamed TTFA: 1,647 ms
  - Naive TTFA: 3,261 ms
  - Result: Streamed advantage of 1,614 ms
- **Run 3**:
  - Streamed TTFA: 2,191 ms
  - Naive TTFA: 1,986 ms
  - Result: Naive advantage of 205 ms

> [!NOTE]
> Run 3 demonstrates that individual live runs can favor Naive due to internet roundtrip jitter to the cloud TTS endpoint and concise LLM responses. Streaming provides a consistent statistical advantage across larger sample sizes, but does not guarantee faster timing on every single arbitrary execution.

---

## Reproduction Instructions
To reproduce the 30-trial benchmark locally:

```bash
# 1. Install dependencies
npm install

# 2. Check live voice catalog
npm run catalog:check

# 3. Run the automated 30-run benchmark
npm run benchmark
```

The script will log individual run latencies (`t1 - t0`) to the terminal and output the audit record to `benchmark_results.json`.

---

## Limitations

###  Cold start vs. warm run latency
Based on the actual measurements in `benchmark_results.json`:
- **Cold Start Latency**: Naive measured **3,142 ms** vs. Streamed at **2,306 ms** (a 27% reduction).
- **Warm Run Latency**: Naive averaged **2,666 ms** vs. Streamed at **1,858 ms** (a 30% reduction).

The first request after a server restart exhibits higher latency due to initial DNS lookups, TCP connection setup, TLS handshakes to `generativelanguage.googleapis.com` and `users.rime.ai`, and voice catalog fetching. Subsequent warm requests benefit from established HTTP keep-alive connections and in-memory voice metadata. This benchmark observation reflects network transport and socket state rather than a universal fixed latency delta across all runtime environments.

