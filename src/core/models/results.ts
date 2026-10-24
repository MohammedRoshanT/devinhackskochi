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
  /** True when the specification's `expectations` list pins this outcome explicitly. */
  declaredExpectation: boolean;
  explanation: string;
}

export type Evidence = Record<string, string | number | boolean | null>;

/** What an adapter actually observed when executing one scenario. */
export type Observation =
  | { status: "completed"; observedOutcome: AuthorizationOutcome; evidence: Evidence }
  | { status: "error"; message: string; evidence?: Evidence };

export type ScenarioResult = {
  scenarioId: string;
  identityId: string;
  resourceId: string;
  action: string;
  expectedOutcome: AuthorizationOutcome;
} & (
  | { status: "completed"; observedOutcome: AuthorizationOutcome; verdict: "passed" | "failed"; evidence: Evidence }
  | { status: "error"; verdict: "error"; message: string; evidence?: Evidence }
);

export interface SuiteRun {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  allPassed: boolean;
  results: ScenarioResult[];
}

export interface MutationDefinition {
  id: string;
  /** Replace the condition of every policy guarding `target` with an always-true condition. */
  operator: "permissive-condition";
  description: string;
  target: { resourceType: string; action: string };
}

export interface AppliedChange {
  description: string;
  statements: string[];
  before: string;
  after: string;
}

export interface EnvironmentCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RestorationCheck {
  verified: boolean;
  method: string;
  expectedFingerprint: string | null;
  observedFingerprint: string | null;
  message: string;
}

export type MutationStatus = "caught" | "survived" | "inconclusive";

export interface MutationReport {
  mutation: MutationDefinition;
  status: MutationStatus;
  reason: string;
  change: AppliedChange | null;
  relevantScenarioIds: string[];
  caughtBy: string[];
  suite: SuiteRun | null;
  restoration: RestorationCheck;
}

export interface AssuranceReport {
  schemaVersion: 1;
  generatedAt: string;
  specification: string;
  adapter: { id: string; description: string };
  outcome: { status: "all-caught" | "survivors" | "inconclusive" | "error"; message: string };
  environment: { ok: boolean; checks: EnvironmentCheck[] };
  scenarios: AuthorizationScenario[];
  baseline: SuiteRun | null;
  mutations: MutationReport[];
  baselineAfterRestore: SuiteRun | null;
  notes: string[];
}
