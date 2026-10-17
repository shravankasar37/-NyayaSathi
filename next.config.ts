import type { NextConfig } from "next";

const config: NextConfig = {
  // onnxruntime-node and transformers.js load native binaries and model files at runtime
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  outputFileTracingIncludes: { "/api/run": ["./corpus/embeddings.bin"] },
};

export default config;
