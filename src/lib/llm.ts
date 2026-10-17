// Gemini access for the agents: schema-constrained JSON (validated with zod) and plain text.
// Free-tier models are often overloaded (503) or rate limited (429), so each call walks a fallback
// chain of models, with one short retry per model, and reports which model answered.
import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";

export const MODELS = [...new Set([process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-2.5-flash", "gemini-3.5-flash-lite"].filter(Boolean) as string[])];

let client: GoogleGenAI | null = null;
function ai(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}

export type Usage = { agent: string; model: string; ms: number; inputTokens: number; outputTokens: number };

type CallOpts = { agent: string; system: string; prompt: string; temperature?: number; onUsage?: (u: Usage) => void };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 429 (quota) and 5xx (overload) are worth retrying or failing over; anything else is a real error
const transient = (e: unknown) => e instanceof ApiError && (e.status === 429 || e.status >= 500);

async function call(opts: CallOpts, jsonSchema?: unknown): Promise<string> {
  const t0 = Date.now();
  let last: unknown;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await ai().models.generateContent({
          model,
          contents: opts.prompt,
          config: {
            systemInstruction: opts.system,
            temperature: opts.temperature ?? 0.2,
            ...(jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema } : {}),
          },
        });
        opts.onUsage?.({
          agent: opts.agent,
          model,
          ms: Date.now() - t0,
          inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
        });
        const text = res.text;
        if (!text) throw new Error(`${opts.agent}: empty response (finish reason ${res.candidates?.[0]?.finishReason ?? "unknown"})`);
        return text;
      } catch (e) {
        if (!transient(e)) throw e;
        last = e;
        if (attempt === 0) await sleep(1_500);
      }
    }
  }
  throw last;
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
