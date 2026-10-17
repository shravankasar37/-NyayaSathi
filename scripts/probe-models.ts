// Times one small structured call per model, to choose a free-tier model that is fast enough.
import { ApiError, GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
for (const model of process.argv.slice(2)) {
  const t0 = Date.now();
  try {
    const r = await ai.models.generateContent({ model, contents: "Classify: 'shop refuses refund for broken phone'. Reply JSON {\"issue\": string}", config: { responseMimeType: "application/json" } });
    console.log(`${model.padEnd(24)} ${String(Date.now() - t0).padStart(6)} ms  out=${r.usageMetadata?.candidatesTokenCount} thoughts=${r.usageMetadata?.thoughtsTokenCount ?? 0}  ${r.text?.slice(0, 50)}`);
  } catch (e) {
    console.log(`${model.padEnd(24)} ERROR ${e instanceof ApiError ? e.status : ""} ${String(e).slice(0, 140)}`);
  }
}
