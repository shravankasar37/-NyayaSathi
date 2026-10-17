// Records a real pipeline run of each example into recordings/<id>.json for replay.
//   node --env-file=.env.local --import tsx scripts/record.ts            all examples without a recording
//   node --env-file=.env.local --import tsx scripts/record.ts upi-fraud  just these (re-records)
// Runs one example at a time: the free tier's quota does not survive parallel runs.
import { mkdirSync, writeFileSync } from "node:fs";
import { runPipeline, type TraceEvent } from "../src/lib/agents";
import { EXAMPLES } from "../src/lib/examples";
import { recordedIds, type Recording } from "../src/lib/recordings";

const wanted = process.argv.slice(2);
const have = new Set(recordedIds());
const todo = EXAMPLES.filter((e) => (wanted.length ? wanted.includes(e.id) : !have.has(e.id)));
mkdirSync("recordings", { recursive: true });

for (const ex of todo) {
  const t0 = Date.now();
  const events: Recording["events"] = [];
  const models = new Set<string>();
  let failed = "";
  await runPipeline(ex.text, (event: TraceEvent) => {
    events.push({ t: Date.now() - t0, event });
    if (event.type === "usage") models.add(event.usage.model);
    if (event.type === "error") failed = event.message;
  }).catch((e) => { failed = String(e); });
  const last = events.at(-1)?.event.type;
  if (failed || !last || !["result", "abstain", "clarify"].includes(last)) {
    console.log(`✗ ${ex.id}: not saved (${failed || `ended with ${last}`})`);
    continue;
  }
  const rec: Recording = { exampleId: ex.id, story: ex.text, recordedAt: new Date().toISOString(), models: [...models], totalMs: Date.now() - t0, events };
  writeFileSync(`recordings/${ex.id}.json`, JSON.stringify(rec, null, 1));
  console.log(`✓ ${ex.id}: ${last}, ${events.length} events, ${(rec.totalMs / 1000).toFixed(0)}s, models ${rec.models.join(", ")}`);
}
