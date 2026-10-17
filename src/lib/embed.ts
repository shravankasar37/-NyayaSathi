// Sentence embeddings for retrieval, from one of two providers (EMBED_PROVIDER):
//   gemini (default) - Gemini embedding API, free tier; keeps the server small enough for a 512 MB host
//   local            - multilingual-e5-small int8 ONNX via transformers.js; offline, no key, ~420 MB of RAM
// Each provider has its own index file (corpus/embeddings.<provider>.bin), built by `npm run embed`.
import { ApiError, GoogleGenAI } from "@google/genai";

export const EMBED_PROVIDER = (process.env.EMBED_PROVIDER === "local" ? "local" : "gemini") as "gemini" | "local";
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-2";
const LOCAL_MODEL = "Xenova/multilingual-e5-small";

export const EMBED_MODEL = EMBED_PROVIDER === "gemini" ? GEMINI_EMBED_MODEL : LOCAL_MODEL;
export const EMBED_DIM = EMBED_PROVIDER === "gemini" ? 768 : 384;
export const INDEX_FILE = `embeddings.${EMBED_PROVIDER}.bin`;

// ---------- gemini ----------
let genai: GoogleGenAI | null = null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function l2normalize(v: number[]): Float32Array {
  // truncated (768-d) Gemini embeddings are not unit length; cosine via dot product needs them to be
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Float32Array.from(v, (x) => x / n);
}

async function geminiEmbed(texts: string[], taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"): Promise<Float32Array[]> {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set (needed for EMBED_PROVIDER=gemini)");
  genai ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  for (let attempt = 0; ; attempt++) {
    try {
      // one Content per text: gemini-embedding-2 merges a bare string array into a single embedding
      const contents = texts.map((text) => ({ role: "user", parts: [{ text }] }));
      const r = await genai.models.embedContent({ model: GEMINI_EMBED_MODEL, contents, config: { taskType, outputDimensionality: EMBED_DIM } });
      const out = (r.embeddings ?? []).map((e) => l2normalize(e.values ?? []));
      if (out.length !== texts.length || out.some((v) => v.length !== EMBED_DIM)) throw new Error("embedding response has the wrong shape");
      return out;
    } catch (e) {
      const transient = e instanceof ApiError && (e.status === 429 || e.status >= 500);
      if (!transient || attempt >= 5) throw e;
      await sleep(Math.min(60_000, 3_000 * 2 ** attempt));
    }
  }
}

// ---------- local ----------
type Extractor = (texts: string[], opts: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>;
let extractor: Promise<Extractor> | null = null;

async function localEmbed(texts: string[]): Promise<Float32Array[]> {
  extractor ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = process.env.NYAYA_MODEL_CACHE ?? ".cache/models";
    // pipeline()'s overload union is too large for tsc (TS2590); this is the one overload we use
    const load = pipeline as unknown as (task: "feature-extraction", model: string, opts: object) => Promise<Extractor>;
    return load("feature-extraction", LOCAL_MODEL, { dtype: "q8", session_options: { enableCpuMemArena: false, intraOpNumThreads: 1 } });
  })();
  const out = await (await extractor)(texts, { pooling: "mean", normalize: true });
  return texts.map((_, i) => out.data.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM));
}

// e5 models expect "query: " / "passage: " prefixes; Gemini takes a task type instead
export const embedPassages = (texts: string[]) =>
  EMBED_PROVIDER === "gemini" ? geminiEmbed(texts, "RETRIEVAL_DOCUMENT") : localEmbed(texts.map((t) => `passage: ${t}`));
export const embedQuery = async (text: string) =>
  (EMBED_PROVIDER === "gemini" ? await geminiEmbed([text], "RETRIEVAL_QUERY") : await localEmbed([`query: ${text}`]))[0];
