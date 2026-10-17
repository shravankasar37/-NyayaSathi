// Embeds every corpus chunk with the configured provider (EMBED_PROVIDER) and writes corpus/embeddings.<provider>.bin
// (Float32, row-major, CHUNKS order) plus a .meta.json so the runtime can check the index matches the corpus.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CHUNKS } from "../src/lib/corpus";
import { embedPassages, EMBED_DIM, EMBED_MODEL, EMBED_PROVIDER, INDEX_FILE } from "../src/lib/embed";

const BATCH = EMBED_PROVIDER === "gemini" ? 50 : 32;
const out = new Float32Array(CHUNKS.length * EMBED_DIM);
const t0 = Date.now();
for (let i = 0; i < CHUNKS.length; i += BATCH) {
  const vecs = await embedPassages(CHUNKS.slice(i, i + BATCH).map((c) => c.text));
  vecs.forEach((v, j) => out.set(v, (i + j) * EMBED_DIM));
  if ((i / BATCH) % 10 === 0) console.log(`${i + vecs.length}/${CHUNKS.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
writeFileSync(`corpus/${INDEX_FILE}`, Buffer.from(out.buffer));
const corpusHash = createHash("sha256").update(CHUNKS.map((c) => c.id + c.text).join("\n")).digest("hex").slice(0, 16);
writeFileSync(`corpus/${INDEX_FILE.replace(".bin", ".meta.json")}`, JSON.stringify({ provider: EMBED_PROVIDER, model: EMBED_MODEL, dim: EMBED_DIM, count: CHUNKS.length, corpusHash }, null, 1));
console.log(`done: ${CHUNKS.length} chunks in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
