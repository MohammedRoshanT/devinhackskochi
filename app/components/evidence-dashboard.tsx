"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LabRunState, ReportResponse } from "@/app/lib/lab-types";
import type { AssuranceReport, AuthorizationScenario, MutationReport, ScenarioResult, SuiteRun } from "@/src/core/models/results";

import { ComparisonPanel } from "./comparison-panel";

export type Tone = "green" | "red" | "amber" | "violet" | "slate" | "sky";
const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/30",
  red: "bg-red-50 text-red-800 ring-red-600/30",
  amber: "bg-amber-50 text-amber-900 ring-amber-600/30",
  violet: "bg-violet-50 text-violet-800 ring-violet-600/30",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  sky: "bg-sky-50 text-sky-800 ring-sky-600/30",
};
const PANEL: Record<Tone, string> = {
  green: "border-emerald-300 bg-emerald-50 text-emerald-950",
  red: "border-red-300 bg-red-50 text-red-950",
  amber: "border-amber-300 bg-amber-50 text-amber-950",
  violet: "border-violet-300 bg-violet-50 text-violet-950",
  slate: "border-slate-300 bg-slate-50 text-slate-900",
  sky: "border-sky-300 bg-sky-50 text-sky-950",
};

const OUTCOME: Record<AssuranceReport["outcome"]["status"], { tone: Tone; label: string; headline: string }> = {
  "all-caught": { tone: "green", label: "All mutations caught", headline: "The generated tests detected every injected authorization regression." },
  survivors: { tone: "amber", label: "Mutation survived", headline: "A mutation went undetected: the generated test suite has a blind spot." },
  inconclusive: { tone: "violet", label: "Inconclusive", headline: "At least one mutation could not be evaluated cleanly; it is not counted as caught." },
  error: { tone: "red", label: "Error", headline: "The run did not complete its checks; no detection claim is made." },
};
const MUTATION: Record<MutationReport["status"], { tone: Tone; label: string }> = {
  caught: { tone: "green", label: "Caught" },
  survived: { tone: "amber", label: "Survived" },
  inconclusive: { tone: "violet", label: "Inconclusive" },
};
const EXIT_CODES: Record<number, string> = {
  0: "exit 0 — all mutations caught",
  1: "exit 1 — error or inconclusive",
  2: "exit 2 — a mutation survived",
};
const KEY_EVIDENCE = ["rowsReturned", "rowsAffected", "dataChanged", "sqlstate"];

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]}`}>{children}</span>;
}

export function Section({ title, subtitle, children, actions }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
        </div>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

const formatTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
const seconds = (from: string, to: string | null, now: number) => Math.max(0, Math.round(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000));

function OutcomePill({ outcome }: { outcome: "allow" | "deny" }) {
  return <span className={`rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${outcome === "allow" ? "bg-sky-100 text-sky-800" : "bg-slate-800 text-white"}`}>{outcome}</span>;
}

function verdictBadge(result: ScenarioResult, context: "baseline" | "mutation") {
  if (result.verdict === "error") return <Badge tone="red">Error</Badge>;
  if (context === "mutation") return result.verdict === "failed" ? <Badge tone="green">Failed → caught it</Badge> : <Badge tone="slate">Passed · unaffected</Badge>;
  return result.verdict === "passed" ? <Badge tone="green">Passed</Badge> : <Badge tone="red">Failed</Badge>;
}

function EvidenceSummary({ result }: { result: ScenarioResult }) {
  if (result.status === "error") return <span className="text-xs text-red-700">{result.message}</span>;
  const items = Object.entries(result.evidence).filter(([key]) => KEY_EVIDENCE.includes(key));
  return (
    <span className="flex flex-wrap gap-1">
      {items.map(([key, value]) => (
        <code key={key} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{key}={String(value)}</code>
      ))}
    </span>
  );
}

function SuiteTable({ suite, scenarios, context }: { suite: SuiteRun; scenarios: Map<string, AuthorizationScenario>; context: "baseline" | "mutation" }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="py-2 pr-3 font-medium">Scenario</th>
            <th className="py-2 pr-3 font-medium">Expected</th>
            <th className="py-2 pr-3 font-medium">Observed</th>
            <th className="py-2 pr-3 font-medium">Verdict</th>
            <th className="py-2 pr-3 font-medium">Evidence from PostgreSQL</th>
            <th className="py-2 font-medium"><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <tbody>
          {suite.results.map((result) => {
            const scenario = scenarios.get(result.scenarioId);
            const expanded = open === result.scenarioId;
            const highlight = context === "mutation" && result.verdict === "failed";
            return [
              <tr key={result.scenarioId} className={`border-b border-slate-100 align-middle ${highlight ? "bg-emerald-50/60" : ""}`}>
                <td className="py-2 pr-3">
                  <span className="font-medium text-slate-900">{result.identityId}</span>
                  <span className="text-slate-500"> {result.action} </span>
                  <span className="font-medium text-slate-900">{result.resourceId}</span>
                  {scenario?.declaredExpectation && <span className="ml-2"><Badge tone="sky">declared</Badge></span>}
                </td>
                <td className="py-2 pr-3"><OutcomePill outcome={result.expectedOutcome} /></td>
                <td className="py-2 pr-3">{result.status === "completed" ? <OutcomePill outcome={result.observedOutcome} /> : <span className="text-xs text-slate-500">—</span>}</td>
                <td className="py-2 pr-3">{verdictBadge(result, context)}</td>
                <td className="py-2 pr-3"><EvidenceSummary result={result} /></td>
                <td className="py-2 text-right">
                  <button type="button" onClick={() => setOpen(expanded ? null : result.scenarioId)} aria-expanded={expanded} className="text-xs font-medium text-indigo-600 hover:underline">
                    {expanded ? "Hide" : "Details"}
                  </button>
                </td>
              </tr>,
              expanded && (
                <tr key={`${result.scenarioId}:details`} className="border-b border-slate-100 bg-slate-50">
                  <td colSpan={6} className="px-3 py-3">
                    <dl className="grid gap-3 text-xs md:grid-cols-2">
                      <div>
                        <dt className="font-semibold text-slate-700">Scenario</dt>
                        <dd className="mt-1 font-mono text-slate-800">{result.scenarioId}</dd>
                        {scenario && (
                          <>
                            <dt className="mt-2 font-semibold text-slate-700">Why this outcome is expected</dt>
                            <dd className="mt-1 text-slate-800">{scenario.explanation}</dd>
                            <dt className="mt-2 font-semibold text-slate-700">Basis</dt>
                            <dd className="mt-1 text-slate-800">
                              {scenario.basis}{scenario.matchedRuleIds.length ? ` (${scenario.matchedRuleIds.join(", ")})` : ""}
                              {scenario.declaredExpectation ? " · pinned in spec expectations" : " · derived from rules only"}
                            </dd>
                          </>
                        )}
                      </div>
                      <div>
                        <dt className="font-semibold text-slate-700">Raw evidence recorded by the adapter</dt>
                        <dd className="mt-1">
                          <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-slate-100">{JSON.stringify(result.status === "completed" ? result.evidence : { message: result.message, ...(result.evidence ?? {}) }, null, 2)}</pre>
                        </dd>
                      </div>
                    </dl>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function SuiteSummary({ suite }: { suite: SuiteRun | null }) {
  if (!suite) return <span className="text-slate-500">not run</span>;
  return (
    <span>
      <span className="text-2xl font-semibold text-slate-900">{suite.passed}/{suite.total}</span> <span className="text-sm text-slate-600">passed</span>
      {(suite.failed > 0 || suite.errors > 0) && <span className="ml-2 text-sm text-red-700">{suite.failed} failed · {suite.errors} errors</span>}
    </span>
  );
}

function StatCard({ label, children, tone }: { label: string; children: ReactNode; tone: Tone }) {
  const bar: Record<Tone, string> = { green: "bg-emerald-500", red: "bg-red-500", amber: "bg-amber-500", violet: "bg-violet-500", slate: "bg-slate-300", sky: "bg-sky-500" };
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <span aria-hidden className={`absolute inset-x-0 top-0 h-1 ${bar[tone]}`} />
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function MutationCard({ mutation, scenarios }: { mutation: MutationReport; scenarios: Map<string, AuthorizationScenario> }) {
  const status = MUTATION[mutation.status];
  const fingerprintsMatch = mutation.restoration.expectedFingerprint !== null && mutation.restoration.expectedFingerprint === mutation.restoration.observedFingerprint;
  return (
    <Section
      title={`Mutation: ${mutation.mutation.id}`}
      subtitle={mutation.mutation.description}
      actions={<span className="text-base"><Badge tone={status.tone}>{status.label}</Badge></span>}
    >
      <div className="flex flex-col gap-5">
        <p className={`rounded-lg border px-4 py-3 text-sm ${PANEL[status.tone]}`}>
          <span className="font-semibold">{status.label}:</span> {mutation.reason}
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Policy change applied (inside a rolled-back transaction)</h3>
            {mutation.change ? (
              <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 font-mono text-xs">
                <div className="bg-slate-900 px-3 py-2 text-slate-100">{mutation.change.statements.map((s) => <div key={s}>{s};</div>)}</div>
                <div className="bg-red-50 px-3 py-2 text-red-900"><span className="select-none">− </span>{mutation.change.before}</div>
                <div className="bg-emerald-50 px-3 py-2 text-emerald-900"><span className="select-none">+ </span>{mutation.change.after}</div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No change was applied.</p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Caught by</h3>
            {mutation.caughtBy.length ? (
              <ul className="mt-2 flex flex-col gap-1.5">
                {mutation.caughtBy.map((id) => {
                  const result = mutation.suite?.results.find((r) => r.scenarioId === id);
                  return (
                    <li key={id} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                      <code className="text-xs">{id}</code>
                      {result?.status === "completed" && (
                        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                          expected <OutcomePill outcome={result.expectedOutcome} /> observed <OutcomePill outcome={result.observedOutcome} /> <EvidenceSummary result={result} />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No scenario detected this mutation.</p>
            )}
            <h3 className="mt-4 text-sm font-semibold text-slate-800">Restoration</h3>
            <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${PANEL[mutation.restoration.verified ? "green" : "red"]}`}>
              <p className="font-semibold">{mutation.restoration.verified ? "Verified — original policies intact" : "NOT verified"}</p>
              <p className="mt-1 text-xs">{mutation.restoration.message} {mutation.restoration.method}</p>
              <p className="mt-1 text-xs">Fingerprint before vs after: {fingerprintsMatch ? "identical" : "different or unavailable"}</p>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-800">Relevant scenarios re-run under the mutation</h3>
          <p className="mb-2 text-xs text-slate-600">Only scenarios for {mutation.mutation.target.resourceType}/{mutation.mutation.target.action} are re-run. A failed expectation here means the test noticed the regression.</p>
          {mutation.suite ? <SuiteTable suite={mutation.suite} scenarios={scenarios} context="mutation" /> : <p className="text-sm text-slate-600">Scenarios were not executed under this mutation.</p>}
        </div>

        {mutation.restoration.expectedFingerprint && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-indigo-600">Show authorization-state fingerprint (tables, policies, grants, identity helper)</summary>
            <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-slate-900 p-3 text-slate-100">{JSON.stringify(JSON.parse(mutation.restoration.expectedFingerprint), null, 2)}</pre>
          </details>
        )}
      </div>
    </Section>
  );
}

function ReportView({ report, modifiedAt, path }: { report: AssuranceReport; modifiedAt: string; path: string }) {
  const scenarios = useMemo(() => new Map(report.scenarios.map((s) => [s.id, s])), [report]);
  const outcome = OUTCOME[report.outcome.status];
  const caught = report.mutations.filter((m) => m.status === "caught").length;
  const restored = report.mutations.length > 0 && report.mutations.every((m) => m.restoration.verified);
  const [tab, setTab] = useState<"baseline" | "after">("baseline");
  const download = useMemo(() => `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(report, null, 2))}`, [report]);

  return (
    <div className="flex flex-col gap-6">
      <div className={`rounded-xl border px-5 py-4 ${PANEL[outcome.tone]}`} role="status">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
          <p className="text-lg font-semibold">{outcome.headline}</p>
        </div>
        <p className="mt-1 text-sm">Engine message: {report.outcome.message}</p>
        <p className="mt-2 text-xs opacity-80">
          {report.specification} · adapter <code>{report.adapter.id}</code> · generated {formatTime(report.generatedAt)} · file <code>{path}</code> (modified {formatTime(modifiedAt)}) ·{" "}
          <a href={download} download="assurance-report.json" className="font-medium underline">download JSON</a>
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="1 · Baseline (secure policy)" tone={report.baseline?.allPassed ? "green" : "red"}><SuiteSummary suite={report.baseline} /></StatCard>
        <StatCard label="2 · Mutations caught" tone={report.mutations.length === 0 ? "slate" : caught === report.mutations.length ? "green" : "amber"}>
          <span className="text-2xl font-semibold text-slate-900">{caught}/{report.mutations.length}</span> <span className="text-sm text-slate-600">caught</span>
          <div className="mt-1 flex flex-wrap gap-1">{report.mutations.map((m) => <Badge key={m.mutation.id} tone={MUTATION[m.status].tone}>{m.mutation.id}: {m.status}</Badge>)}</div>
        </StatCard>
        <StatCard label="3 · Restoration verified" tone={report.mutations.length === 0 ? "slate" : restored ? "green" : "red"}>
          <span className="text-2xl font-semibold text-slate-900">{report.mutations.length === 0 ? "—" : restored ? "Yes" : "No"}</span>
          <p className="text-xs text-slate-600">Catalog compared on a fresh connection</p>
        </StatCard>
        <StatCard label="4 · Baseline after restore" tone={report.baselineAfterRestore ? (report.baselineAfterRestore.allPassed ? "green" : "red") : "slate"}><SuiteSummary suite={report.baselineAfterRestore} /></StatCard>
      </div>

      {report.comparison && <ComparisonPanel suites={report.comparison.suites} />}

      {report.mutations.map((m) => <MutationCard key={m.mutation.id} mutation={m} scenarios={scenarios} />)}

      <Section
        title="Authorization test results"
        subtitle="Every generated scenario, executed against the secure policy as the non-superuser application role."
        actions={
          <div className="flex rounded-lg bg-slate-100 p-1 text-sm">
            {(["baseline", "after"] as const).map((key) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-md px-3 py-1 ${tab === key ? "bg-white font-medium shadow-sm" : "text-slate-600"}`}>
                {key === "baseline" ? "Baseline" : "After restoration"}
              </button>
            ))}
          </div>
        }
      >
        {(() => {
          const suite = tab === "baseline" ? report.baseline : report.baselineAfterRestore;
          return suite ? <SuiteTable suite={suite} scenarios={scenarios} context="baseline" /> : <p className="text-sm text-slate-600">This suite was not run (see the engine message above).</p>;
        })()}
      </Section>

      <Section title="Environment checks" subtitle={report.environment.ok ? "All safeguards were confirmed before any test ran." : "A safeguard failed, so no tests or mutations were run."}>
        <ul className="grid gap-2 md:grid-cols-2">
          {report.environment.checks.map((check) => (
            <li key={check.name} className="flex items-start gap-2 text-sm">
              <span aria-hidden className={check.passed ? "text-emerald-600" : "text-red-600"}>{check.passed ? "✔" : "✘"}</span>
              <span><span className="font-medium">{check.name}</span> <span className="text-slate-600">— {check.detail}</span></span>
            </li>
          ))}
        </ul>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-slate-600">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul>
      </Section>
    </div>
  );
}

function Legend() {
  const rows: [ReactNode, string][] = [
    [<Badge key="c" tone="green">Caught</Badge>, "The mutation was applied cleanly and at least one test observed an outcome that contradicts the specification."],
    [<Badge key="s" tone="amber">Survived</Badge>, "Every relevant test still matched the specification. This is a blind spot in the test suite, not automatically a production vulnerability."],
    [<Badge key="i" tone="violet">Inconclusive</Badge>, "The mutation could not be applied, or a test errored under it. Errors are never counted as detection."],
    [<Badge key="e" tone="red">Error</Badge>, "Setup, baseline or restoration checks failed, so the engine stopped without making a detection claim."],
    [<Badge key="d" tone="sky">declared</Badge>, "declaredExpectation: the outcome is pinned in the spec's expectations list as well as derived from the rules. The validator rejects the spec if the two disagree. Unmarked scenarios are derived from the rules only."],
  ];
  return (
    <Section title="How to read this">
      <dl className="grid gap-3 text-sm md:grid-cols-2">
        {rows.map(([badge, text], index) => (
          <div key={index} className="flex gap-3"><dt className="w-28 shrink-0">{badge}</dt><dd className="text-slate-700">{text}</dd></div>
        ))}
      </dl>
    </Section>
  );
}

function RunPanel({ run, onRun, runError, report, now }: { run: LabRunState | null; onRun: () => void; runError: string | null; report: AssuranceReport | null; now: number }) {
  const running = run?.status === "running";
  const finished = run?.status === "finished" && run.startedAt;
  const produced = finished && report ? Date.parse(report.generatedAt) >= Date.parse(run.startedAt!) : false;
  const failed = finished && (run.exitCode === null || run.exitCode === 1);
  const staleNote = finished && !produced ? (report ? " It did not write a new report; the report below is from an earlier run." : " No report file is currently available.") : "";
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ol className="flex flex-wrap items-center gap-2 text-sm">
          {["Inspect the current report", "Run the lab", "Review the evidence"].map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${index === 1 && running ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700"}`}>{index + 1}</span>
              <span className="text-slate-700">{label}</span>
              {index < 2 && <span aria-hidden className="text-slate-300">→</span>}
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-400"
        >
          {running && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
          {running ? "Running lab…" : "Run lab"}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-600">
        Runs the fixed command <code className="rounded bg-slate-100 px-1">npm run lab</code> on this server: a disposable PostgreSQL 16 container on 127.0.0.1 is created,
        tested, mutated inside a rolled-back transaction, verified, and removed. The browser cannot change the command or the database target. Takes about 10 seconds.
      </p>
      {runError && <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{runError}</p>}
      {run && run.status !== "idle" && run.startedAt && (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${PANEL[running ? "sky" : failed ? "red" : run.exitCode === 2 ? "amber" : "green"]}`}>
          <p className="font-medium">
            {running && `Running for ${seconds(run.startedAt, null, now)}s…`}
            {finished && !failed && `Last run finished in ${seconds(run.startedAt, run.finishedAt, now)}s (${EXIT_CODES[run.exitCode!] ?? `exit ${run.exitCode}`}).${staleNote || " The report below is from this run."}`}
            {finished && failed && `Last run failed (${run.exitCode === null ? "no exit code" : EXIT_CODES[run.exitCode] ?? `exit ${run.exitCode}`})${run.error ? `: ${run.error}` : "."}${staleNote}`}
          </p>
          <details className="mt-1" open={running || Boolean(failed)}>
            <summary className="cursor-pointer text-xs">Command output ({run.log.length} lines)</summary>
            <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-xs text-slate-100">{run.log.join("\n") || "Waiting for output…"}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

type ReportState = { kind: "loading" } | { kind: "loaded"; data: ReportResponse } | { kind: "error"; message: string };

async function fetchReportState(): Promise<ReportState> {
  try {
    const response = await fetch("/api/report", { cache: "no-store" });
    if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${response.status}`);
    return { kind: "loaded", data: (await response.json()) as ReportResponse };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchRunState(): Promise<LabRunState> {
  const response = await fetch("/api/lab", { cache: "no-store" });
  return (await response.json()) as LabRunState;
}

export function EvidenceDashboard() {
  const [reportState, setReportState] = useState<ReportState>({ kind: "loading" });
  const [run, setRun] = useState<LabRunState | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const loadReport = useCallback(async () => setReportState(await fetchReportState()), []);
  const loadRun = useCallback(async () => {
    const state = await fetchRunState();
    setRun(state);
    return state;
  }, []);

  useEffect(() => {
    let active = true;
    void fetchReportState().then((state) => active && setReportState(state));
    void fetchRunState().then((state) => active && setRun(state), () => undefined);
    return () => {
      active = false;
    };
  }, []);

  const running = run?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void loadRun().then((state) => {
        if (state.status !== "running") void loadReport();
      }).catch(() => undefined);
    }, 1000);
    return () => clearInterval(timer);
  }, [running, loadRun, loadReport]);

  const startRun = async () => {
    setRunError(null);
    try {
      const response = await fetch("/api/lab", { method: "POST", headers: { "x-aal-action": "run-lab" } });
      const body = (await response.json()) as LabRunState & { error?: string };
      if (response.status === 403) throw new Error(body.error ?? "Run rejected by the server.");
      setNow(Date.now());
      setRun(body);
      if (response.status === 409) setRunError("A lab run is already in progress; showing its progress.");
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    }
  };

  const data = reportState.kind === "loaded" ? reportState.data : null;
  const report = data?.status === "ok" ? data.report : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Mutation testing for authorization</p>
        <h1 className="text-3xl font-semibold">Do your authorization tests catch a broken policy?</h1>
        <p className="max-w-3xl text-slate-600">
          The lab generates authorization tests from a permission specification, runs them against real PostgreSQL Row Level Security, then deliberately
          weakens a policy in a throwaway database to see whether the tests notice. Everything below is read from the engine&apos;s JSON report.
        </p>
      </header>

      <RunPanel run={run} onRun={startRun} runError={runError} report={report} now={now} />

      {reportState.kind === "loading" && (
        <div aria-busy className="grid gap-4 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-slate-200" />)}
          <p className="sr-only">Loading report…</p>
        </div>
      )}
      {reportState.kind === "error" && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-900">
          Could not load the report from the server: {reportState.message}
        </p>
      )}
      {data?.status === "missing" && (
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-white px-6 py-10 text-center">
          <p className="text-lg font-semibold">No report yet</p>
          <p className="mx-auto mt-1 max-w-xl text-sm text-slate-600">
            <code>{data.path}</code> does not exist. Click <span className="font-medium">Run lab</span> above, or run <code className="rounded bg-slate-100 px-1">npm run lab</code> in a terminal and reload this page.
            Nothing is shown until the engine has actually produced a report.
          </p>
        </div>
      )}
      {data?.status === "invalid" && (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 px-5 py-4 text-sm text-red-900">
          <code>{data.path}</code> is not a valid engine report ({data.error}). Re-run the lab to regenerate it.
        </p>
      )}
      {data?.status === "ok" && <ReportView report={data.report} modifiedAt={data.modifiedAt} path={data.path} />}

      <Legend />
    </main>
  );
}
