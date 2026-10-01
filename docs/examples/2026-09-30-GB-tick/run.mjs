// Drives the parts of the run the `ebb` CLI has no subcommand for:
// fetch the live GB forecast, ask recommendWindow() for a 72h window,
// and enqueue one Ollama provider call that `ebb tick` then dispatches.
// Usage: node run.mjs <queue-db> <forecast-json-out>
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const { buildDefaultGridFeed, recommendWindow, Scheduler } = await import(
  resolve(repo, "packages/core-ts/dist/index.js")
);

const [dbPath, forecastOut] = process.argv.slice(2);
const REGION = "GB";
const MODEL = "llama3.2:1b";
const feed = buildDefaultGridFeed({});

// 1. The live forecast horizon the recommendation is chosen from.
const forecast = await feed.fetchForecast(REGION, 72);
writeFileSync(forecastOut, `${JSON.stringify(forecast, null, 2)}\n`);
const peak = forecast.entries.reduce((a, b) =>
  b.carbonIntensityGCo2PerKwh > a.carbonIntensityGCo2PerKwh ? b : a,
);
console.log(`forecast source: ${forecast.source} (${forecast.kind})`);
console.log(`forecast entries: ${forecast.entries.length} hourly, ${forecast.entries[0].datetime} .. ${forecast.entries.at(-1).datetime}`);
console.log(`forecast now:  ${forecast.entries[0].datetime}  ${forecast.entries[0].carbonIntensityGCo2PerKwh} gCO2/kWh`);
console.log(`forecast peak: ${peak.datetime}  ${peak.carbonIntensityGCo2PerKwh} gCO2/kWh`);

// 2. Non-committal recommendation for a 72h deadline (MCP `recommend_window`).
const deadline = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
const plan = await recommendWindow({ region: REGION, deadline, model: MODEL }, { feed });
console.log(`\nrecommendWindow({ region: "${REGION}", model: "${MODEL}", deadline: "${deadline}" }):`);
console.log(JSON.stringify(plan, null, 2));

// 3. Enqueue one real call with a 5-minute deadline (MCP `schedule_task`),
//    so `ebb tick` dispatches it now and signs a receipt.
const scheduler = new Scheduler({ dbPath, defaultRegion: REGION, feed });
const record = await scheduler.enqueueProviderCall(
  {
    type: "provider_call",
    provider: "ollama",
    model: MODEL,
    prompt: "In one sentence, explain why running AI inference when the grid is cleanest reduces carbon emissions.",
  },
  { region: REGION, deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString() },
);
scheduler.shutdown();
console.log("\nenqueueProviderCall(ollama/llama3.2:1b, deadline +5 min):");
console.log(JSON.stringify(record, null, 2));
console.log(`task_id=${record.taskId}`);
