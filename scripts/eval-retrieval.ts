// Retrieval eval: Recall@k and MRR@10 for BM25, dense and hybrid over evals/retrieval.json.
// A query counts as a hit if any of its gold sections is in the top k. Before scoring, every gold label
// is checked against the section's real text, so a mislabelled query fails loudly instead of skewing results.
import { readFileSync, writeFileSync } from "node:fs";
import { getSection } from "../src/lib/corpus";
import { search, type Mode } from "../src/lib/retrieval";

type Case = { q: string; gold: string[]; check: Record<string, string> };
const cases: Case[] = JSON.parse(readFileSync("evals/retrieval.json", "utf8"));

let bad = 0;
for (const c of cases) {
  for (const [id, kw] of Object.entries(c.check)) {
    const s = getSection(id);
    if (!s) { console.error(`gold ${id} not in corpus  (${c.q})`); bad++; }
    else if (!s.text.replace(/\s+/g, " ").toLowerCase().includes(kw.toLowerCase())) { console.error(`gold ${id} text lacks "${kw}"  (${c.q})`); bad++; }
  }
}
if (bad) { console.error(`${bad} gold label problems`); process.exit(1); }
console.log(`${cases.length} queries, all gold labels verified against section text\n`);

const modes: Mode[] = ["bm25", "dense", "hybrid"];
const results: Record<string, { r1: number; r3: number; r5: number; r10: number; mrr: number; misses: string[] }> = {};
for (const mode of modes) {
  let r1 = 0, r3 = 0, r5 = 0, r10 = 0, mrr = 0;
  const misses: string[] = [];
  for (const c of cases) {
    const hits = (await search(c.q, { k: 10, mode })).map((h) => h.section.id);
    const rank = hits.findIndex((id) => c.gold.includes(id)) + 1;
    if (rank === 1) r1++;
    if (rank && rank <= 3) r3++;
    if (rank && rank <= 5) r5++;
    if (rank) { r10++; mrr += 1 / rank; } else misses.push(`${c.q.slice(0, 60)} -> got ${hits.slice(0, 3).join(",")}`);
  }
  const n = cases.length;
  results[mode] = { r1: r1 / n, r3: r3 / n, r5: r5 / n, r10: r10 / n, mrr: mrr / n, misses };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log("mode     R@1     R@3     R@5     R@10    MRR@10");
for (const m of modes) {
  const r = results[m];
  console.log(`${m.padEnd(8)} ${pct(r.r1).padEnd(7)} ${pct(r.r3).padEnd(7)} ${pct(r.r5).padEnd(7)} ${pct(r.r10).padEnd(7)} ${r.mrr.toFixed(3)}`);
}
console.log("\nhybrid misses (not in top 10):\n" + (results.hybrid.misses.join("\n") || "none"));
writeFileSync("evals/retrieval-results.json", JSON.stringify({ n: cases.length, at: new Date().toISOString(), results }, null, 1));
