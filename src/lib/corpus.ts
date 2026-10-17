// Legal corpus: one record per section of each bare act, plus the retrieval chunks derived from it.
import sections from "../../corpus/sections.json";

export type Section = {
  id: string; // "BNS-318"
  act: string; // "BNS"
  actName: string;
  section: string; // "318", "66D"
  title: string;
  text: string;
  source: string;
};

export type Chunk = {
  id: string; // "BNS-318#0"
  sectionId: string;
  text: string; // what is embedded and keyword-indexed (carries the act/section header)
};

export const SECTIONS = sections as Section[];
const BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export const getSection = (id: string) => BY_ID.get(id);

export const ACT_NAMES: Record<string, string> = Object.fromEntries(SECTIONS.map((s) => [s.act, s.actName]));

/** "BNS-318" -> "Section 318, Bharatiya Nyaya Sanhita, 2023" */
export function citeLabel(id: string): string {
  const s = BY_ID.get(id);
  return s ? `Section ${s.section}, ${s.actName}` : id;
}

const MAX_CHUNK = 1500; // ~400 tokens, inside multilingual-e5-small's 512-token window

/** Splits a section at sub-section starts ("(2) ...") so each chunk stays within the embedder's window. */
export function chunkSection(s: Section): Chunk[] {
  const header = `${s.actName}, section ${s.section}${s.title ? ` (${s.title})` : ""}.`;
  const parts = s.text.split(/\n(?=\(\d+[A-Z]?\)\s)/);
  const chunks: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length > MAX_CHUNK) {
      chunks.push(cur);
      cur = "";
    }
    // a single over-long sub-section is cut on line boundaries
    if (p.length > MAX_CHUNK) {
      for (const line of p.split("\n")) {
        if (cur.length + line.length > MAX_CHUNK && cur) {
          chunks.push(cur);
          cur = "";
        }
        cur += (cur ? "\n" : "") + line;
      }
    } else cur += (cur ? "\n" : "") + p;
  }
  if (cur) chunks.push(cur);
  return chunks.map((text, i) => ({ id: `${s.id}#${i}`, sectionId: s.id, text: `${header}\n${text}` }));
}

export const CHUNKS: Chunk[] = SECTIONS.flatMap(chunkSection);
