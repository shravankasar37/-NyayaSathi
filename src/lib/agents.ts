// The NyayaSathi pipeline. Four agents, orchestrated in code:
//   1. Intake      - reads the citizen's story, classifies the issue, extracts facts, asks for anything critical
//   2. Researcher  - rewrites the story into legal search queries, runs hybrid retrieval, picks the sections
//                    that apply (only from what was retrieved), and searches again if coverage is thin
//   3. Drafter     - writes the ready-to-file document, citing sections only as [[ACT-N]] markers
//   4. Verifier    - code checks every citation exists and was selected; the model checks each cited
//                    claim against the section text; unsupported claims go back to the drafter once
// Forum, deadlines and escalation come from the rules engine, never from the model.
import { z } from "zod";
import { citeLabel, getSection, type Section } from "./corpus";
import { generateJson, type Usage } from "./llm";
import { search } from "./retrieval";
import { FREE_LEGAL_AID, rulesFor, type IssueType, type RuleResult } from "./rules";

export type TraceEvent =
  | { type: "step"; agent: string; status: "start" | "done"; detail?: string }
  | { type: "usage"; usage: Usage }
  | { type: "result"; result: Result }
  | { type: "clarify"; questions: string[]; intake: Intake }
  | { type: "abstain"; reason: string; help: string[] }
  | { type: "error"; message: string };

const ISSUE_TYPES = ["consumer_complaint", "rti_application", "rti_first_appeal", "police_complaint", "cyber_fraud", "out_of_scope"] as const;

const DOC_TITLES: Record<IssueType, string> = {
  consumer_complaint: "Consumer complaint to the District Consumer Disputes Redressal Commission",
  rti_application: "Application for information under the Right to Information Act, 2005",
  rti_first_appeal: "First appeal under the Right to Information Act, 2005",
  police_complaint: "Complaint to the Officer in Charge of the Police Station for registration of an FIR",
  cyber_fraud: "Complaint of cyber fraud for registration of an FIR",
};

// ---------------- 1. Intake ----------------
const IntakeSchema = z.object({
  language: z.enum(["en", "hi", "mr"]).describe("language the user wrote in"),
  issueType: z.enum(ISSUE_TYPES),
  summary: z.string().describe("two-sentence neutral summary of the problem, in English"),
  facts: z.object({
    incidentDate: z.string().nullable().describe("YYYY-MM-DD if a date is stated or clearly derivable, else null"),
    amount: z.number().nullable().describe("amount paid or lost in rupees, else null"),
    oppositeParty: z.string().nullable().describe("who the complaint is against"),
    place: z.string().nullable().describe("city/district and state if stated"),
    applicationDate: z.string().nullable().describe("for RTI: YYYY-MM-DD the application was filed, else null"),
    lifeOrLiberty: z.boolean().describe("RTI information concerns someone's life or liberty"),
    reliefWanted: z.string().nullable().describe("what the user wants: refund, replacement, information, FIR..."),
  }),
  missingCritical: z.array(z.string()).max(3).describe("questions to ask only if the document cannot be drafted without the answer"),
  urgentDanger: z.boolean().describe("someone is in immediate physical danger"),
});
export type Intake = z.infer<typeof IntakeSchema>;

const INTAKE_SYSTEM = `You are the intake officer of NyayaSathi, a free legal-aid assistant for Indian citizens.
Read the user's description (it may be in English, Hindi or Marathi) and fill the schema.
Issue types: consumer_complaint (defective goods, deficient service, unfair trade practice by a seller or service provider);
rti_application (wants information from a government body); rti_first_appeal (already applied under RTI and got no or an unsatisfactory reply);
police_complaint (a crime such as theft, cheating, threats, assault, harassment, where an FIR is needed);
cyber_fraud (online or phone fraud, hacking, impersonation, UPI/OTP scams); out_of_scope (anything else, for example family, property, tenancy, employment or tax disputes).
Never invent facts. Use null when a fact is not stated. Only list a missing question if the document truly cannot be written without it; placeholders like [your address] are fine for personal details.`;

export async function intakeAgent(story: string, onUsage: (u: Usage) => void): Promise<Intake> {
  return generateJson(IntakeSchema, {
    agent: "intake",
    system: INTAKE_SYSTEM,
    prompt: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nUser's description:\n"""${story}"""`,
    temperature: 0,
    onUsage,
  });
}

// ---------------- 2. Researcher ----------------
const QuerySchema = z.object({
  queries: z.array(z.string()).min(2).max(4).describe("search queries in the vocabulary of Indian statutes"),
  acts: z.array(z.enum(["BNS", "BNSS", "CPA", "RTI", "IT"])).min(1).describe("acts most likely to apply"),
});
const SelectSchema = z.object({
  selected: z
    .array(z.object({ id: z.string().describe("section id exactly as given, e.g. BNS-318"), why: z.string().describe("one sentence: how it applies to these facts") }))
    .max(6),
  enough: z.boolean().describe("the selected sections cover the offence/right AND the procedure to use it"),
  followUpQuery: z.string().nullable().describe("if not enough: one more search query for what is missing"),
});
export type Selected = { section: Section; why: string };

const ACT_GUIDE = `Corpus: BNS = Bharatiya Nyaya Sanhita 2023 (offences, replaced IPC); BNSS = Bharatiya Nagarik Suraksha Sanhita 2023 (police and court procedure, FIR, bail; replaced CrPC);
CPA = Consumer Protection Act 2019; RTI = Right to Information Act 2005; IT = Information Technology Act 2000 (cyber offences).`;

async function retrieveAll(queries: string[], acts: string[]) {
  const pool = new Map<string, { section: Section; score: number; chunkText: string }>();
  for (const q of queries) {
    for (const h of await search(q, { k: 6, acts })) {
      const cur = pool.get(h.section.id);
      if (!cur || h.score > cur.score) pool.set(h.section.id, h);
    }
  }
  return [...pool.values()].sort((a, b) => b.score - a.score).slice(0, 14);
}

export async function researchAgent(intake: Intake, emit: (e: TraceEvent) => void, onUsage: (u: Usage) => void): Promise<{ selected: Selected[]; queries: string[] }> {
  const q = await generateJson(QuerySchema, {
    agent: "research.rewrite",
    system: `You turn a citizen's problem into precise legal search queries for Indian bare acts. Use statutory vocabulary (for example "snatching", "mischief", "cheating by personation", "deficiency in service", "officer in charge of a police station refuses to record information"), not the user's words. Cover both the substantive right or offence and the procedure to enforce it.\n${ACT_GUIDE}`,
    prompt: `Issue type: ${intake.issueType}\nSummary: ${intake.summary}\nFacts: ${JSON.stringify(intake.facts)}`,
    temperature: 0,
    onUsage,
  });
  const queries = [...q.queries];
  emit({ type: "step", agent: "research", status: "start", detail: `Searching: ${queries.map((x) => `"${x}"`).join(", ")}` });

  let candidates = await retrieveAll(queries, q.acts);
  let picked: Selected[] = [];
  for (let round = 0; round < 2; round++) {
    const list = candidates.map((c) => `[${c.section.id}] ${citeLabel(c.section.id)}${c.section.title ? ` - ${c.section.title}` : ""}\n${c.chunkText.slice(0, 900)}`).join("\n\n");
    const sel = await generateJson(SelectSchema, {
      agent: "research.select",
      system: `You are a careful Indian legal researcher. From the CANDIDATE sections only, choose the ones that actually apply to the facts (offence or right, and the procedure to enforce it). Use ids exactly as given. If none apply, return an empty list. Do not rely on memory of other sections.`,
      prompt: `Issue: ${intake.issueType}\nSummary: ${intake.summary}\n\nCANDIDATES:\n${list}`,
      temperature: 0,
      onUsage,
    });
    const known = new Set(candidates.map((c) => c.section.id));
    picked = sel.selected.filter((s) => known.has(s.id)).map((s) => ({ section: getSection(s.id)!, why: s.why }));
    if (sel.enough || !sel.followUpQuery || round === 1) break;
    queries.push(sel.followUpQuery);
    emit({ type: "step", agent: "research", status: "start", detail: `Coverage thin, searching again: "${sel.followUpQuery}"` });
    const more = await retrieveAll([sel.followUpQuery], q.acts.length < 5 ? [...new Set([...q.acts, "BNSS"])] : q.acts);
    const ids = new Set(candidates.map((c) => c.section.id));
    candidates = [...candidates, ...more.filter((m) => !ids.has(m.section.id))].slice(0, 18);
  }
  return { selected: picked, queries };
}

// ---------------- 3. Drafter ----------------
const DraftSchema = z.object({
  documentTitle: z.string(),
  addressedTo: z.string().describe("authority the document is addressed to"),
  body: z.string().describe("the complete document in markdown; cite law ONLY as [[ID]] markers"),
  placeholders: z.array(z.string()).describe("bracketed placeholders the user must fill, like [Your full name]"),
  plainSummary: z.string().describe("3-4 sentences for the user, in the user's language, explaining what this document does and the next step"),
});
export type Draft = z.infer<typeof DraftSchema>;

const LANG = { en: "English", hi: "Hindi", mr: "Marathi" } as const;

export async function drafterAgent(intake: Intake, selected: Selected[], rules: RuleResult[], onUsage: (u: Usage) => void, feedback?: string): Promise<Draft> {
  const issue = intake.issueType as IssueType;
  const law = selected.map((s) => `[[${s.section.id}]] ${citeLabel(s.section.id)}: ${s.why}\n${s.section.text.slice(0, 1200)}`).join("\n\n");
  const ruleText = rules.map((r) => `- ${r.label}: ${r.value}`).join("\n");
  return generateJson(DraftSchema, {
    agent: "drafter",
    system: `You draft formal Indian legal documents for citizens who cannot afford a lawyer.
Write a complete "${DOC_TITLES[issue]}" in English (formal documents to Indian authorities are filed in English), with: addressee, subject, numbered facts, the legal grounds, the relief or information sought, a list of documents attached, place, date and signature lines.
Rules: cite a law only by writing its marker exactly like [[CPA-35]], and only markers from the LAW list. Never write a section number any other way. Never invent facts: use [bracketed placeholders] for anything not given. Use the forum and deadlines from the RULES list as they are; do not compute your own.
The plainSummary must be written in ${LANG[intake.language]}.`,
    prompt: `FACTS\n${intake.summary}\n${JSON.stringify(intake.facts, null, 1)}\n\nLAW\n${law}\n\nRULES (decided by code)\n${ruleText}${feedback ? `\n\nREVIEWER FEEDBACK ON YOUR LAST DRAFT - fix these:\n${feedback}` : ""}`,
    temperature: 0.3,
    onUsage,
  });
}

// ---------------- 4. Verifier ----------------
const MARKER = /\[\[([A-Z]+-\d+[A-Z]{0,2})\]\]/g;
const LOOSE_SECTION = /\b(?:section|sec\.?|s\.)\s*\d+[A-Z]?/gi;

export type Check = { id: string; claim: string; supported: boolean; note: string };
export type Verification = { ok: boolean; codeIssues: string[]; checks: Check[] };

const SupportSchema = z.object({
  checks: z.array(z.object({ id: z.string(), claim: z.string().describe("the sentence in the draft that cites this section"), supported: z.boolean(), note: z.string().describe("why, in one sentence") })),
});

export async function verifierAgent(draft: Draft, selected: Selected[], onUsage: (u: Usage) => void): Promise<Verification> {
  const allowed = new Set(selected.map((s) => s.section.id));
  const cited = [...new Set([...draft.body.matchAll(MARKER)].map((m) => m[1]))];
  const codeIssues: string[] = [];
  for (const id of cited) {
    if (!getSection(id)) codeIssues.push(`[[${id}]] does not exist in the statute corpus.`);
    else if (!allowed.has(id)) codeIssues.push(`[[${id}]] was not among the researched sections; remove it or use a researched one.`);
  }
  const loose = draft.body.replace(MARKER, "").match(LOOSE_SECTION);
  if (loose) codeIssues.push(`Section numbers written without [[ID]] markers: ${[...new Set(loose)].join(", ")}. Use markers only.`);
  if (cited.length === 0) codeIssues.push("The draft cites no law; ground it in the researched sections.");

  const valid = cited.filter((id) => allowed.has(id));
  let checks: Check[] = [];
  if (valid.length) {
    const law = valid.map((id) => `[[${id}]] ${citeLabel(id)}\n${getSection(id)!.text.slice(0, 2500)}`).join("\n\n");
    const r = await generateJson(SupportSchema, {
      agent: "verifier",
      system: `You verify legal citations. For every [[ID]] marker in the DRAFT, find the sentence that cites it and decide whether the cited section's TEXT actually supports that sentence. Be strict: supported only if the section text says it. One entry per marker.`,
      prompt: `DRAFT\n${draft.body}\n\nSECTION TEXTS\n${law}`,
      temperature: 0,
      onUsage,
    });
    checks = r.checks.filter((c) => valid.includes(c.id));
  }
  return { ok: codeIssues.length === 0 && checks.every((c) => c.supported), codeIssues, checks };
}

// ---------------- orchestration ----------------
export type Result = {
  intake: Intake;
  queries: string[];
  selected: { id: string; label: string; title: string; why: string; text: string; source: string }[];
  rules: RuleResult[];
  draft: Draft;
  verification: Verification;
  revised: boolean;
  disclaimer: string;
  help: string[];
};

const DISCLAIMER =
  "NyayaSathi gives legal information and drafts, not legal advice. Check the document, fill every [placeholder], and consult a lawyer or your District Legal Services Authority for anything serious.";

export async function runPipeline(story: string, emit: (e: TraceEvent) => void, answers?: string): Promise<void> {
  const onUsage = (usage: Usage) => emit({ type: "usage", usage });
  const fullStory = answers ? `${story}\n\nAdditional details from the user:\n${answers}` : story;

  emit({ type: "step", agent: "intake", status: "start", detail: "Understanding your problem" });
  const intake = await intakeAgent(fullStory, onUsage);
  emit({ type: "step", agent: "intake", status: "done", detail: `${intake.issueType.replace(/_/g, " ")} · ${intake.summary}` });

  const help = [FREE_LEGAL_AID];
  if (intake.urgentDanger) help.unshift("If anyone is in immediate danger, call 112 (police, ambulance, fire) now.");
  if (intake.issueType === "out_of_scope") {
    emit({ type: "abstain", reason: "This looks like a matter NyayaSathi does not cover yet (it handles consumer complaints, RTI, police complaints and cyber fraud). Guessing here could hurt you.", help });
    return;
  }
  if (intake.missingCritical.length && !answers) {
    emit({ type: "clarify", questions: intake.missingCritical, intake });
    return;
  }
  const issue = intake.issueType as IssueType;

  const { selected, queries } = await researchAgent(intake, emit, onUsage);
  emit({ type: "step", agent: "research", status: "done", detail: selected.length ? `Applicable: ${selected.map((s) => citeLabel(s.section.id)).join("; ")}` : "No applicable section found" });
  if (!selected.length) {
    emit({ type: "abstain", reason: "I could not find a section in the acts I cover that fits these facts, so I will not draft a document that cites law I cannot verify.", help });
    return;
  }

  const rules = rulesFor(issue, intake.facts);
  emit({ type: "step", agent: "rules", status: "done", detail: rules.map((r) => r.label).join(" · ") });

  emit({ type: "step", agent: "drafter", status: "start", detail: `Drafting: ${DOC_TITLES[issue]}` });
  let draft = await drafterAgent(intake, selected, rules, onUsage);
  emit({ type: "step", agent: "drafter", status: "done" });

  emit({ type: "step", agent: "verifier", status: "start", detail: "Checking every citation against the statute text" });
  let verification = await verifierAgent(draft, selected, onUsage);
  let revised = false;
  if (!verification.ok) {
    const feedback = [...verification.codeIssues, ...verification.checks.filter((c) => !c.supported).map((c) => `[[${c.id}]] does not support: "${c.claim}" (${c.note})`)].join("\n");
    emit({ type: "step", agent: "verifier", status: "done", detail: `Found ${feedback.split("\n").length} problem(s); sending the draft back` });
    emit({ type: "step", agent: "drafter", status: "start", detail: "Revising the draft" });
    draft = await drafterAgent(intake, selected, rules, onUsage, feedback);
    verification = await verifierAgent(draft, selected, onUsage);
    revised = true;
  }
  const n = verification.checks.length;
  emit({ type: "step", agent: "verifier", status: "done", detail: `${verification.checks.filter((c) => c.supported).length}/${n} citations supported by the statute text${verification.codeIssues.length ? `; ${verification.codeIssues.length} issue(s) left` : ""}` });

  emit({
    type: "result",
    result: {
      intake,
      queries,
      selected: selected.map((s) => ({ id: s.section.id, label: citeLabel(s.section.id), title: s.section.title, why: s.why, text: s.section.text, source: s.section.source })),
      rules,
      draft,
      verification,
      revised,
      disclaimer: DISCLAIMER,
      help,
    },
  });
}
