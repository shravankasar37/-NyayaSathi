// Gemini access for the agents: schema-constrained JSON (validated with zod) and plain text,
// with retry/backoff for the free tier's rate limits and per-call usage for the trace.
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export type Usage = { agent: string; ms: number; inputTokens: number; outputTokens: number };

type CallOpts = { agent: string; system: string; prompt: string; temperature?: number; onUsage?: (u: Usage) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(opts: CallOpts, jsonSchema?: unknown): Promise<string> {
  const t0 = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await ai().models.generateContent({
        model: MODEL,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0.2,
          ...(jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema } : {}),
        },
      });
      opts.onUsage?.({
        agent: opts.agent,
        ms: Date.now() - t0,
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
      });
      const text = res.text;
      if (!text) throw new Error(`${opts.agent}: empty response (finish reason ${res.candidates?.[0]?.finishReason ?? "unknown"})`);
      return text;
    } catch (e) {
      // 429 (free-tier quota) and 5xx are transient; everything else is a real error
      const retryable = e instanceof ApiError && (e.status === 429 || e.status >= 500);
      if (!retryable || attempt >= 4) throw e;
      await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    }
  }
}

/** Calls the model with a JSON schema derived from `schema`; validates the result, re-asking once on a mismatch. */
export async function generateJson<T>(schema: z.ZodType<T>, opts: CallOpts): Promise<T> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-2020-12" });
  let prompt = opts.prompt;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await call({ ...opts, prompt }, jsonSchema);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const r = schema.safeParse(parsed);
    if (r.success) return r.data;
    prompt = `${opts.prompt}\n\nYour previous reply did not match the required JSON schema (${r.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ")}). Reply again with valid JSON only.`;
  }
  throw new Error(`${opts.agent}: model output did not match the schema twice`);
}

export const generateText = (opts: CallOpts) => call(opts);
