"use client";

import { useMemo, useState } from "react";
import { generateScenarios } from "@/src/core/generation/generate";
import type { AuthorizationScenario } from "@/src/core/models/results";
import { exampleSpecification } from "@/src/core/rules/example";
import { parseSpecification, type SpecificationIssue, type SpecificationWarning } from "@/src/core/rules/validation";

const exampleSource = JSON.stringify(exampleSpecification, null, 2);

type GenerationState =
  | { status: "idle" }
  | { status: "invalid"; issues: SpecificationIssue[] }
  | { status: "generated"; scenarios: AuthorizationScenario[]; warnings: SpecificationWarning[]; source: string };

type OutcomeFilter = "all" | "allow" | "deny";

export function Dashboard() {
  const [source, setSource] = useState(exampleSource);
  const [state, setState] = useState<GenerationState>({ status: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [identityFilter, setIdentityFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");

  const generate = () => {
    const validation = parseSpecification(source);
    if (!validation.valid) {
      setState({ status: "invalid", issues: validation.issues });
      setSelectedId(null);
      return;
    }
    const result = generateScenarios(validation.specification);
    setState({ status: "generated", ...result, source });
    setSelectedId(result.scenarios[0]?.id ?? null);
    setIdentityFilter("all");
    setOutcomeFilter("all");
  };

  const scenarios = useMemo(() => (state.status === "generated" ? state.scenarios : []), [state]);
  const identities = useMemo(() => [...new Set(scenarios.map((scenario) => scenario.identityId))], [scenarios]);
  const visible = scenarios.filter(
    (scenario) =>
      (identityFilter === "all" || scenario.identityId === identityFilter) &&
      (outcomeFilter === "all" || scenario.expectedOutcome === outcomeFilter),
  );
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? null;
  const stale = state.status === "generated" && state.source !== source;
  const allowCount = scenarios.filter((scenario) => scenario.expectedOutcome === "allow").length;

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-indigo-600">Authorization Assurance Lab</p>
        <h1 className="text-3xl font-semibold">Permission specification → expected test scenarios</h1>
        <p className="max-w-3xl text-slate-600">
          Declare roles, identities, resources and allow/deny rules. The generator derives one expected authorization
          outcome for every identity, resource and action combination.
        </p>
      </header>

      <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Generated scenarios are not security findings.</strong> No application, API or database has been
        contacted or scanned. Each row states what your specification says <em>should</em> happen; nothing here has
        been executed.
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Permission specification (JSON)</h2>
            <button type="button" onClick={() => setSource(exampleSource)} className="text-sm text-indigo-600 hover:underline">
              Reset example
            </button>
          </div>
          <textarea
            aria-label="Permission specification JSON"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            className="h-[32rem] w-full resize-y rounded-md border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button type="button" onClick={generate} className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-700">
            Validate &amp; generate scenarios
          </button>
          {state.status === "invalid" && (
            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-semibold">
                Specification rejected ({state.issues.length} issue{state.issues.length === 1 ? "" : "s"})
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {state.issues.map((issue, index) => (
                  <li key={index}>
                    <code className="text-xs">[{issue.code}] {issue.path}</code> — {issue.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {state.status === "generated" && state.warnings.length > 0 && (
            <div className="rounded-md border border-sky-300 bg-sky-50 p-3 text-sm text-sky-900">
              <p className="font-semibold">Warnings</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {state.warnings.map((warning) => (
                  <li key={warning.path}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Generated scenarios</h2>
            {state.status === "generated" && (
              <p className="text-sm text-slate-600">
                {scenarios.length} scenarios · {allowCount} expected allow · {scenarios.length - allowCount} expected deny
              </p>
            )}
          </div>
          {stale && (
            <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
              The specification changed since generation. Generate again to refresh.
            </p>
          )}
          {state.status !== "generated" ? (
            <p className="py-12 text-center text-sm text-slate-500">
              {state.status === "idle"
                ? "Validate the specification to generate expected scenarios."
                : "Fix the specification issues to generate scenarios."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  Identity
                  <select value={identityFilter} onChange={(event) => setIdentityFilter(event.target.value)} className="rounded border border-slate-300 px-2 py-1">
                    <option value="all">All</option>
                    {identities.map((identity) => (
                      <option key={identity} value={identity}>
                        {identity}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  Expected outcome
                  <select value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value as OutcomeFilter)} className="rounded border border-slate-300 px-2 py-1">
                    <option value="all">All</option>
                    <option value="allow">Allow</option>
                    <option value="deny">Deny</option>
                  </select>
                </label>
              </div>
              <div className="max-h-[22rem] overflow-auto rounded-md border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Identity</th>
                      <th className="px-3 py-2">Resource</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Expected</th>
                      <th className="px-3 py-2">Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((scenario) => (
                      <tr
                        key={scenario.id}
                        onClick={() => setSelectedId(scenario.id)}
                        aria-selected={scenario.id === selectedId}
                        className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${scenario.id === selectedId ? "bg-indigo-50" : ""}`}
                      >
                        <td className="px-3 py-2 font-mono text-xs">{scenario.identityId}</td>
                        <td className="px-3 py-2 font-mono text-xs">{scenario.resourceId}</td>
                        <td className="px-3 py-2 font-mono text-xs">{scenario.action}</td>
                        <td className="px-3 py-2">
                          <OutcomeBadge outcome={scenario.expectedOutcome} />
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {scenario.basis === "default-deny" ? "default deny" : "explicit rule"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visible.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No scenarios match the filters.</p>}
              </div>
              {selected && <ScenarioDetail scenario={selected} />}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function OutcomeBadge({ outcome }: { outcome: "allow" | "deny" }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-xs font-semibold ${outcome === "allow" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}
    >
      expect {outcome}
    </span>
  );
}

function ScenarioDetail({ scenario }: { scenario: AuthorizationScenario }) {
  const rows: [string, string][] = [
    ["Scenario ID", scenario.id],
    ["Identity", `${scenario.identityId} (roles: ${scenario.roles.join(", ") || "none"})`],
    ["Resource", `${scenario.resourceId} (type: ${scenario.resourceType})`],
    ["Owner", scenario.ownerId ?? "none"],
    ["Action", scenario.action],
    ["Matched rules", scenario.matchedRuleIds.join(", ") || "none"],
  ];
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-semibold">Scenario detail</h3>
        <OutcomeBadge outcome={scenario.expectedOutcome} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-slate-500">{label}</dt>
            <dd className="break-all font-mono text-xs leading-5">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-slate-700">{scenario.explanation}</p>
      <p className="mt-1 text-xs text-slate-500">
        Expected outcome derived from the specification only — not executed against any application.
      </p>
    </div>
  );
}
