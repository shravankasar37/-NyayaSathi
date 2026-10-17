// Downloads the embedding model into the image at build time so the server never fetches it at runtime.
import { env, pipeline } from "@huggingface/transformers";

env.cacheDir = process.env.NYAYA_MODEL_CACHE ?? ".cache/models";
const ex = await pipeline("feature-extraction", "Xenova/multilingual-e5-small", { dtype: "q8" });
const out = await ex(["query: test"], { pooling: "mean", normalize: true });
console.log(`embedding model ready in ${env.cacheDir} (dim ${out.dims.at(-1)})`);
