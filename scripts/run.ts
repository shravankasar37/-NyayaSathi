// CLI: runs the pipeline on one story and prints the trace and result summary.
import { runPipeline, type TraceEvent } from "../src/lib/agents";
const story = process.argv.slice(2).join(" ");
let calls = 0, tokens = 0;
const t0 = Date.now();
await runPipeline(story, (e: TraceEvent) => {
  if (e.type === "step") console.log(`[${e.agent}:${e.status}] ${e.detail ?? ""}`);
  else if (e.type === "usage") { calls++; tokens += e.usage.inputTokens + e.usage.outputTokens; }
  else if (e.type === "result") {
    const r = e.result;
    console.log(`\nISSUE ${r.intake.issueType} | lang ${r.intake.language} | facts ${JSON.stringify(r.intake.facts)}`);
    console.log(`SELECTED ${r.selected.map((s) => s.id).join(", ")}`);
    console.log(`VERIFIED ok=${r.verification.ok} revised=${r.revised} code=${JSON.stringify(r.verification.codeIssues)} facts=${JSON.stringify(r.verification.factIssues)} checks=${r.verification.checks.map((c) => `${c.id}:${c.supported}`).join(" ")}`);
    console.log(`\n--- ${r.draft.documentTitle} ---\n${r.draft.body}\n\nSUMMARY: ${r.draft.plainSummary}`);
  } else console.log(JSON.stringify(e));
});
console.log(`\n${calls} model calls, ${tokens} tokens, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
