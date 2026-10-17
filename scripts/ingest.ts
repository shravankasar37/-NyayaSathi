// Splits each act's extracted text (corpus/text/<act>.txt, from scripts/extract.ts) into one record per
// section and writes corpus/sections.json. Section starts must follow the act's numbering in order, so
// stray lines that merely begin with a number are not mistaken for sections; gaps are reported.
import { readFileSync, writeFileSync } from "node:fs";

export type Section = {
  id: string; // e.g. "BNS-318"
  act: string;
  actName: string;
  section: string; // "318", "66D"
  title: string;
  text: string;
  source: string;
};

type ActSpec = {
  act: string;
  actName: string;
  file: string;
  source: string;
  lastSection: number;
  // "gazette": margin heading on its own line before "N. (1) ..."; "inline": "N. Title.–text"
  style: "gazette" | "inline";
  // the body starts at this occurrence of the "1." line (skips an arrangement-of-sections list)
  bodyStartOccurrence: number;
};

const ACTS: ActSpec[] = [
  { act: "BNS", actName: "Bharatiya Nyaya Sanhita, 2023", file: "bns", lastSection: 358, style: "gazette", bodyStartOccurrence: 1,
    source: "https://prsindia.org/files/bills_acts/bills_parliament/2023/The%20Bharatiya%20Nyaya%20Sanhita,%202023.pdf" },
  { act: "BNSS", actName: "Bharatiya Nagarik Suraksha Sanhita, 2023", file: "bnss", lastSection: 531, style: "gazette", bodyStartOccurrence: 1,
    source: "https://prsindia.org/files/bills_acts/bills_parliament/2023/The%20Bharatiya%20Nagarik%20Suraksha%20Sanhita,%202023.pdf" },
  { act: "CPA", actName: "Consumer Protection Act, 2019", file: "cpa", lastSection: 107, style: "gazette", bodyStartOccurrence: 1,
    source: "https://prsindia.org/files/bills_acts/bills_parliament/2021/Consumer%20Protection%20Act%202019.pdf" },
  { act: "RTI", actName: "Right to Information Act, 2005", file: "rti", lastSection: 31, style: "inline", bodyStartOccurrence: 1,
    source: "https://prsindia.org/files/bills_acts/acts_parliament/2005/the-right-to-information-act-2005.pdf" },
  { act: "IT", actName: "Information Technology Act, 2000", file: "it", lastSection: 94, style: "inline", bodyStartOccurrence: 2,
    source: "https://prsindia.org/files/bills_acts/bills_parliament/2021/IT%20Act,%202000.pdf" },
];

// optional footnote marker for amended sections ("2[15. ..."); no space needed after the dot ("192.Whoever")
const START = /^(?:\d{0,2}\[)?(\d{1,3})([A-Z]{0,2})\.\s*([^\d\s].*)$/;

// Is `cand` an acceptable next section after `prev`? Allows lettered insertions (66, 66A, 66B...)
// and small jumps for omitted sections.
function isNext(prev: { n: number; s: string }, cand: { n: number; s: string }): boolean {
  if (cand.n === prev.n) return cand.s > prev.s && cand.s.length >= prev.s.length && cand.s !== "";
  return cand.n > prev.n && cand.n <= prev.n + 3;
}

function marginHeading(lines: string[], i: number): string {
  // Gazette PDFs print the section title as a short margin note just above the section's first line.
  const prev = (lines[i - 1] ?? "").trim();
  const letters = prev.replace(/[^A-Za-z]/g, "");
  const allCaps = letters.length > 3 && letters === letters.toUpperCase(); // chapter headings, not titles
  if (prev.length > 2 && prev.length < 90 && /^[A-Z]/.test(prev) && !allCaps && !/[,;:—–-]$/.test(prev) && !START.test(prev)) {
    return prev.replace(/\.$/, "");
  }
  return "";
}

// page furniture that the PDF text layer interleaves with the law itself
const NOISE = [
  /^--\s*\d+\s+of\s+\d+\s*--$/,
  /THE GAZETTE OF INDIA/i,
  /^\[?\s*P\s?ART II/i,
  /^SEC\.\s*1\]/i,
  /^\d{1,3}$/,
];

function parseAct(spec: ActSpec): { sections: Section[]; gaps: string[] } {
  const lines = readFileSync(`corpus/text/${spec.file}.txt`, "utf8")
    .split(/\r?\n/)
    .filter((l) => !NOISE.some((re) => re.test(l.trim())));
  let begin = -1;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = START.exec(lines[i].trim());
    if (m && m[1] === "1" && m[2] === "" && ++seen === spec.bodyStartOccurrence) { begin = i; break; }
  }
  if (begin < 0) throw new Error(`${spec.act}: body start not found`);

  const starts: { line: number; n: number; s: string; rest: string }[] = [];
  let prev = { n: 0, s: "" };
  for (let i = begin; i < lines.length; i++) {
    const m = START.exec(lines[i].trim());
    if (!m) continue;
    const cand = { n: Number(m[1]), s: m[2] };
    // a margin-heading duplicate ("318. (1) ..." printed twice) keeps the first occurrence
    if (cand.n === prev.n && cand.s === prev.s) continue;
    if (starts.length === 0 ? cand.n === 1 : isNext(prev, cand)) {
      starts.push({ line: i, n: cand.n, s: cand.s, rest: m[3] });
      prev = cand;
      if (cand.n === spec.lastSection && cand.s === "") {
        // stop scanning numbered lines inside schedules after the last section starts
      }
    }
  }

  const sections: Section[] = [];
  const gaps: string[] = [];
  for (let k = 0; k < starts.length; k++) {
    const st = starts[k];
    const end = k + 1 < starts.length ? starts[k + 1].line : Math.min(lines.length, st.line + 400);
    let body = lines.slice(st.line, end);
    // drop the next section's margin heading, which sits on the line just before it
    if (spec.style === "gazette" && k + 1 < starts.length && marginHeading(lines, starts[k + 1].line)) body = body.slice(0, -1);
    let title = "";
    if (spec.style === "gazette") title = marginHeading(lines, st.line);
    else {
      const t = /^(.+?\.)\s*[-–—]+\s*/.exec(st.rest) ?? /^(.+?\.)$/.exec(st.rest);
      if (t) title = t[1].replace(/\.$/, "");
    }
    const text = body.join("\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const section = `${st.n}${st.s}`;
    sections.push({ id: `${spec.act}-${section}`, act: spec.act, actName: spec.actName, section, title, text, source: spec.source });
    if (k > 0) {
      const p = starts[k - 1];
      if (st.s === "" && st.n !== p.n + 1) gaps.push(`${p.n + 1}${st.n - 1 > p.n + 1 ? "-" + (st.n - 1) : ""}`);
    }
  }
  const last = starts[starts.length - 1];
  if (last && last.n < spec.lastSection) gaps.push(`${last.n + 1}-${spec.lastSection} (tail)`);
  return { sections, gaps };
}

const all: Section[] = [];
for (const spec of ACTS) {
  const { sections, gaps } = parseAct(spec);
  const untitled = sections.filter((s) => !s.title).length;
  console.log(`${spec.act.padEnd(5)} ${String(sections.length).padStart(4)} sections  untitled ${untitled}  gaps: ${gaps.join(", ") || "none"}`);
  all.push(...sections);
}
writeFileSync("corpus/sections.json", JSON.stringify(all, null, 1));
console.log(`total ${all.length} sections -> corpus/sections.json`);
