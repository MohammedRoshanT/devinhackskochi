import type { AssuranceReport, AuthorizationScenario, MissingCheck, MutationReport } from "../models/results";

export const TYPICAL_SUITE_NAME = "typical";
export const GENERATED_SUITE_NAME = "generated";

/** Owner-only smoke checks: three existing generated scenarios, no cross-user access checks. */
export const TYPICAL_SCENARIO_IDS = ["case:alice:note-a:read", "case:alice:note-a:update", "case:bob:note-b:update"] as const;

export function selectTypicalSuite(scenarios: AuthorizationScenario[]): AuthorizationScenario[] {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  const missing = TYPICAL_SCENARIO_IDS.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`The typical suite expects these generated scenarios, which are absent: ${missing.join(", ")}`);
  return TYPICAL_SCENARIO_IDS.map((id) => byId.get(id)!);
}

/**
 * Scenarios that caught a mutation in the complete generated suite but are absent from a
 * weaker suite in which that same mutation survived. Only genuinely survived mutations
 * qualify — caught or inconclusive outcomes produce no entries, and a scenario is listed
 * only when it actually caught the mutation in the generated suite.
 */
export function computeMissingChecks(weakScenarios: AuthorizationScenario[], weakMutations: MutationReport[], generated: AssuranceReport): MissingCheck[] {
  const present = new Set(weakScenarios.map((s) => s.id));
  const generatedById = new Map(generated.scenarios.map((s) => [s.id, s]));
  const generatedMutations = new Map(generated.mutations.map((m) => [m.mutation.id, m]));
  const missing: MissingCheck[] = [];
  const seen = new Set<string>();
  for (const weak of weakMutations) {
    if (weak.status !== "survived") continue;
    const strong = generatedMutations.get(weak.mutation.id);
    if (!strong || strong.status !== "caught") continue;
    for (const id of strong.caughtBy) {
      if (present.has(id) || seen.has(id)) continue;
      seen.add(id);
      const scenario = generatedById.get(id);
      if (!scenario) continue;
      missing.push({ scenarioId: scenario.id, identityId: scenario.identityId, resourceId: scenario.resourceId, action: scenario.action, expectedOutcome: scenario.expectedOutcome });
    }
  }
  return missing;
}
