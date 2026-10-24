import { z } from "zod";
import type { AssuranceReport } from "@/src/core/models/results";

const text = z.string();
const outcome = z.enum(["allow", "deny"]);
const evidence = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const result = z.object({
  scenarioId: text,
  identityId: text,
  resourceId: text,
  action: text,
  expectedOutcome: outcome,
  status: z.enum(["completed", "error"]),
  verdict: z.enum(["passed", "failed", "error"]),
  observedOutcome: outcome.optional(),
  message: text.optional(),
  evidence: evidence.optional(),
});

const suite = z.object({
  total: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  errors: z.number().int(),
  allPassed: z.boolean(),
  results: z.array(result),
});

const mutationReport = z.object({
  mutation: z.object({ id: text, operator: text, description: text, target: z.object({ resourceType: text, action: text }) }),
  status: z.enum(["caught", "survived", "inconclusive"]),
  reason: text,
  change: z.object({ description: text, statements: z.array(text), before: text, after: text }).nullable(),
  relevantScenarioIds: z.array(text),
  caughtBy: z.array(text),
  suite: suite.nullable(),
  restoration: z.object({
    verified: z.boolean(),
    method: text,
    expectedFingerprint: text.nullable(),
    observedFingerprint: text.nullable(),
    message: text,
  }),
});

const outcomeStatus = z.enum(["all-caught", "survivors", "inconclusive", "error"]);

const reportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.iso.datetime(),
  specification: text,
  adapter: z.object({ id: text, description: text }),
  outcome: z.object({ status: z.enum(["all-caught", "survivors", "inconclusive", "error"]), message: text }),
  environment: z.object({ ok: z.boolean(), checks: z.array(z.object({ name: text, passed: z.boolean(), detail: text })) }),
  scenarios: z.array(z.object({
    id: text,
    identityId: text,
    roles: z.array(text),
    resourceId: text,
    resourceType: text,
    ownerId: text.nullable(),
    action: text,
    expectedOutcome: outcome,
    basis: z.enum(["explicit-rule", "default-deny"]),
    matchedRuleIds: z.array(text),
    declaredExpectation: z.boolean(),
    explanation: text,
  })),
  baseline: suite.nullable(),
  mutations: z.array(mutationReport),
  baselineAfterRestore: suite.nullable(),
  comparison: z.object({ suites: z.array(z.object({
    name: text,
    outcome: z.object({ status: outcomeStatus, message: text }),
    baseline: suite.nullable(),
    mutations: z.array(mutationReport),
    baselineAfterRestore: suite.nullable(),
    missingChecks: z.array(z.object({ scenarioId: text, identityId: text, resourceId: text, action: text, expectedOutcome: outcome })),
  })) }).optional(),
  notes: z.array(text),
});

export type ReportParseResult = { ok: true; report: AssuranceReport } | { ok: false; error: string };

/** Structural check of an engine report before the dashboard renders it; nothing is filled in or defaulted. */
export function parseReport(input: unknown): ReportParseResult {
  const parsed = reportSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `${issue?.path.join(".") || "(root)"}: ${issue?.message ?? "invalid report"}` };
  }
  return { ok: true, report: parsed.data as AssuranceReport };
}
