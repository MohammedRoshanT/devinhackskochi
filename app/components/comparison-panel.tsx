import type { ComparisonSuite } from "@/src/core/models/results";
import { Section, Badge, type Tone } from "./evidence-dashboard";

const STATUS_TONE: Record<string, Tone> = { caught: "green", survived: "amber", inconclusive: "violet" };
const OUTCOME_LABEL: Record<ComparisonSuite["outcome"]["status"], { tone: Tone; label: string }> = {
  "all-caught": { tone: "green", label: "All mutations caught" },
  survivors: { tone: "amber", label: "A mutation survived" },
  inconclusive: { tone: "violet", label: "Inconclusive" },
  error: { tone: "red", label: "Error" },
};

/**
 * Renders `npm run lab:compare` reports: the same mutation campaign run against a small
 * owner-only "typical" suite and the full generated suite, side by side, entirely from the
 * real report. Only present when the report contains comparison data.
 */
export function ComparisonPanel({ suites }: { suites: ComparisonSuite[] }) {
  return (
    <Section
      title="Why suite coverage matters"
      subtitle="The same mutation campaign ran against each suite. A scenario that expects a denial and observes an allow under the mutation is the evidence that caught the flaw — but a suite that passes is not proof of safety: 'survived' only means the mutation was never observed, not that the policy is secure."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {suites.map((suite) => {
          const outcome = OUTCOME_LABEL[suite.outcome.status];
          return (
            <div key={suite.name} className={`rounded-xl border p-5 ${outcome.tone === "green" ? "border-emerald-300 bg-emerald-50/60" : outcome.tone === "amber" ? "border-amber-300 bg-amber-50/60" : outcome.tone === "violet" ? "border-violet-300 bg-violet-50/60" : "border-red-300 bg-red-50/60"}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900"><code>{suite.name}</code> suite</h3>
                <Badge tone={outcome.tone}>{outcome.label}</Badge>
              </div>
              <dl className="mt-3 space-y-1.5 text-sm text-slate-700">
                <div className="flex gap-2"><dt className="w-40 shrink-0 font-medium">Baseline</dt><dd>{suite.baseline ? `${suite.baseline.passed}/${suite.baseline.total} passed` : "not run"}</dd></div>
                {suite.mutations.map((m) => (
                  <div key={m.mutation.id} className="flex gap-2">
                    <dt className="w-40 shrink-0 font-medium">Mutation {m.mutation.id}</dt>
                    <dd>
                      <Badge tone={STATUS_TONE[m.status] ?? "slate"}>{m.status}</Badge>
                      {m.caughtBy.length > 0 && <span className="ml-2 text-xs">caught by: {m.caughtBy.map((id) => <code key={id} className="mr-1">{id}</code>)}</span>}
                      {m.status === "survived" && <span className="ml-2 text-xs text-slate-600">{m.reason}</span>}
                    </dd>
                  </div>
                ))}
                {suite.baselineAfterRestore && <div className="flex gap-2"><dt className="w-40 shrink-0 font-medium">After restore</dt><dd>{suite.baselineAfterRestore.passed}/{suite.baselineAfterRestore.total} passed</dd></div>}
              </dl>
              {suite.missingChecks.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-semibold text-slate-900">Checks missing from this suite</h4>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead><tr className="text-slate-500"><th className="pb-1 font-medium">Scenario</th><th className="pb-1 font-medium">Identity</th><th className="pb-1 font-medium">Resource</th><th className="pb-1 font-medium">Action</th><th className="pb-1 font-medium">Expected</th></tr></thead>
                    <tbody>
                      {suite.missingChecks.map((c) => (
                        <tr key={c.scenarioId} className="border-t border-slate-200/70">
                          <td className="py-1 pr-2"><code>{c.scenarioId}</code></td>
                          <td className="py-1 pr-2">{c.identityId}</td>
                          <td className="py-1 pr-2">{c.resourceId}</td>
                          <td className="py-1 pr-2">{c.action}</td>
                          <td className="py-1">{c.expectedOutcome}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
