// Local multilingual sentence embeddings (no API key, works offline): multilingual-e5-small, int8 ONNX.
// e5 models expect "query: " / "passage: " prefixes.
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

export const EMBED_MODEL = "Xenova/multilingual-e5-small";
export const EMBED_DIM = 384;

env.cacheDir = process.env.NYAYA_MODEL_CACHE ?? ".cache/models";

// pipeline()'s overload union is too large for tsc (TS2590); this is the one overload we use
const featureExtraction = pipeline as unknown as (task: "feature-extraction", model: string, opts: { dtype: "q8" }) => Promise<FeatureExtractionPipeline>;

let extractor: Promise<FeatureExtractionPipeline> | null = null;
function getExtractor() {
  extractor ??= featureExtraction("feature-extraction", EMBED_MODEL, { dtype: "q8" });
  return extractor;
}

async function embed(texts: string[]): Promise<Float32Array[]> {
  const ex = await getExtractor();
  const out = await ex(texts, { pooling: "mean", normalize: true });
  const data = out.data as Float32Array;
  return texts.map((_, i) => data.slice(i * EMBED_DIM, (i + 1) * EMBED_DIM));
}

export const embedPassages = (texts: string[]) => embed(texts.map((t) => `passage: ${t}`));
export const embedQuery = async (text: string) => (await embed([`query: ${text}`]))[0];
