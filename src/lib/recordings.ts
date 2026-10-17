// Recorded runs: a real pipeline run saved event by event (with timings), replayed when the model is unavailable.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { TraceEvent } from "./agents";

export type Recording = {
  exampleId: string;
  story: string;
  recordedAt: string;
  models: string[];
  totalMs: number;
  events: { t: number; event: TraceEvent }[]; // t = ms since the run started
};

const DIR = path.join(process.cwd(), "recordings");

export function loadRecording(exampleId: string): Recording | null {
  if (!/^[a-z0-9-]+$/.test(exampleId)) return null;
  const file = path.join(DIR, `${exampleId}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Recording) : null;
}

export function recordedIds(): string[] {
  return existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")) : [];
}
