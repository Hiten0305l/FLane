// scripts/benchmark.mjs
// Official 30-run timed test harness comparing Naive vs Streamed Rime TTS pipelines.

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runPipeline } from '../services/pipelineService.js';
import { getVoiceInfo } from '../services/voiceCatalog.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXED_ORDER_PHRASE = "I'll have a large pepperoni pizza and a coke";
const NUM_RUNS = 15;

async function runBenchmark() {
  console.log("================================================================================");
  console.log("                 FASTLANE: 30-RUN PIPELINE ACCEPTANCE BENCHMARK                 ");
  console.log("================================================================================");
  console.log(`Test Phrase: "${FIXED_ORDER_PHRASE}"`);
  
  const voiceInfo = await getVoiceInfo();
  console.log(`Voice: ${voiceInfo.speaker} | Model: ${voiceInfo.modelId} | Lang: ${voiceInfo.languageCode}`);
  console.log(`Endpoint: https://users.rime.ai/v1/rime-tts`);
  console.log("--------------------------------------------------------------------------------\n");

  const results = [];

  // 1. Run 15 Naive Trials
  console.log(">>> [1/2] RUNNING 15 NAIVE PIPELINE TRIALS (Wait for full LLM reply before TTS)...");
  for (let i = 1; i <= NUM_RUNS; i++) {
    const isCold = i === 1;
    const cacheState = isCold ? "Cold" : "Warm";
    process.stdout.write(`  Run #${i.toString().padStart(2, ' ')} [Naive - ${cacheState.padEnd(4, ' ')}] ... `);

    const t0 = Date.now();
    let firstAudioLatency = null;

    try {
      const res = await runPipeline({
        text: FIXED_ORDER_PHRASE,
        mode: 'naive',
        clientT0: t0,
        onEvent: (evt, data) => {
          if (evt === 'audio' && data.isFirst && firstAudioLatency === null) {
            firstAudioLatency = data.latencyMs;
          }
        }
      });

      const latencyMs = firstAudioLatency || res.latencyMs;
      console.log(`t1 - t0 = ${latencyMs} ms (total: ${res.totalTimeMs} ms)`);

      results.push({
        runId: i,
        pipeline: "Naive",
        cacheState,
        latencyMs,
        totalTimeMs: res.totalTimeMs,
        reply: res.fullReply
      });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({
        runId: i,
        pipeline: "Naive",
        cacheState,
        latencyMs: -1,
        error: err.message
      });
    }

    // Small pause between runs
    await new Promise(r => setTimeout(r, 400));
  }

  console.log("\n--------------------------------------------------------------------------------\n");

  // 2. Run 15 Streamed Trials
  console.log(">>> [2/2] RUNNING 15 STREAMED PIPELINE TRIALS (Sentence-by-sentence TTS streaming)...");
  for (let i = 1; i <= NUM_RUNS; i++) {
    const isCold = i === 1;
    const cacheState = isCold ? "Cold" : "Warm";
    const overallRunId = NUM_RUNS + i;
    process.stdout.write(`  Run #${overallRunId.toString().padStart(2, ' ')} [Streamed - ${cacheState.padEnd(4, ' ')}] ... `);

    const t0 = Date.now();
    let firstAudioLatency = null;

    try {
      const res = await runPipeline({
        text: FIXED_ORDER_PHRASE,
        mode: 'streamed',
        clientT0: t0,
        onEvent: (evt, data) => {
          if (evt === 'audio' && data.isFirst && firstAudioLatency === null) {
            firstAudioLatency = data.latencyMs;
          }
        }
      });

      const latencyMs = firstAudioLatency || res.latencyMs;
      console.log(`t1 - t0 = ${latencyMs} ms (first sentence audible)`);

      results.push({
        runId: overallRunId,
        pipeline: "Streamed",
        cacheState,
        latencyMs,
        totalTimeMs: res.totalTimeMs,
        reply: res.fullReply
      });
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      results.push({
        runId: overallRunId,
        pipeline: "Streamed",
        cacheState,
        latencyMs: -1,
        error: err.message
      });
    }

    // Small pause between runs
    await new Promise(r => setTimeout(r, 400));
  }

  // 3. Compute Metrics
  console.log("\n================================================================================");
  console.log("                             BENCHMARK RESULTS TABLE                            ");
  console.log("================================================================================");
  console.log("| Run # | Pipeline | Cache State | Latency (t1 - t0) | Total Time |");
  console.log("|-------|----------|-------------|-------------------|------------|");
  for (const r of results) {
    console.log(`| ${r.runId.toString().padStart(5, ' ')} | ${r.pipeline.padEnd(8, ' ')} | ${r.cacheState.padEnd(11, ' ')} | ${(r.latencyMs + " ms").padStart(17, ' ')} | ${(r.totalTimeMs ? r.totalTimeMs + " ms" : "N/A").padStart(10, ' ')} |`);
  }

  // Separate calculations
  const naiveCold = results.find(r => r.pipeline === "Naive" && r.cacheState === "Cold")?.latencyMs || 0;
  const naiveWarmRuns = results.filter(r => r.pipeline === "Naive" && r.cacheState === "Warm" && r.latencyMs > 0);
  const naiveWarmAvg = Math.round(naiveWarmRuns.reduce((a, b) => a + b.latencyMs, 0) / naiveWarmRuns.length);

  const streamedCold = results.find(r => r.pipeline === "Streamed" && r.cacheState === "Cold")?.latencyMs || 0;
  const streamedWarmRuns = results.filter(r => r.pipeline === "Streamed" && r.cacheState === "Warm" && r.latencyMs > 0);
  const streamedWarmAvg = Math.round(streamedWarmRuns.reduce((a, b) => a + b.latencyMs, 0) / streamedWarmRuns.length);

  const warmReduction = Math.round(((naiveWarmAvg - streamedWarmAvg) / naiveWarmAvg) * 100);
  const coldReduction = Math.round(((naiveCold - streamedCold) / naiveCold) * 100);

  const summary = {
    testDate: new Date().toISOString(),
    phrase: FIXED_ORDER_PHRASE,
    voice: voiceInfo,
    naive: {
      coldMs: naiveCold,
      warmAvgMs: naiveWarmAvg,
      warmRunCount: naiveWarmRuns.length
    },
    streamed: {
      coldMs: streamedCold,
      warmAvgMs: streamedWarmAvg,
      warmRunCount: streamedWarmRuns.length
    },
    improvement: {
      warmLatencyReductionPercent: warmReduction,
      coldLatencyReductionPercent: coldReduction
    },
    runs: results
  };

  const outputPath = path.join(__dirname, '..', 'benchmark_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));

  console.log("================================================================================");
  console.log("                             PLAIN-LANGUAGE SUMMARY                             ");
  console.log("================================================================================");
  console.log(`• Naive average:    ${naiveWarmAvg} ms (warm), ${naiveCold} ms (cold)`);
  console.log(`• Streamed average: ${streamedWarmAvg} ms (warm), ${streamedCold} ms (cold)`);
  console.log(`• Perceived Latency Reduction: ${warmReduction}% faster on warm runs, ${coldReduction}% faster on cold start.`);
  console.log(`• Results saved to ${outputPath}`);
  console.log("================================================================================");

  return summary;
}

runBenchmark().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
