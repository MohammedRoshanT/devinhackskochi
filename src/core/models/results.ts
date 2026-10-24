import type { AuthorizationOutcome } from "../rules/schema";

export interface AuthorizationScenario {
  id: string;
  identityId: string;
  roles: string[];
  resourceId: string;
  resourceType: string;
  ownerId: string | null;
  action: string;
  expectedOutcome: AuthorizationOutcome;
  basis: "explicit-rule" | "default-deny";
  matchedRuleIds: string[];
  explanation: string;
}

// Contracts for future adapters; generation never creates execution or mutation results.
export type TestExecutionResult = {
  scenarioId: string;
  adapterId: string;
  durationMs: number;
} & (
  | { status: "completed"; expectedOutcome: AuthorizationOutcome; observedOutcome: AuthorizationOutcome; verdict: "passed" | "failed" }
  | { status: "error"; message: string }
);

export type MutationResult = {
  mutationId: string;
  adapterId: string;
  environment: "isolated-test";
} & (
  | { status: "detected"; detectedByScenarioIds: [string, ...string[]]; executions: TestExecutionResult[] }
  | { status: "survived"; detectedByScenarioIds: []; executions: TestExecutionResult[] }
  | { status: "inconclusive"; reason: string }
);
