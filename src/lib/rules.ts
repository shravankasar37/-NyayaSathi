// Deterministic legal rules: forum, limitation periods, reply deadlines and escalation paths.
// The model never decides these. Each result names its legal basis: a corpus section (verified by
// scripts/test-rules.ts to contain the period it uses) or the subordinate rules it comes from.

export type Basis = { section?: string; instrument?: string };
export type RuleResult = { key: string; label: string; value: string; basis: Basis[]; date?: string };

export type IssueType = "consumer_complaint" | "rti_application" | "rti_first_appeal" | "police_complaint" | "cyber_fraud";

const DAY = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString().slice(0, 10);
const addYears = (iso: string, years: number) => {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
};
const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const isIso = (s?: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

const JURISDICTION_RULES_2021 =
  "Consumer Protection (Jurisdiction of the District Commission, the State Commission and the National Commission) Rules, 2021";

/** Pecuniary jurisdiction by value of goods or services paid as consideration (2021 Rules, under the proviso to s.34(1)). */
export function consumerForum(amount?: number | null): RuleResult {
  const basis = [{ section: "CPA-34" }, { instrument: JURISDICTION_RULES_2021 }];
  if (amount == null || !(amount >= 0)) {
    return { key: "forum", label: "Where to file", value: "District Consumer Commission for amounts up to ₹50 lakh (State Commission up to ₹2 crore, National Commission above). Give the amount paid to confirm.", basis };
  }
  const value =
    amount <= 50_00_000
      ? `District Consumer Disputes Redressal Commission (amount paid ${fmtINR(amount)} is within ₹50 lakh)`
      : amount <= 2_00_00_000
        ? `State Consumer Disputes Redressal Commission (amount paid ${fmtINR(amount)} is above ₹50 lakh and up to ₹2 crore)`
        : `National Consumer Disputes Redressal Commission (amount paid ${fmtINR(amount)} is above ₹2 crore)`;
  return { key: "forum", label: "Where to file", value, basis };
}

export function consumerRules(f: { incidentDate?: string | null; amount?: number | null }): RuleResult[] {
  const out: RuleResult[] = [consumerForum(f.amount)];
  out.push({
    key: "territorial",
    label: "Which district",
    value: "Where the seller or service provider resides, carries on business or has a branch, or where you reside or personally work, or where the cause of action arose.",
    basis: [{ section: "CPA-34" }],
  });
  out.push({
    key: "limitation",
    label: "Last date to file",
    value: isIso(f.incidentDate)
      ? `Within two years of the cause of action: by ${addYears(f.incidentDate, 2)}. A late complaint needs an application showing sufficient cause for the delay.`
      : "Within two years of the date the problem arose (cause of action). A late complaint needs an application showing sufficient cause.",
    date: isIso(f.incidentDate) ? addYears(f.incidentDate, 2) : undefined,
    basis: [{ section: "CPA-69" }],
  });
  out.push({
    key: "filing",
    label: "How to file",
    value: "In person, by post, or online on the e-Daakhil portal (edaakhil.nic.in). No court fee for claims up to ₹5 lakh; check e-Daakhil for the current fee above that. A lawyer is not required.",
    basis: [{ section: "CPA-35" }, { instrument: "Consumer Protection (Consumer Commission Procedure) Regulations, 2020" }],
  });
  out.push({
    key: "appeal",
    label: "If you lose",
    value: "Appeal from the District Commission to the State Commission within 45 days of the order.",
    basis: [{ section: "CPA-41" }],
  });
  return out;
}

export function rtiRules(f: { applicationDate?: string | null; lifeOrLiberty?: boolean }): RuleResult[] {
  const out: RuleResult[] = [];
  out.push({
    key: "fee",
    label: "Fee",
    value: "₹10 for central public authorities (State governments set their own fee). No fee for applicants below the poverty line, with proof.",
    basis: [{ section: "RTI-7" }, { instrument: "Right to Information Rules, 2012" }],
  });
  if (f.lifeOrLiberty) {
    out.push({ key: "reply", label: "Reply due", value: "Within 48 hours, because the information concerns the life or liberty of a person.", basis: [{ section: "RTI-7" }] });
  } else {
    const due = isIso(f.applicationDate) ? addDays(f.applicationDate, 30) : undefined;
    out.push({
      key: "reply",
      label: "Reply due",
      value: due ? `Within 30 days of receipt: by ${due}. No reply by then counts as a refusal.` : "Within 30 days of receipt by the Public Information Officer. No reply in time counts as a refusal.",
      date: due,
      basis: [{ section: "RTI-7" }],
    });
  }
  const appealBy = isIso(f.applicationDate) && !f.lifeOrLiberty ? addDays(f.applicationDate, 60) : undefined;
  out.push({
    key: "first_appeal",
    label: "First appeal",
    value: appealBy
      ? `To the First Appellate Authority (an officer senior to the PIO) within 30 days of the reply or of the reply deadline: by ${appealBy} if no reply comes.`
      : "To the First Appellate Authority (an officer senior to the PIO) within 30 days of the reply, or of the date the reply was due.",
    date: appealBy,
    basis: [{ section: "RTI-19" }],
  });
  out.push({ key: "second_appeal", label: "Second appeal", value: "To the Central or State Information Commission within 90 days of the first appeal decision.", basis: [{ section: "RTI-19" }] });
  return out;
}

export function policeRules(f: { cyber?: boolean }): RuleResult[] {
  const out: RuleResult[] = [];
  if (f.cyber) {
    out.push({
      key: "report_fast",
      label: "Do this first",
      value: "Call the cyber fraud helpline 1930 or report on cybercrime.gov.in immediately: reporting within hours gives the best chance of the bank freezing the money. Also tell your bank to block the card or account.",
      basis: [{ instrument: "National Cyber Crime Reporting Portal (Ministry of Home Affairs)" }],
    });
  }
  out.push({
    key: "fir",
    label: "Register an FIR",
    value: "Any police station must record information about a cognizable offence, even if it happened in another area (zero FIR). You can also give it electronically, signing within three days. You are entitled to a free copy.",
    basis: [{ section: "BNSS-173" }],
  });
  out.push({
    key: "fir_refused",
    label: "If the police refuse",
    value: "Send the information in writing, by post, to the Superintendent of Police; if still nothing happens, apply to the Magistrate to order an investigation.",
    basis: [{ section: "BNSS-173" }, { section: "BNSS-175" }],
  });
  return out;
}

export function rulesFor(issue: IssueType, facts: { incidentDate?: string | null; amount?: number | null; applicationDate?: string | null; lifeOrLiberty?: boolean }): RuleResult[] {
  switch (issue) {
    case "consumer_complaint":
      return consumerRules(facts);
    case "rti_application":
    case "rti_first_appeal":
      return rtiRules(facts);
    case "police_complaint":
      return policeRules({ cyber: false });
    case "cyber_fraud":
      return policeRules({ cyber: true });
  }
}

export const FREE_LEGAL_AID =
  "Free legal aid: call the NALSA helpline 15100 or visit your District Legal Services Authority (Legal Services Authorities Act, 1987).";
