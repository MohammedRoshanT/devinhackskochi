import type { AuthorizationScenario } from "../models/results";
import { caseKey, enumerateCases, expectedOutcomeFor } from "../rules/evaluation";
import { validateSpecification, type SpecificationIssue, type SpecificationWarning } from "../rules/validation";

export class InvalidSpecificationError extends Error {
  constructor(public readonly issues: SpecificationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
    this.name = "InvalidSpecificationError";
  }
}

export interface GenerationResult {
  scenarios: AuthorizationScenario[];
  warnings: SpecificationWarning[];
}

export function generateScenarios(input: unknown): GenerationResult {
  const validation = validateSpecification(input);
  if (!validation.valid) throw new InvalidSpecificationError(validation.issues);
  const spec = validation.specification;
  const scenarios: AuthorizationScenario[] = [];
  const declared = new Set((spec.expectations ?? []).map((e) => caseKey(e.identityId, e.resourceId, e.action)));

  for (const context of enumerateCases(spec)) {
    const { matching, outcome: expectedOutcome } = expectedOutcomeFor(spec, context);
    const matchedRuleIds = matching.map((rule) => rule.id);
    scenarios.push({
      id: `case:${context.identity.id}:${context.resource.id}:${context.action}`,
      identityId: context.identity.id,
      roles: [...context.identity.roles].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      resourceId: context.resource.id,
      resourceType: context.resource.type,
      ownerId: context.resource.ownerId ?? null,
      action: context.action,
      expectedOutcome,
      basis: matching.length ? "explicit-rule" : "default-deny",
      matchedRuleIds,
      declaredExpectation: declared.has(caseKey(context.identity.id, context.resource.id, context.action)),
      explanation: matching.length
        ? `Expected ${expectedOutcome}: matched ${matchedRuleIds.join(", ")}.`
        : "Expected deny: no explicit rule matches; default-deny applies.",
    });
  }
  return { scenarios, warnings: validation.warnings };
}
