// Hybrid retrieval over the legal corpus: BM25 keyword search + dense vectors (see embed.ts),
// fused with Reciprocal Rank Fusion and aggregated from chunks to sections.
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHUNKS, getSection, type Section } from "./corpus";
import { embedQuery, EMBED_DIM, INDEX_FILE } from "./embed";

// ---------- BM25 ----------
const STOP = new Set(
  "a an and are as at be by for from has have he her his i in is it its me my of on or our she that the their them they this to was were which who will with shall may any such under section act".split(" "),
);
export const tokenize = (s: string) =>
  s.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 && !STOP.has(t));

const K1 = 1.4;
const B = 0.75;
const docTokens = CHUNKS.map((c) => tokenize(c.text));
const avgLen = docTokens.reduce((n, d) => n + d.length, 0) / docTokens.length;
const df = new Map<string, number>();
const tf = docTokens.map((toks) => {
  const m = new Map<string, number>();
  for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
  for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  return m;
});
const idf = (t: string) => {
  const n = df.get(t) ?? 0;
  return Math.log(1 + (CHUNKS.length - n + 0.5) / (n + 0.5));
};

function bm25(query: string): number[] {
  const q = [...new Set(tokenize(query))];
  return tf.map((m, i) => {
    let s = 0;
    for (const t of q) {
      const f = m.get(t);
      if (!f) continue;
      s += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * docTokens[i].length) / avgLen)));
    }
    return s;
  });
}

// ---------- dense ----------
let vectors: Float32Array | null = null;
function loadVectors(): Float32Array {
  if (vectors) return vectors;
  const buf = readFileSync(path.join(process.cwd(), "corpus", INDEX_FILE));
  vectors = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  if (vectors.length !== CHUNKS.length * EMBED_DIM) {
    throw new Error(`corpus/${INDEX_FILE} does not match the corpus; run "npm run embed"`);
  }
  return vectors;
}

async function dense(query: string): Promise<number[]> {
  const q = await embedQuery(query);
  const v = loadVectors();
  return CHUNKS.map((_, i) => {
    let dot = 0;
    const o = i * EMBED_DIM;
    for (let d = 0; d < EMBED_DIM; d++) dot += q[d] * v[o + d];
    return dot; // both sides are L2-normalised: cosine similarity
  });
}

// ---------- fusion ----------
const RRF_K = 60;
const rankOf = (scores: number[]) => {
  const order = scores.map((s, i) => [s, i] as const).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]);
  const r = new Map<number, number>();
  order.forEach(([, i], k) => r.set(i, k + 1));
  return r;
};

export type Mode = "hybrid" | "bm25" | "dense";
export type Hit = { section: Section; score: number; chunkText: string };

export async function search(query: string, opts: { k?: number; acts?: string[]; mode?: Mode } = {}): Promise<Hit[]> {
  const { k = 8, acts, mode = "hybrid" } = opts;
  const lists: Map<number, number>[] = [];
  if (mode !== "dense") lists.push(rankOf(bm25(query)));
  if (mode !== "bm25") {
    try {
      lists.push(rankOf(await dense(query)));
    } catch (e) {
      // embedding service down or out of quota: keep answering from keywords alone
      if (mode === "dense") throw e;
      console.warn(`dense retrieval unavailable, using BM25 only: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
    }
  }

  const chunkScore = new Map<number, number>();
  for (const ranks of lists) for (const [i, r] of ranks) chunkScore.set(i, (chunkScore.get(i) ?? 0) + 1 / (RRF_K + r));

  // a section scores as its best chunk; remember that chunk for the prompt
  const best = new Map<string, { score: number; idx: number }>();
  for (const [i, s] of chunkScore) {
    const sid = CHUNKS[i].sectionId;
    if (acts?.length && !acts.includes(sid.split("-")[0])) continue;
    const cur = best.get(sid);
    if (!cur || s > cur.score) best.set(sid, { score: s, idx: i });
  }
  return [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, k)
    .map(([sid, { score, idx }]) => ({ section: getSection(sid)!, score, chunkText: CHUNKS[idx].text }));
}
