// Measures what the research agent's query rewriting adds to retrieval: for each query in
// evals/retrieval.json, hybrid search on the user's own words vs. on the user's words plus the
// agent's rewritten legal queries (rankings fused with RRF). Needs GEMINI_API_KEY.
import { readFileSync, writeFileSync } from "node:fs";
import { rewriteQueries } from "../src/lib/agents";
import { search, type Hit } from "../src/lib/retrieval";

type Case = { q: string; gold: string[] };
const cases: Case[] = JSON.parse(readFileSync("evals/retrieval.json", "utf8"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fuse(lists: Hit[][], k = 10): string[] {
  const score = new Map<string, number>();
  for (const l of lists) l.forEach((h, i) => score.set(h.section.id, (score.get(h.section.id) ?? 0) + 1 / (60 + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

const stats = { base: { r1: 0, r3: 0, r5: 0, r10: 0, mrr: 0 }, agentic: { r1: 0, r3: 0, r5: 0, r10: 0, mrr: 0 } };
const rows: { q: string; queries: string[]; baseRank: number; agenticRank: number }[] = [];
const add = (s: typeof stats.base, rank: number) => {
  if (rank === 1) s.r1++;
  if (rank && rank <= 3) s.r3++;
  if (rank && rank <= 5) s.r5++;
  if (rank) { s.r10++; s.mrr += 1 / rank; }
};
const rankIn = (ids: string[], gold: string[]) => ids.findIndex((id) => gold.includes(id)) + 1;

for (const [n, c] of cases.entries()) {
  const base = await search(c.q, { k: 10 });
  const rw = await rewriteQueries(`User's problem: ${c.q}`, () => {});
  const lists = [base, ...(await Promise.all(rw.queries.map((q) => search(q, { k: 10 }))))];
  const baseRank = rankIn(base.map((h) => h.section.id), c.gold);
  const agenticRank = rankIn(fuse(lists), c.gold);
  add(stats.base, baseRank);
  add(stats.agentic, agenticRank);
  rows.push({ q: c.q, queries: rw.queries, baseRank, agenticRank });
  console.log(`${String(n + 1).padStart(2)}. base ${baseRank || "-"} -> agentic ${agenticRank || "-"}  ${c.q.slice(0, 60)}`);
  await sleep(1500); // stay inside free-tier requests per minute
}

const pct = (x: number) => `${((x / cases.length) * 100).toFixed(1)}%`;
console.log("\n                         R@1     R@3     R@5     R@10    MRR@10");
for (const [name, s] of Object.entries(stats)) {
  console.log(`${(name === "base" ? "hybrid, user's words" : "hybrid + agent rewrite").padEnd(24)} ${pct(s.r1).padEnd(7)} ${pct(s.r3).padEnd(7)} ${pct(s.r5).padEnd(7)} ${pct(s.r10).padEnd(7)} ${(s.mrr / cases.length).toFixed(3)}`);
}
writeFileSync("evals/rewrite-results.json", JSON.stringify({ n: cases.length, at: new Date().toISOString(), stats, rows }, null, 1));
