// Embeds every corpus chunk and writes corpus/embeddings.bin (Float32, row-major, CHUNKS order)
// plus corpus/embeddings.meta.json so the runtime can check the index matches the corpus.
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { CHUNKS } from "../src/lib/corpus";
import { embedPassages, EMBED_DIM, EMBED_MODEL } from "../src/lib/embed";

const BATCH = 32;
const out = new Float32Array(CHUNKS.length * EMBED_DIM);
const t0 = Date.now();
for (let i = 0; i < CHUNKS.length; i += BATCH) {
  const vecs = await embedPassages(CHUNKS.slice(i, i + BATCH).map((c) => c.text));
  vecs.forEach((v, j) => out.set(v, (i + j) * EMBED_DIM));
  if ((i / BATCH) % 10 === 0) console.log(`${i + vecs.length}/${CHUNKS.length}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
writeFileSync("corpus/embeddings.bin", Buffer.from(out.buffer));
const corpusHash = createHash("sha256").update(CHUNKS.map((c) => c.id + c.text).join("\n")).digest("hex").slice(0, 16);
writeFileSync("corpus/embeddings.meta.json", JSON.stringify({ model: EMBED_MODEL, dim: EMBED_DIM, count: CHUNKS.length, corpusHash }, null, 1));
console.log(`done: ${CHUNKS.length} chunks in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
