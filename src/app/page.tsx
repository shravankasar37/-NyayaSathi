"use client";

import { useMemo, useRef, useState } from "react";
import type { Intake, Result, TraceEvent } from "@/lib/agents";
import type { Usage } from "@/lib/llm";

type Step = { agent: string; status: "start" | "done"; detail?: string };
type Phase = "idle" | "running" | "clarify" | "done" | "abstain" | "error";

const EXAMPLES = [
  { label: "Defective phone", text: "I bought a Redmi phone for ₹18,499 from a shop in Pune on 2 September 2026. The screen stopped working after 10 days. The shop and the service centre both refuse to replace or repair it and say it is physical damage, which is false. I want a replacement or refund." },
  { label: "RTI: road repair", text: "I want to know how much money our municipal corporation in Nashik spent on repairing the road in front of my house in 2025, which contractor did it and why it broke again within 3 months." },
  { label: "Police won't file FIR", text: "My motorcycle was stolen from outside my building in Thane last night. I went to the police station this morning but they refused to register an FIR and told me to come back after a week." },
  { label: "UPI fraud call", text: "Today someone called pretending to be from SBI customer care, said my KYC was expiring, and asked me to share the OTP. After I shared it, ₹42,000 was debited from my account in two UPI transactions." },
  { label: "हिंदी: ठगी", text: "एक आदमी ने मुझसे नौकरी दिलाने के नाम पर 25,000 रुपये लिए और अब फोन नहीं उठा रहा। मैं इंदौर में रहता हूं।" },
];

const AGENT_LABEL: Record<string, string> = { intake: "Intake agent", research: "Research agent", rules: "Rules engine", drafter: "Drafting agent", verifier: "Verification agent" };

function Citation({ id, label, onOpen }: { id: string; label?: string; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(id)} className="mx-0.5 inline-flex items-center rounded-md px-1.5 py-0.5 text-[0.82em] font-medium align-baseline" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} title={label}>
      §{id.replace("-", " ")}
    </button>
  );
}

function DocView({ body, labels, onOpen }: { body: string; labels: Record<string, string>; onOpen: (id: string) => void }) {
  const lines = body.split(/\r?\n/);
  const inline = (text: string, key: string) =>
    text.split(/(\[\[[A-Z]+-\d+[A-Z]{0,2}\]\]|\*\*[^*]+\*\*)/).map((part, i) => {
      const m = /^\[\[(.+)\]\]$/.exec(part);
      if (m) return <Citation key={`${key}-${i}`} id={m[1]} label={labels[m[1]]} onOpen={onOpen} />;
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
      return <span key={`${key}-${i}`}>{part}</span>;
    });
  return (
    <div className="doc text-[15px]">
      {lines.map((l, i) => {
        const h = /^(#{1,3})\s+(.*)$/.exec(l);
        if (h) return h[1].length === 1 ? <h2 key={i} className="text-lg">{inline(h[2], `h${i}`)}</h2> : <h3 key={i}>{inline(h[2], `h${i}`)}</h3>;
        const b = /^\s*[-*]\s+(.*)$/.exec(l);
        if (b) return <ul key={i}><li>{inline(b[1], `b${i}`)}</li></ul>;
        if (!l.trim()) return <div key={i} className="h-2" />;
        return <p key={i}>{inline(l, `p${i}`)}</p>;
      })}
    </div>
  );
}

export default function Home() {
  const [story, setStory] = useState("");
  const [answers, setAnswers] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<Step[]>([]);
  const [usage, setUsage] = useState<Usage[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [clarify, setClarify] = useState<{ questions: string[]; intake: Intake } | null>(null);
  const [abstain, setAbstain] = useState<{ reason: string; help: string[] } | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"doc" | "rights" | "law" | "checks">("doc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const resultRef = useRef<HTMLDivElement>(null);

  const labels = useMemo(() => Object.fromEntries((result?.selected ?? []).map((s) => [s.id, s.label])), [result]);
  const totals = usage.reduce((a, u) => ({ calls: a.calls + 1, tokens: a.tokens + u.inputTokens + u.outputTokens }), { calls: 0, tokens: 0 });

  async function run(withAnswers?: string) {
    setPhase("running");
    setSteps([]);
    setUsage([]);
    setResult(null);
    setAbstain(null);
    setError("");
    setTab("doc");
    setOpenId(null);
    const t0 = Date.now();
    setStartedAt(t0);
    if (!withAnswers) setClarify(null);
    try {
      const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ story, answers: withAnswers }) });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let final: Phase = "error";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, idx).replace(/^data: /, "");
          buf = buf.slice(idx + 2);
          const e = JSON.parse(line) as TraceEvent;
          if (e.type === "step") setSteps((s) => [...s, e]);
          else if (e.type === "usage") setUsage((u) => [...u, e.usage]);
          else if (e.type === "result") { setResult(e.result); final = "done"; }
          else if (e.type === "clarify") { setClarify({ questions: e.questions, intake: e.intake }); final = "clarify"; }
          else if (e.type === "abstain") { setAbstain({ reason: e.reason, help: e.help }); final = "abstain"; }
          else if (e.type === "error") { setError(e.message); final = "error"; }
        }
      }
      setElapsed(Date.now() - t0);
      setPhase(final);
      if (final === "done") setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function downloadDocx() {
    if (!result) return;
    const res = await fetch("/api/docx", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1]) ?? "NyayaSathi.docx";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const open = result?.selected.find((s) => s.id === openId);
  const supported = result?.verification.checks.filter((c) => c.supported).length ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
      <header className="mb-8">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-white" style={{ background: "var(--accent)" }}>न्या</div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">NyayaSathi</h1>
            <p className="text-sm" style={{ color: "var(--muted)" }}>Free AI legal aid for every Indian · by Shravan Kasar</p>
          </div>
        </div>
        <p className="mt-5 max-w-3xl text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Describe your problem in English, Hindi or Marathi. Four AI agents find the exact sections of Indian law, a rules engine works out the right forum and deadlines, and you get a ready-to-file document in which every citation is checked against the statute text.
        </p>
      </header>

      <section className="card p-4 sm:p-5">
        <label htmlFor="story" className="mb-2 block text-sm font-medium">What happened?</label>
        <textarea id="story" value={story} onChange={(e) => setStory(e.target.value)} rows={5} maxLength={4000}
          placeholder="For example: I bought a washing machine that broke in a week and the seller refuses to repair it…"
          className="w-full resize-y rounded-lg border p-3 text-[15px] outline-none focus:ring-2" style={{ borderColor: "var(--line)", background: "var(--paper)" }} />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: "var(--muted)" }}>Try:</span>
          {EXAMPLES.map((ex) => (
            <button key={ex.label} onClick={() => setStory(ex.text)} className="rounded-full border px-3 py-1 text-xs hover:opacity-80" style={{ borderColor: "var(--line)" }}>{ex.label}</button>
          ))}
          <button onClick={() => run()} disabled={phase === "running" || story.trim().length < 15}
            className="ml-auto rounded-lg px-5 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--accent)" }}>
            {phase === "running" ? "Working…" : "Get my document"}
          </button>
        </div>
        <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>Covers consumer complaints, RTI, police complaints (FIR) and cyber fraud. Don't include Aadhaar, bank or card numbers.</p>
      </section>

      {phase !== "idle" && (
        <section className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="card h-fit p-4">
            <h2 className="mb-3 text-sm font-semibold">Agent trace</h2>
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-[13px]">
                  <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.status === "done" ? "var(--ok)" : "var(--accent)" }} />
                  <div>
                    <div className="font-medium">{AGENT_LABEL[s.agent] ?? s.agent}</div>
                    {s.detail && <div className="mt-0.5 leading-snug" style={{ color: "var(--muted)" }}>{s.detail}</div>}
                  </div>
                </li>
              ))}
              {phase === "running" && <li className="animate-pulse text-[13px]" style={{ color: "var(--muted)" }}>Thinking…</li>}
            </ol>
            {totals.calls > 0 && (
              <div className="mt-4 border-t pt-3 text-xs" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>
                {totals.calls} model calls · {totals.tokens.toLocaleString()} tokens{phase !== "running" && elapsed ? ` · ${(elapsed / 1000).toFixed(1)} s` : startedAt ? "" : ""}
              </div>
            )}
          </aside>

          <div ref={resultRef} className="min-w-0">
            {phase === "error" && <div className="card p-5" style={{ color: "var(--bad)" }}>Something went wrong: {error}</div>}

            {phase === "clarify" && clarify && (
              <div className="card p-5">
                <h2 className="mb-1 font-semibold">I need a little more information</h2>
                <p className="mb-3 text-sm" style={{ color: "var(--muted)" }}>{clarify.intake.summary}</p>
                <ul className="mb-3 list-disc pl-5 text-sm">{clarify.questions.map((q) => <li key={q}>{q}</li>)}</ul>
                <textarea value={answers} onChange={(e) => setAnswers(e.target.value)} rows={3} className="w-full rounded-lg border p-3 text-sm" style={{ borderColor: "var(--line)", background: "var(--paper)" }} placeholder="Your answers" />
                <button onClick={() => run(answers)} disabled={!answers.trim()} className="mt-3 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" style={{ background: "var(--accent)" }}>Continue</button>
              </div>
            )}

            {phase === "abstain" && abstain && (
              <div className="card p-5" style={{ background: "var(--warn-soft)" }}>
                <h2 className="mb-2 font-semibold" style={{ color: "var(--warn)" }}>I won't guess on this one</h2>
                <p className="mb-3 text-sm">{abstain.reason}</p>
                <ul className="list-disc pl-5 text-sm">{abstain.help.map((h) => <li key={h}>{h}</li>)}</ul>
              </div>
            )}

            {phase === "done" && result && (
              <div className="card overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b p-4" style={{ borderColor: "var(--line)" }}>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold">{result.draft.documentTitle}</h2>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>To: {result.draft.addressedTo}</p>
                  </div>
                  <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: result.verification.ok ? "var(--ok-soft)" : "var(--warn-soft)", color: result.verification.ok ? "var(--ok)" : "var(--warn)" }}>
                    {result.verification.ok ? `✓ ${supported}/${result.verification.checks.length} citations verified` : "⚠ some citations need review"}
                  </span>
                  <button onClick={downloadDocx} className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: "var(--accent)" }}>Download .docx</button>
                </div>

                <div className="border-b px-4 py-3 text-sm" style={{ borderColor: "var(--line)", background: "var(--accent-soft)" }}>{result.draft.plainSummary}</div>

                <nav className="flex gap-1 border-b px-2" style={{ borderColor: "var(--line)" }}>
                  {([["doc", "Document"], ["rights", "Deadlines & where to file"], ["law", `Law used (${result.selected.length})`], ["checks", "Verification"]] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setTab(k)} className="px-3 py-2.5 text-sm" style={{ borderBottom: tab === k ? "2px solid var(--accent)" : "2px solid transparent", fontWeight: tab === k ? 600 : 400 }}>{l}</button>
                  ))}
                </nav>

                <div className="p-4 sm:p-6">
                  {tab === "doc" && (
                    <>
                      <DocView body={result.draft.body} labels={labels} onOpen={(id) => setOpenId(id)} />
                      {open && (
                        <div className="mt-5 rounded-lg border p-4 text-sm" style={{ borderColor: "var(--line)", background: "var(--paper)" }}>
                          <div className="mb-1 flex items-start justify-between gap-3">
                            <strong>{open.label}{open.title ? ` - ${open.title}` : ""}</strong>
                            <button onClick={() => setOpenId(null)} className="text-xs" style={{ color: "var(--muted)" }}>close</button>
                          </div>
                          <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>Why it applies: {open.why}</p>
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{open.text}</pre>
                        </div>
                      )}
                      {result.draft.placeholders.length > 0 && <p className="mt-4 text-xs" style={{ color: "var(--warn)" }}>Fill before filing: {result.draft.placeholders.join(", ")}</p>}
                    </>
                  )}
                  {tab === "rights" && (
                    <dl className="space-y-4">
                      {result.rules.map((r) => (
                        <div key={r.key}>
                          <dt className="text-sm font-semibold">{r.label}</dt>
                          <dd className="text-sm">{r.value}</dd>
                          <dd className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>Basis: {r.basis.map((b) => b.section ? `§${b.section.replace("-", " ")}` : b.instrument).join("; ")}</dd>
                        </div>
                      ))}
                      <p className="text-xs" style={{ color: "var(--muted)" }}>Computed by NyayaSathi's rules engine from the statute, not by the AI model.</p>
                    </dl>
                  )}
                  {tab === "law" && (
                    <div className="space-y-4">
                      {result.selected.map((s) => (
                        <details key={s.id} className="rounded-lg border p-3" style={{ borderColor: "var(--line)" }}>
                          <summary className="cursor-pointer text-sm"><strong>{s.label}</strong>{s.title ? ` - ${s.title}` : ""}<div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{s.why}</div></summary>
                          <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed">{s.text}</pre>
                          <a href={s.source} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs underline" style={{ color: "var(--accent)" }}>Official text (PDF)</a>
                        </details>
                      ))}
                      <p className="text-xs" style={{ color: "var(--muted)" }}>Search queries the research agent wrote: {result.queries.map((q) => `"${q}"`).join(", ")}</p>
                    </div>
                  )}
                  {tab === "checks" && (
                    <div className="space-y-3 text-sm">
                      {result.revised && <p style={{ color: "var(--warn)" }}>The first draft failed verification and was revised by the drafting agent.</p>}
                      {result.verification.codeIssues.map((c) => <p key={c} style={{ color: "var(--bad)" }}>✗ {c}</p>)}
                      {result.verification.checks.map((c, i) => (
                        <div key={i} className="rounded-lg border p-3" style={{ borderColor: "var(--line)" }}>
                          <div style={{ color: c.supported ? "var(--ok)" : "var(--bad)" }}>{c.supported ? "✓ supported" : "✗ not supported"} · {labels[c.id] ?? c.id}</div>
                          <div className="mt-1 italic">"{c.claim}"</div>
                          <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>{c.note}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="border-t px-4 py-3 text-xs" style={{ borderColor: "var(--line)", color: "var(--muted)" }}>{result.disclaimer} {result.help.join(" ")}</div>
              </div>
            )}
          </div>
        </section>
      )}

      <footer className="mt-12 text-center text-xs" style={{ color: "var(--muted)" }}>
        Sources: Bharatiya Nyaya Sanhita 2023, Bharatiya Nagarik Suraksha Sanhita 2023, Consumer Protection Act 2019, Right to Information Act 2005, Information Technology Act 2000. Built by Shravan Kasar.
      </footer>
    </main>
  );
}
