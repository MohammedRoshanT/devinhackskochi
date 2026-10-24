import { parseArgs } from "node:util";
import { runMutationCampaign } from "../core/mutation/engine";
import { GENERATED_SUITE_NAME, TYPICAL_SUITE_NAME, computeMissingChecks, selectTypicalSuite } from "../core/mutation/suites";
import type { AssuranceReport, ComparisonSuite } from "../core/models/results";
import { resolveRunOptions } from "./lab";
import { loadProject } from "./project";
import { finishRun, ok, printReport, step, warn, withLabDatabase, type RunOptions } from "./run";

const { values: args } = parseArgs({
  allowPositionals: true,
  options: {
    example: { type: "string" },
    config: { type: "string" },
    report: { type: "string" },
    "keep-db": { type: "boolean", default: false },
    "reuse-db": { type: "boolean", default: false },
  },
});

const entry = (name: string, report: AssuranceReport, missingChecks: ComparisonSuite["missingChecks"]): ComparisonSuite =>
  ({ name, outcome: report.outcome, baseline: report.baseline, mutations: report.mutations, baselineAfterRestore: report.baselineAfterRestore, missingChecks });

/**
 * Runs the same mutation campaign against the small `typical` owner-only suite and the full
 * `generated` suite, then returns one combined report: the generated suite's report plus an
 * optional `comparison.suites` section with each suite's own results and missing checks.
 */
export async function runComparison(options: RunOptions): Promise<AssuranceReport> {
  const project = await loadProject(options.example);
  const typicalScenarios = selectTypicalSuite(project.scenarios);
  console.log(`  ${project.spec.name}: ${typicalScenarios.length} typical scenarios vs ${project.scenarios.length} generated, ${project.mutations.length} mutation(s)`);
  return withLabDatabase(options, project, async (adapter) => {
    step(`Baseline + mutation campaign for the "${TYPICAL_SUITE_NAME}" suite`);
    const typicalReport = await runMutationCampaign({ specificationName: `${project.spec.name} (${TYPICAL_SUITE_NAME} suite)`, adapter, scenarios: typicalScenarios, mutations: project.mutations });
    if (typicalReport.outcome.status === "error" || typicalReport.outcome.status === "inconclusive") {
      warn(`The "${TYPICAL_SUITE_NAME}" campaign ended with ${typicalReport.outcome.status}; skipping the "${GENERATED_SUITE_NAME}" campaign because the environment may not be clean.`);
      return { ...typicalReport, comparison: { suites: [entry(TYPICAL_SUITE_NAME, typicalReport, [])] } };
    }
    step(`Baseline + mutation campaign for the "${GENERATED_SUITE_NAME}" suite`);
    const generatedReport = await runMutationCampaign({ specificationName: project.spec.name, adapter, scenarios: project.scenarios, mutations: project.mutations });
    const suites: ComparisonSuite[] = [
      entry(TYPICAL_SUITE_NAME, typicalReport, computeMissingChecks(typicalScenarios, typicalReport.mutations, generatedReport)),
      entry(GENERATED_SUITE_NAME, generatedReport, computeMissingChecks(project.scenarios, generatedReport.mutations, generatedReport)),
    ];
    return { ...generatedReport, comparison: { suites } };
  });
}

function printComparison(report: AssuranceReport) {
  const suites = report.comparison?.suites ?? [];
  if (!suites.length) return;
  step("Suite comparison");
  for (const suite of suites) {
    const mutation = suite.mutations.map((m) => `${m.mutation.id}: ${m.status.toUpperCase()}`).join(", ") || "no mutations";
    const status = suite.outcome.status === "all-caught" ? ok(suite.outcome.status) : warn(suite.outcome.status);
    console.log(`  ${suite.name.padEnd(10)} baseline ${suite.baseline?.passed ?? 0}/${suite.baseline?.total ?? 0} · ${mutation} · outcome ${status}`);
    for (const m of suite.mutations) {
      if (m.status === "survived") console.log(`    survived — blind spot; the suite never observed the unauthorized access`);
    }
    if (suite.missingChecks.length) {
      console.log(`    Checks missing from this suite:`);
      for (const c of suite.missingChecks) console.log(`      ${c.scenarioId} — ${c.identityId} ${c.action} ${c.resourceId}, expected ${c.expectedOutcome}`);
    }
  }
}

async function main(): Promise<number> {
  const options = await resolveRunOptions(args);
  step("Loading specification");
  const report = await runComparison(options);
  printReport(report);
  printComparison(report);
  // Exit semantics mirror `npm run lab`, applied to the generated suite's outcome:
  // 0 = all mutations caught by the generated suite, 2 = a mutation survived, 1 = error/inconclusive.
  return finishRun(report, options.report);
}

if (process.argv[1]?.endsWith("compare.ts")) {
  main().then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
