import type {
  AppliedChange,
  AssuranceReport,
  AuthorizationScenario,
  EnvironmentCheck,
  MutationDefinition,
  MutationReport,
  Observation,
  RestorationCheck,
  ScenarioResult,
  SuiteRun,
} from "../models/results";

export type MutationExecution =
  | { applied: true; change: AppliedChange; observations: Observation[] }
  | { applied: false; reason: string; change: AppliedChange | null };

/**
 * Backend-specific executor. Implementations must guarantee that neither scenario runs nor
 * mutations persist any change, regardless of success or failure.
 */
export interface AuthorizationAdapter {
  readonly id: string;
  readonly description: string;
  checkEnvironment(scenarios: AuthorizationScenario[]): Promise<EnvironmentCheck[]>;
  runScenarios(scenarios: AuthorizationScenario[]): Promise<Observation[]>;
  runScenariosUnderMutation(mutation: MutationDefinition, scenarios: AuthorizationScenario[]): Promise<MutationExecution>;
  /** Canonical description of the authorization configuration, used to verify restoration. */
  captureAuthorizationState(): Promise<string>;
}

export interface CampaignOptions {
  specificationName: string;
  adapter: AuthorizationAdapter;
  scenarios: AuthorizationScenario[];
  mutations: MutationDefinition[];
  now?: () => Date;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function toSuiteRun(scenarios: AuthorizationScenario[], observations: Observation[]): SuiteRun {
  if (observations.length !== scenarios.length) {
    throw new Error(`Adapter returned ${observations.length} observations for ${scenarios.length} scenarios.`);
  }
  const results = scenarios.map((scenario, index): ScenarioResult => {
    const observation = observations[index]!;
    const base = {
      scenarioId: scenario.id,
      identityId: scenario.identityId,
      resourceId: scenario.resourceId,
      action: scenario.action,
      expectedOutcome: scenario.expectedOutcome,
    };
    return observation.status === "completed"
      ? { ...base, status: "completed", observedOutcome: observation.observedOutcome, evidence: observation.evidence, verdict: observation.observedOutcome === scenario.expectedOutcome ? "passed" : "failed" }
      : { ...base, status: "error", verdict: "error", message: observation.message, ...(observation.evidence ? { evidence: observation.evidence } : {}) };
  });
  const passed = results.filter((r) => r.verdict === "passed").length;
  const failed = results.filter((r) => r.verdict === "failed").length;
  const errors = results.length - passed - failed;
  return { total: results.length, passed, failed, errors, allPassed: results.length > 0 && passed === results.length, results };
}

export const isRelevant = (mutation: MutationDefinition, scenario: AuthorizationScenario) =>
  scenario.resourceType === mutation.target.resourceType && scenario.action === mutation.target.action;

/** Caught only on a clean run with at least one failed expectation; any execution error is inconclusive. */
export function classifyMutation(execution: MutationExecution, suite: SuiteRun | null): Pick<MutationReport, "status" | "reason" | "caughtBy"> {
  if (!execution.applied) return { status: "inconclusive", reason: `Mutation was not applied: ${execution.reason}`, caughtBy: [] };
  if (!suite || suite.total === 0) return { status: "survived", reason: "No generated scenario exercises the mutated permission.", caughtBy: [] };
  if (suite.errors > 0) return { status: "inconclusive", reason: `${suite.errors} scenario(s) errored under the mutation; errors are not counted as detection.`, caughtBy: [] };
  const caughtBy = suite.results.filter((r) => r.verdict === "failed").map((r) => r.scenarioId);
  return caughtBy.length
    ? { status: "caught", reason: `${caughtBy.length} scenario(s) observed an outcome different from the specification.`, caughtBy }
    : { status: "survived", reason: "Every relevant scenario still matched the specification; the suite has a blind spot for this mutation.", caughtBy: [] };
}

async function runSuite(adapter: AuthorizationAdapter, scenarios: AuthorizationScenario[]): Promise<SuiteRun> {
  try {
    return toSuiteRun(scenarios, await adapter.runScenarios(scenarios));
  } catch (error) {
    return toSuiteRun(scenarios, scenarios.map(() => ({ status: "error", message: message(error) })));
  }
}

async function verifyRestoration(adapter: AuthorizationAdapter, expected: string): Promise<RestorationCheck> {
  const method = "Re-read the authorization configuration on a fresh connection and compare it with the pre-mutation fingerprint.";
  try {
    const observed = await adapter.captureAuthorizationState();
    const verified = observed === expected;
    return { verified, method, expectedFingerprint: expected, observedFingerprint: observed, message: verified ? "Original configuration intact." : "Configuration differs from the pre-mutation state." };
  } catch (error) {
    return { verified: false, method, expectedFingerprint: expected, observedFingerprint: null, message: `Could not read configuration: ${message(error)}` };
  }
}

export async function runMutationCampaign(options: CampaignOptions): Promise<AssuranceReport> {
  const { adapter, scenarios, mutations } = options;
  const report: AssuranceReport = {
    schemaVersion: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    specification: options.specificationName,
    adapter: { id: adapter.id, description: adapter.description },
    outcome: { status: "error", message: "" },
    environment: { ok: false, checks: [] },
    scenarios,
    baseline: null,
    mutations: [],
    baselineAfterRestore: null,
    notes: [
      "Results come from an isolated, disposable test environment, not from a production system.",
      "A surviving mutation indicates a blind spot in the generated test suite, not automatically a production vulnerability.",
    ],
  };

  try {
    report.environment.checks = await adapter.checkEnvironment(scenarios);
  } catch (error) {
    report.environment.checks = [{ name: "environment", passed: false, detail: message(error) }];
  }
  report.environment.ok = report.environment.checks.length > 0 && report.environment.checks.every((c) => c.passed);
  if (!report.environment.ok) {
    report.outcome = { status: "error", message: "Environment checks failed; no tests or mutations were run." };
    return report;
  }

  report.baseline = await runSuite(adapter, scenarios);
  if (!report.baseline.allPassed) {
    report.outcome = { status: "error", message: "Baseline suite did not pass under the original configuration; mutations were not applied." };
    return report;
  }

  for (const mutation of mutations) {
    const relevant = scenarios.filter((scenario) => isRelevant(mutation, scenario));
    let original: string;
    try {
      original = await adapter.captureAuthorizationState();
    } catch (error) {
      report.outcome = { status: "error", message: `Could not capture configuration before ${mutation.id}: ${message(error)}` };
      return report;
    }

    let execution: MutationExecution;
    let suite: SuiteRun | null = null;
    try {
      execution = await adapter.runScenariosUnderMutation(mutation, relevant);
      if (execution.applied) suite = toSuiteRun(relevant, execution.observations);
    } catch (error) {
      execution = { applied: false, reason: `Mutation run failed: ${message(error)}`, change: null };
    }
    const restoration = await verifyRestoration(adapter, original);
    report.mutations.push({
      mutation,
      ...classifyMutation(execution, suite),
      change: execution.change,
      relevantScenarioIds: relevant.map((s) => s.id),
      suite,
      restoration,
    });
    if (!restoration.verified) {
      report.outcome = { status: "error", message: `Restoration could not be verified after ${mutation.id}; stopping.` };
      return report;
    }
  }

  report.baselineAfterRestore = await runSuite(adapter, scenarios);
  if (!report.baselineAfterRestore.allPassed) {
    report.outcome = { status: "error", message: "Baseline suite failed after restoration." };
  } else if (report.mutations.some((m) => m.status === "inconclusive")) {
    report.outcome = { status: "inconclusive", message: "At least one mutation result is inconclusive." };
  } else if (report.mutations.some((m) => m.status === "survived")) {
    report.outcome = { status: "survivors", message: "At least one mutation survived: the generated suite did not detect it." };
  } else {
    report.outcome = { status: "all-caught", message: `All ${report.mutations.length} mutation(s) were caught and the original configuration was restored.` };
  }
  return report;
}
