// Rules engine tests: forum thresholds and dates, plus a check that every statute the rules cite
// really contains the period or duty the rule states (so a rule cannot drift from the law text).
import assert from "node:assert/strict";
import { getSection } from "../src/lib/corpus";
import { consumerForum, consumerRules, rtiRules, policeRules } from "../src/lib/rules";

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok  ${name}`);
};
const norm = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

test("forum: ₹50 lakh is District, ₹50,00,001 is State, ₹2 crore is State, above is National", () => {
  assert.match(consumerForum(50_00_000).value, /^District/);
  assert.match(consumerForum(50_00_001).value, /^State/);
  assert.match(consumerForum(2_00_00_000).value, /^State/);
  assert.match(consumerForum(2_00_00_001).value, /^National/);
  assert.match(consumerForum(null).value, /Give the amount/);
});

test("consumer limitation is two years from the incident, including a leap day", () => {
  const lim = consumerRules({ incidentDate: "2024-02-29" }).find((r) => r.key === "limitation")!;
  assert.equal(lim.date, "2026-03-01");
  assert.equal(consumerRules({ incidentDate: "2025-10-17" }).find((r) => r.key === "limitation")!.date, "2027-10-17");
  assert.equal(consumerRules({ incidentDate: "17/10/2025" }).find((r) => r.key === "limitation")!.date, undefined);
});

test("RTI reply due in 30 days, first appeal window ends 30 days after that", () => {
  const r = rtiRules({ applicationDate: "2026-01-10" });
  assert.equal(r.find((x) => x.key === "reply")!.date, "2026-02-09");
  assert.equal(r.find((x) => x.key === "first_appeal")!.date, "2026-03-11");
  assert.match(rtiRules({ lifeOrLiberty: true }).find((x) => x.key === "reply")!.value, /48 hours/);
});

test("cyber fraud puts the 1930 helpline first", () => {
  assert.equal(policeRules({ cyber: true })[0].key, "report_fast");
  assert.equal(policeRules({ cyber: false })[0].key, "fir");
});

// statute text must contain what the rule relies on
const statuteClaims: [string, string][] = [
  ["CPA-34", "jurisdiction to entertain complaints"],
  ["CPA-69", "two years from the date on which the cause of action has arisen"],
  ["CPA-35", "electronic"],
  ["CPA-41", "forty-five days"],
  ["RTI-6", "shall not be required to give any reason"],
  ["RTI-7", "thirty days"],
  ["RTI-7", "forty-eight hours"],
  ["RTI-7", "below poverty line"],
  ["RTI-19", "thirty days"],
  ["RTI-19", "ninety days"],
  ["BNSS-173", "irrespective of the area"],
  ["BNSS-173", "three days"],
  ["BNSS-173", "superintendent of police"],
  ["BNSS-175", "magistrate"],
];
test("every cited statute contains the period or duty the rule uses", () => {
  for (const [id, phrase] of statuteClaims) {
    const s = getSection(id);
    assert.ok(s, `${id} missing from corpus`);
    assert.ok(norm(s.text).includes(phrase), `${id} does not contain "${phrase}"`);
  }
});

test("every section a rule cites exists in the corpus", () => {
  const all = [
    ...consumerRules({ incidentDate: "2025-01-01", amount: 1000 }),
    ...rtiRules({ applicationDate: "2025-01-01" }),
    ...policeRules({ cyber: true }),
  ];
  for (const r of all) for (const b of r.basis) if (b.section) assert.ok(getSection(b.section), `${r.key}: ${b.section}`);
});

console.log(`\n${passed} tests passed`);
