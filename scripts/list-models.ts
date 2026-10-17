// Lists Gemini models available to the configured key (never prints the key).
import { GoogleGenAI } from "@google/genai";
const key = process.env.GEMINI_API_KEY ?? "";
console.log(`key present: ${key.length > 0}, starts with AIza: ${key.startsWith("AIza")}, length: ${key.length}`);
const ai = new GoogleGenAI({ apiKey: key });
const names: string[] = [];
for await (const m of await ai.models.list()) if (m.name && /gemini/.test(m.name) && m.supportedActions?.includes("generateContent")) names.push(m.name.replace("models/", ""));
console.log(names.filter((n) => /flash|pro/.test(n)).join("\n"));
