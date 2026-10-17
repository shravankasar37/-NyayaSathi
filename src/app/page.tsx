"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Intake, Result, TraceEvent } from "@/lib/agents";
import type { Usage } from "@/lib/llm";
import { EXAMPLES, exampleByText } from "@/lib/examples";
import type { SceneState } from "@/components/JusticeScene3D";

// WebGL scene: browser only, loaded after the page so it never delays the form
const JusticeScene3D = dynamic(() => import("@/components/JusticeScene3D"), { ssr: false });

type ReplayInfo = { recordedAt: string; models: string[]; totalMs: number };
type Step = { agent: string; status: "start" | "done"; detail?: string };
type Phase = "idle" | "running" | "clarify" | "done" | "abstain" | "error";

const AGENT_TAG: Record<string, { name: string; color: string }> = {
  intake: { name: "INTAKE_AGENT", color: "var(--cyan)" },
  research: { name: "RESEARCH_AGENT", color: "var(--orange)" },
  rules: { name: "RULES_ENGINE", color: "var(--green)" },
  drafter: { name: "DRAFT_AGENT", color: "var(--red)" },
  verifier: { name: "VERIFY_AGENT", color: "var(--amber)" },
};

const SCENE_LABEL: Record<SceneState, string> = { idle: "BALANCED", weighing: "WEIGHING CASE", verdict: "VERIFIED", warning: "REVIEW" };
const PHASE_LABEL: Record<Phase, string> = { idle: "IDLE", running: "PROCESSING", clarify: "NEEDS INFO", done: "DOCUMENT READY", abstain: "REFUSED", error: "FAULT" };

/** Static circuit-board backdrop, as in VaaniShield: thin grey traces, a few orange segments, node dots. */
function NetworkBackdrop() {
  const lines: [number, number, number, number, boolean][] = [
    [40, 120, 420, 120, false], [420, 120, 520, 40, false], [180, 120, 180, 420, false], [180, 420, 620, 420, true],
    [620, 420, 760, 300, false], [760, 300, 1180, 300, false], [980, 300, 980, 700, false], [300, 700, 1300, 700, false],
    [1180, 300, 1320, 160, true], [520, 40, 900, 40, false], [60, 560, 300, 700, false], [1100, 520, 1400, 520, true],
    [700, 560, 900, 560, true], [900, 40, 1060, 200, false], [1060, 200, 1060, 300, false], [240, 260, 360, 260, true],
  ];
  const dots = new Set(lines.flatMap(([x1, y1, x2, y2]) => [`${x1},${y1}`, `${x2},${y2}`]));
  return (
    <svg aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full opacity-60" viewBox="0 0 1440 800" preserveAspectRatio="xMidYMid slice">
      {lines.map(([x1, y1, x2, y2, hot], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={hot ? "var(--orange)" : "var(--line)"} strokeWidth={hot ? 3 : 1.2} />
      ))}
      {[...dots].map((d) => {
        const [x, y] = d.split(",").map(Number);
        return <circle key={d} cx={x} cy={y} r={3.5} fill="var(--ink-2)" />;
      })}
    </svg>
  );
}

function Panel({ icon, title, sub, badge, children, className = "" }: { icon: string; title: string; sub?: string; badge?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mecha-card ${className}`}>
      <span className="grip-red" />
      <span className="grip-cyan" />
      <div className="panel-head">
        <div className="panel-icon text-base">{icon}</div>
        <div className="min-w-0 flex-1">
          <h2 className="panel-title truncate">{title}</h2>
          {sub && <div className="panel-sub truncate">{sub}</div>}
        </div>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Citation({ id, label, onOpen }: { id: string; label?: string; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(id)} title={label}
      className="font-mono-hud mx-0.5 inline-flex items-center px-1.5 py-0.5 align-baseline text-[0.78em]"
      style={{ border: "1.5px solid var(--orange)", color: "var(--orange)" }}>
      §{id.replace("-", " ")}
    </button>
  );
}

function DocView({ body, labels, onOpen }: { body: string; labels: Record<string, string>; onOpen: (id: string) => void }) {
  const inline = (text: string, key: string) =>
    text.split(/(\[\[[A-Z]+-\d+[A-Z]{0,2}\]\]|\*\*[^*]+\*\*)/).map((part, i) => {
      const m = /^\[\[(.+)\]\]$/.exec(part);
      if (m) return <Citation key={`${key}-${i}`} id={m[1]} label={labels[m[1]]} onOpen={onOpen} />;
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${key}-${i}`}>{part.slice(2, -2)}</strong>;
      return <span key={`${key}-${i}`}>{part}</span>;
    });
  return (
    <div className="doc font-doc text-[14.5px]">
      {body.split(/\r?\n/).map((l, i) => {
        const h = /^(#{1,3})\s+(.*)$/.exec(l);
        if (h) return <h3 key={i}>{inline(h[2], `h${i}`)}</h3>;
        const b = /^\s*[-*]\s+(.*)$/.exec(l);
        if (b) return <ul key={i}><li>{inline(b[1], `b${i}`)}</li></ul>;
        if (!l.trim()) return <div key={i} className="h-2" />;
        return <p key={i}>{inline(l, `p${i}`)}</p>;
      })}
    </div>
  );
}

function Gauge({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="min-w-0 flex-1">
      <div className="font-mono-hud mb-1 flex justify-between text-[0.66rem] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
        <span>{label}</span>
        <span style={{ color }}>{value}/{total}</span>
      </div>
      <div className="gauge-track"><div className="gauge-fill" style={{ width: `${pct}%`, background: color }} /></div>
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
  const [errorCode, setErrorCode] = useState<string | undefined>();
  const [recorded, setRecorded] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"replay" | "live">("replay");
  const [replay, setReplay] = useState<ReplayInfo | null>(null);
  const [tab, setTab] = useState<"doc" | "rights" | "law" | "checks">("doc");
  const [openId, setOpenId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dark, setDark] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark-theme"));
    fetch("/api/examples").then((r) => r.json()).then((list: { id: string; recorded: boolean }[]) => setRecorded(new Set(list.filter((e) => e.recorded).map((e) => e.id)))).catch(() => {});
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark-theme", next);
    try {
      localStorage.setItem("ns-theme", next ? "dark" : "light");
    } catch {}
  }

  const example = exampleByText(story);
  const canReplay = !!example && recorded.has(example.id);
  const labels = useMemo(() => Object.fromEntries((result?.selected ?? []).map((s) => [s.id, s.label])), [result]);
  const totals = usage.reduce((a, u) => ({ calls: a.calls + 1, tokens: a.tokens + u.inputTokens + u.outputTokens }), { calls: 0, tokens: 0 });
  const models = [...new Set(usage.map((u) => u.model))];

  async function run(withAnswers?: string, forceReplayId?: string) {
    const replayId = forceReplayId ?? (!withAnswers && canReplay && mode === "replay" ? example!.id : undefined);
    if (forceReplayId) setStory(EXAMPLES.find((e) => e.id === forceReplayId)?.text ?? story);
    setPhase("running");
    setReplay(null);
    setErrorCode(undefined);
    setSteps([]);
    setUsage([]);
    setResult(null);
    setAbstain(null);
    setError("");
    setTab("doc");
    setOpenId(null);
    const t0 = Date.now();
    if (!withAnswers) setClarify(null);
    try {
      const res = replayId
        ? await fetch(`/api/replay?id=${encodeURIComponent(replayId)}`)
        : await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ story, answers: withAnswers }) });
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
          const e = JSON.parse(line) as TraceEvent | ({ type: "replay" } & ReplayInfo);
          if (e.type === "replay") setReplay({ recordedAt: e.recordedAt, models: e.models, totalMs: e.totalMs });
          else if (e.type === "step") setSteps((s) => [...s, e]);
          else if (e.type === "usage") setUsage((u) => [...u, e.usage]);
          else if (e.type === "result") { setResult(e.result); final = "done"; }
          else if (e.type === "clarify") { setClarify({ questions: e.questions, intake: e.intake }); final = "clarify"; }
          else if (e.type === "abstain") { setAbstain({ reason: e.reason, help: e.help }); final = "abstain"; }
          else if (e.type === "error") { setError(e.message); setErrorCode(e.code); final = "error"; }
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
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "NyayaSathi.docx";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const open = result?.selected.find((s) => s.id === openId);
  const checks = result?.verification.checks ?? [];
  const supported = checks.filter((c) => c.supported).length;
  const facts = result?.verification.factIssues.length ?? 0;
  const live = !(canReplay && mode === "replay");
  const scene: SceneState =
    phase === "running" ? "weighing"
    : phase === "done" ? (facts || supported < checks.length ? "warning" : "verdict")
    : phase === "abstain" || phase === "error" || phase === "clarify" ? "warning"
    : "idle";

  return (
    <>
      <NetworkBackdrop />
      <div className="hud-stripe" />
      <main className="mx-auto max-w-6xl px-4 pb-12">
        {/* ── header ── */}
        <header className="mecha-card -mx-4 mb-6 px-4 py-4 sm:mx-0 sm:mt-4 sm:px-6" style={{ clipPath: "none" }}>
          <div className="flex flex-wrap items-start gap-4">
            <div className="font-mono-hud border-l-4 pl-2 text-[0.7rem] leading-tight" style={{ borderColor: "var(--red)", color: "var(--muted)" }}>
              <div style={{ color: "var(--red)" }}>NS-01</div>
              <div>SEC-LAW</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="glitch-title text-[1.6rem] sm:text-3xl">NYAYASATHI</h1>
                <span className="font-deva px-1.5 py-0.5 text-sm font-bold text-white" style={{ background: "var(--red)" }}>न्यायसाथी</span>
              </div>
              <div className="font-mono-hud mt-1 text-[0.7rem] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
                <span style={{ color: "var(--red)" }}>▲ LEGAL_NODE</span> // AGENTIC AI LEGAL AID // <span style={{ color: "var(--cyan)" }}>BNS·BNSS·CPA·RTI·IT</span>
              </div>
            </div>
            <div className="order-last w-full border-[1.5px] px-3 py-1.5 sm:order-none sm:w-auto sm:text-right" style={{ borderColor: "var(--ink-2)", boxShadow: "3px 3px 0 var(--ink-2)" }}>
              <div className="font-mono-hud text-[0.6rem] tracking-wider" style={{ color: "var(--muted)" }}>CITATION INTEGRITY</div>
              <div className="font-cyber text-lg font-extrabold">
                {result ? `${supported}/${checks.length} VERIFIED` : "— STANDBY"}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={toggleTheme} className={`hud-pill ${dark ? "" : "ink"}`}>☾ [ {dark ? "LIGHT OPS" : "DARK OPS"} ]</button>
            <span className="hud-pill" style={{ cursor: "default" }}>
              <span className={phase === "running" ? "cursor-blink" : ""} style={{ color: phase === "done" ? "var(--ok)" : phase === "error" ? "var(--bad)" : "var(--muted)" }}>●</span> {PHASE_LABEL[phase]}
            </span>
            <span className={`hud-pill ${live ? "red" : "cyan"}`} style={{ cursor: "default" }}>{live ? "((•)) LIVE AI" : "▶ RECORDED RUN"}</span>
            <span className="hud-badge self-center">by Shravan Kasar</span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* ── case intake ── */}
        <Panel icon="⚖" title="Case intake" sub="EN · हिंदी · मराठी // describe your problem in your own words" badge={<span className="hud-badge">{phase === "running" ? "BUSY" : "READY"}</span>}>
          <div className="p-4">
            <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={5} maxLength={4000} aria-label="What happened?"
              placeholder="e.g. I bought a washing machine that broke in a week and the seller refuses to repair it…"
              className="hud-input w-full resize-y p-3 text-[15px]" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-mono-hud text-[0.68rem]" style={{ color: "var(--muted)" }}>&gt;_ SAMPLES:</span>
              {EXAMPLES.map((ex) => (
                <button key={ex.id} onClick={() => setStory(ex.text)} className={`bracket-btn ${example?.id === ex.id ? "active" : ""} ${/[ऀ-ॿ]/.test(ex.label) ? "font-deva-chip" : ""}`}>
                  [ {ex.label}{recorded.has(ex.id) ? " ▶" : ""} ]
                </button>
              ))}
            </div>
          </div>
          <div className="grid border-t-[1.5px] sm:grid-cols-3" style={{ borderColor: "var(--line)" }}>
            <button onClick={() => setMode("replay")} disabled={!canReplay} className={`seg ${canReplay && mode === "replay" ? "on" : ""} disabled:opacity-40`}>▶ [ Recorded run ]</button>
            <button onClick={() => setMode("live")} className={`seg ${live ? "on" : ""}`} style={{ borderLeft: "1.5px solid var(--line)" }}>((•)) [ Run live ]</button>
            <button onClick={() => run()} disabled={phase === "running" || story.trim().length < 15} className="go-btn">
              ⚖ [ {phase === "running" ? "Processing…" : live ? "Generate document" : "Play recording"} ]
            </button>
          </div>
          <div className="telemetry">
            <span>COVERS: CONSUMER · RTI · FIR · CYBER FRAUD</span>
            <span>CORPUS: 1,149 §</span>
            <span style={{ color: "var(--red)" }}>NO AADHAAR / BANK / CARD NUMBERS</span>
          </div>
        </Panel>

        {/* ── 3D core ── */}
        <Panel icon="◬" title="Nyaya core" sub="holo-scales // 3d state monitor" badge={<span className="hud-badge">{SCENE_LABEL[scene]}</span>}>
          <div className="h-[230px] lg:h-[300px]">
            <JusticeScene3D state={scene} dark={dark} />
          </div>
          <div className="telemetry">
            <span>STATE: <span style={{ color: scene === "verdict" ? "var(--ok)" : scene === "warning" ? "var(--amber)" : scene === "weighing" ? "var(--orange)" : "var(--cyan)" }}>{SCENE_LABEL[scene]}</span></span>
            <span>AGENTS: 4</span>
          </div>
        </Panel>
        </div>

        {phase !== "idle" && (
          <div className="mt-6 grid gap-6 lg:grid-cols-[340px_1fr]">
            {/* ── agent trace ── */}
            <Panel icon="⌁" title="Agent pipeline" sub="temporal inference logs" className="h-fit" badge={<span className="hud-badge">{steps.length} EVT</span>}>
              {replay && (
                <div className="font-mono-hud mx-4 mt-3 px-2 py-1.5 text-[0.68rem]" style={{ border: "1.5px solid var(--cyan)", color: "var(--cyan)" }}>
                  ▶ RECORDED {new Date(replay.recordedAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()} · {(replay.totalMs / 1000).toFixed(0)}S LIVE · {replay.models.join(", ")}
                </div>
              )}
              <ol className="space-y-2.5 p-4">
                {steps.map((s, i) => {
                  const t = AGENT_TAG[s.agent] ?? { name: s.agent.toUpperCase(), color: "var(--muted)" };
                  return (
                    <li key={i} className="log-line">
                      <span style={{ color: "var(--muted)" }}>&gt; </span>
                      <span className="log-tag" style={{ color: t.color }}>{t.name}</span>
                      <span style={{ color: s.status === "done" ? "var(--ok)" : "var(--muted)" }}> {s.status === "done" ? "✓" : "…"}</span>
                      {s.detail && <div className="mt-0.5 pl-3 font-doc text-[12.5px] leading-snug" style={{ color: "var(--muted)" }}>{s.detail}</div>}
                    </li>
                  );
                })}
                {phase === "running" && <li className="log-line" style={{ color: "var(--muted)" }}>&gt; awaiting agents<span className="cursor-blink">_</span></li>}
              </ol>
              <div className="telemetry">
                <span>CALLS: {totals.calls}</span>
                <span>TOKENS: {totals.tokens.toLocaleString()}</span>
                {phase !== "running" && elapsed > 0 && !replay && <span>LATENCY: {(elapsed / 1000).toFixed(1)}S</span>}
                {models.length > 0 && <span className="w-full normal-case" style={{ color: "var(--cyan)" }}>MODEL: {models.join(" → ")}</span>}
              </div>
            </Panel>

            <div ref={resultRef} className="min-w-0 space-y-6">
              {phase === "running" && !result && (
                <Panel icon="◈" title="Legal document" sub="standby // awaiting verified draft" badge={<span className="hud-badge">STANDBY</span>}>
                  <div className="font-mono-hud p-10 text-center text-sm" style={{ color: "var(--muted)" }}>[ STANDBY // AGENTS AT WORK<span className="cursor-blink">_</span> ]</div>
                </Panel>
              )}

              {phase === "error" && errorCode === "quota" && (
                <Panel icon="⚠" title="Free AI quota exhausted" sub="all providers rate limited" badge={<span className="hud-badge" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>QUOTA</span>}>
                  <div className="p-4 text-sm">
                    <p className="mb-3">NyayaSathi runs on free model tiers. Watch a real recorded run of an example instead:</p>
                    <div className="flex flex-wrap gap-2">
                      {EXAMPLES.filter((e) => recorded.has(e.id)).map((e) => (
                        <button key={e.id} onClick={() => run(undefined, e.id)} className="bracket-btn active">▶ [ {e.label} ]</button>
                      ))}
                    </div>
                  </div>
                </Panel>
              )}
              {phase === "error" && errorCode !== "quota" && (
                <Panel icon="✕" title="Pipeline fault" sub="error"><div className="font-mono-hud p-4 text-sm" style={{ color: "var(--bad)" }}>{error}</div></Panel>
              )}

              {phase === "clarify" && clarify && (
                <Panel icon="?" title="More information needed" sub="intake agent // clarification">
                  <div className="p-4">
                    <p className="font-doc mb-2 text-sm" style={{ color: "var(--muted)" }}>{clarify.intake.summary}</p>
                    <ul className="font-doc mb-3 list-disc pl-5 text-sm">{clarify.questions.map((q) => <li key={q}>{q}</li>)}</ul>
                    <textarea value={answers} onChange={(e) => setAnswers(e.target.value)} rows={3} className="hud-input w-full p-3 text-sm" placeholder="Your answers" />
                    <button onClick={() => run(answers)} disabled={!answers.trim()} className="go-btn mt-3">[ Continue ]</button>
                  </div>
                </Panel>
              )}

              {phase === "abstain" && abstain && (
                <Panel icon="⛔" title="Out of scope" sub="responsible ai // no guessing" badge={<span className="hud-badge" style={{ color: "var(--amber)", borderColor: "var(--amber)" }}>REFUSED</span>}>
                  <div className="font-doc p-4 text-sm">
                    <p className="mb-3">{abstain.reason}</p>
                    <ul className="list-disc pl-5">{abstain.help.map((h) => <li key={h}>{h}</li>)}</ul>
                  </div>
                </Panel>
              )}

              {phase === "done" && result && (
                <Panel icon="◈" title="Legal document" sub={`verified draft // to: ${result.draft.addressedTo}`}
                  badge={<button onClick={downloadDocx} className="hud-pill ink">⤓ [ .DOCX ]</button>}>
                  <div className="flex flex-wrap gap-4 px-4 pt-4">
                    <Gauge label="Citations verified" value={supported} total={checks.length} color={supported === checks.length ? "var(--green)" : "var(--amber)"} />
                    <Gauge label="Laws used" value={result.selected.length} total={result.selected.length} color="var(--cyan)" />
                    <button onClick={() => setTab("checks")} className="min-w-0 flex-1 text-left">
                      <Gauge label="Statements to check" value={facts} total={Math.max(facts, 1)} color={facts ? "var(--amber)" : "var(--green)"} />
                    </button>
                  </div>
                  <p className="font-doc mx-4 mt-4 px-3 py-2 text-sm" style={{ borderLeft: "3px solid var(--cyan)", background: "var(--paper)" }}>{result.draft.plainSummary}</p>

                  <div className="tab-strip mt-4" style={{ borderTop: "1.5px solid var(--line)" }}>
                    {([["doc", "≋ Document"], ["rights", "⏱ Deadlines & forum"], ["law", `§ Law used (${result.selected.length})`], ["checks", "✓ Verification"]] as const).map(([k, l]) => (
                      <button key={k} onClick={() => setTab(k)} className={tab === k ? "on" : ""}>{l}</button>
                    ))}
                  </div>

                  <div className="p-4">
                    {tab === "doc" && (
                      <>
                        <h3 className="font-cyber mb-3 text-sm font-bold uppercase tracking-wider">{result.draft.documentTitle}</h3>
                        <div className="doc-paper p-4 sm:p-6"><DocView body={result.draft.body} labels={labels} onOpen={(id) => setOpenId(id)} /></div>
                        {open && (
                          <div className="mt-4 p-4 text-sm" style={{ border: "1.5px solid var(--orange)" }}>
                            <div className="mb-1 flex items-start justify-between gap-3">
                              <strong className="font-cyber text-xs uppercase tracking-wider">{open.label}{open.title ? ` — ${open.title}` : ""}</strong>
                              <button onClick={() => setOpenId(null)} className="font-mono-hud text-xs" style={{ color: "var(--muted)" }}>[ CLOSE ]</button>
                            </div>
                            <p className="font-doc mb-2 text-xs" style={{ color: "var(--muted)" }}>Why it applies: {open.why}</p>
                            <pre className="font-doc max-h-72 overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed">{open.text}</pre>
                          </div>
                        )}
                        {result.draft.placeholders.length > 0 && (
                          <p className="font-mono-hud mt-4 text-[0.72rem]" style={{ color: "var(--amber)" }}>FILL BEFORE FILING: <span className="font-doc">{result.draft.placeholders.join(", ")}</span></p>
                        )}
                      </>
                    )}
                    {tab === "rights" && (
                      <dl className="space-y-3">
                        {result.rules.map((r) => (
                          <div key={r.key} className="p-3" style={{ border: "1.5px solid var(--line)", borderLeft: "3px solid var(--green)" }}>
                            <dt className="font-cyber text-xs font-bold uppercase tracking-wider">{r.label}</dt>
                            <dd className="font-doc mt-1 text-sm">{r.value}</dd>
                            <dd className="font-mono-hud mt-1 text-[0.68rem]" style={{ color: "var(--muted)" }}>BASIS: {r.basis.map((b) => (b.section ? `§${b.section.replace("-", " ")}` : b.instrument)).join(" · ")}</dd>
                          </div>
                        ))}
                        <p className="font-mono-hud text-[0.68rem]" style={{ color: "var(--muted)" }}>&gt; COMPUTED BY THE RULES ENGINE FROM THE STATUTE — NOT BY THE AI MODEL</p>
                      </dl>
                    )}
                    {tab === "law" && (
                      <div className="space-y-3">
                        {result.selected.map((s) => (
                          <details key={s.id} className="p-3" style={{ border: "1.5px solid var(--line)", borderLeft: "3px solid var(--orange)" }}>
                            <summary className="cursor-pointer">
                              <span className="font-cyber text-xs font-bold uppercase tracking-wider">{s.label}</span>{s.title ? <span className="font-doc text-sm"> — {s.title}</span> : null}
                              <div className="font-doc mt-1 text-xs" style={{ color: "var(--muted)" }}>{s.why}</div>
                            </summary>
                            <pre className="font-doc mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-[13px] leading-relaxed">{s.text}</pre>
                            <a href={s.source} target="_blank" rel="noreferrer" className="font-mono-hud mt-2 inline-block text-xs underline" style={{ color: "var(--orange)" }}>[ OFFICIAL TEXT PDF ]</a>
                          </details>
                        ))}
                        <p className="font-mono-hud text-[0.68rem]" style={{ color: "var(--muted)" }}>&gt; QUERIES WRITTEN BY THE RESEARCH AGENT: <span className="font-doc">{result.queries.map((q) => `"${q}"`).join(", ")}</span></p>
                      </div>
                    )}
                    {tab === "checks" && (
                      <div className="space-y-3 text-sm">
                        {result.revised && <p className="font-mono-hud text-[0.72rem]" style={{ color: "var(--amber)" }}>&gt; FIRST DRAFT FAILED VERIFICATION — REVISED BY DRAFT_AGENT</p>}
                        {result.verification.codeIssues.map((c) => <p key={c} className="font-doc" style={{ color: "var(--bad)" }}>✕ {c}</p>)}
                        {result.verification.factIssues.map((f, i) => (
                          <div key={`f${i}`} className="p-3" style={{ border: "1.5px solid var(--amber)" }}>
                            <div className="font-mono-hud text-[0.7rem]" style={{ color: "var(--amber)" }}>⚠ CHECK BEFORE FILING — SAYS MORE THAN YOU TOLD ME</div>
                            <div className="font-doc mt-1 italic">&ldquo;{f.statement}&rdquo;</div>
                            <div className="font-doc mt-1 text-xs" style={{ color: "var(--muted)" }}>{f.problem}</div>
                          </div>
                        ))}
                        {checks.map((c, i) => (
                          <div key={i} className="p-3" style={{ border: "1.5px solid var(--line)", borderLeft: `3px solid ${c.supported ? "var(--green)" : "var(--bad)"}` }}>
                            <div className="font-mono-hud text-[0.7rem]" style={{ color: c.supported ? "var(--ok)" : "var(--bad)" }}>{c.supported ? "✓ SUPPORTED" : "✕ NOT SUPPORTED"} · {labels[c.id] ?? c.id}</div>
                            <div className="font-doc mt-1 italic">&ldquo;{c.claim}&rdquo;</div>
                            <div className="font-doc mt-1 text-xs" style={{ color: "var(--muted)" }}>{c.note}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="telemetry normal-case">
                    <span className="font-doc text-[11.5px]">{result.disclaimer} {result.help.join(" ")}</span>
                  </div>
                </Panel>
              )}
            </div>
          </div>
        )}

        <footer className="font-mono-hud mt-10 text-center text-[0.68rem] uppercase tracking-wider" style={{ color: "var(--muted)" }}>
          Sources: BNS 2023 · BNSS 2023 · Consumer Protection Act 2019 · RTI Act 2005 · IT Act 2000 // Built by Shravan Kasar
        </footer>
      </main>
    </>
  );
}
