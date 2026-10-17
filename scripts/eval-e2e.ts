// End-to-end eval of full pipeline runs over evals/e2e.json:
//   issue classification accuracy, abstention on out-of-scope matters, coverage of the must-cite procedure section,
//   citation validity (code check) and support (verifier), invented facts left after revision, latency and cost.
// Needs GEMINI_API_KEY. Each case is a full multi-agent run (about a minute on the free tier).
import { readFileSync, writeFileSync } from "node:fs";
import { runPipeline, type Result, type TraceEvent } from "../src/lib/agents";

type Case = { story: string; issue: string; mustCite: string[] };
const cases: Case[] = JSON.parse(readFileSync("evals/e2e.json", "utf8"));
// free tiers meter tokens per minute; a pause between cases gives each run a fresh budget
const PAUSE_MS = Number(process.env.EVAL_PAUSE_MS ?? 60_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Row = {
  story: string; expected: string; got: string; outcome: string; issueOk: boolean; mustCiteOk: boolean;
  citations: number; supported: number; invalidCitations: number; factIssues: number; revised: boolean;
  seconds: number; calls: number; tokens: number; error: string;
};
const rows: Row[] = [];
for (const [n, c] of cases.entries()) {
  if (n > 0) await sleep(PAUSE_MS);
  const t0 = Date.now();
  let result: Result | null = null;
  let outcome = "error";
  let issue = "";
  let calls = 0, tokens = 0, error = "";
  await runPipeline(c.story, (e: TraceEvent) => {
    if (e.type === "usage") { calls++; tokens += e.usage.inputTokens + e.usage.outputTokens; }
    else if (e.type === "result") { result = e.result; outcome = "draft"; issue = e.result.intake.issueType; }
    else if (e.type === "abstain") outcome = "abstain";
    else if (e.type === "clarify") { outcome = "clarify"; issue = e.intake.issueType; }
    else if (e.type === "error") error = e.message;
  }).catch((e) => { error = String(e); });
  const r = result as Result | null;
  const cited = r ? [...new Set([...r.draft.body.matchAll(/\[\[([A-Z]+-\d+[A-Z]{0,2})\]\]/g)].map((m) => m[1]))] : [];
  const row = {
    story: c.story.slice(0, 70),
    expected: c.issue,
    got: outcome === "abstain" && !issue ? "out_of_scope" : issue,
    outcome,
    issueOk: c.issue === "out_of_scope" ? outcome === "abstain" : issue === c.issue || (c.issue.startsWith("rti") && issue.startsWith("rti")),
    mustCiteOk: c.mustCite.every((id) => cited.includes(id)),
    citations: r?.verification.checks.length ?? 0,
    supported: r?.verification.checks.filter((x) => x.supported).length ?? 0,
    invalidCitations: r?.verification.codeIssues.filter((x) => /does not exist|not among/.test(x)).length ?? 0,
    factIssues: r?.verification.factIssues.length ?? 0,
    revised: r?.revised ?? false,
    seconds: (Date.now() - t0) / 1000,
    calls,
    tokens,
    error,
  };
  rows.push(row);
  console.log(`${String(n + 1).padStart(2)}. ${row.issueOk ? "✓" : "✗"} ${row.expected} -> ${row.got || row.outcome}  cite ${row.supported}/${row.citations}  must ${row.mustCiteOk ? "✓" : "✗"}  facts ${row.factIssues}  ${row.seconds.toFixed(0)}s ${row.error ? "ERR " + row.error.slice(0, 80) : ""}`);
}

const drafts = rows.filter((r) => r.outcome === "draft");
const inScope = rows.filter((r) => r.expected !== "out_of_scope");
const sum = (f: (r: (typeof rows)[number]) => number, of = rows) => of.reduce((a, r) => a + f(r), 0);
const summary = {
  cases: rows.length,
  issueAccuracy: sum((r) => +r.issueOk) / rows.length,
  outOfScopeAbstained: `${rows.filter((r) => r.expected === "out_of_scope" && r.outcome === "abstain").length}/${rows.filter((r) => r.expected === "out_of_scope").length}`,
  draftsProduced: `${drafts.length}/${inScope.length}`,
  mustCiteCoverage: sum((r) => +r.mustCiteOk, drafts) / Math.max(1, drafts.length),
  citationsSupported: `${sum((r) => r.supported, drafts)}/${sum((r) => r.citations, drafts)}`,
  invalidCitations: sum((r) => r.invalidCitations, drafts),
  draftsWithFactFlags: `${drafts.filter((r) => r.factIssues > 0).length}/${drafts.length}`,
  revisedByVerifier: `${drafts.filter((r) => r.revised).length}/${drafts.length}`,
  medianSeconds: drafts.map((r) => r.seconds).sort((a, b) => a - b)[Math.floor(drafts.length / 2)] ?? 0,
  avgCalls: sum((r) => r.calls, drafts) / Math.max(1, drafts.length),
  avgTokens: Math.round(sum((r) => r.tokens, drafts) / Math.max(1, drafts.length)),
};
console.log("\n" + JSON.stringify(summary, null, 1));
writeFileSync("evals/e2e-results.json", JSON.stringify({ at: new Date().toISOString(), summary, rows }, null, 1));
