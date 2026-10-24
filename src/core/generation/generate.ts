import type { AuthorizationScenario } from "../models/results";
import { compareIds, enumerateCases, matchesRule } from "../rules/evaluation";
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

  for (const context of enumerateCases(spec)) {
    const matching = spec.rules.filter((rule) => matchesRule(rule, context)).sort((a, b) => compareIds(a.id, b.id));
    const expectedOutcome = matching[0]?.effect ?? spec.defaultOutcome;
    const matchedRuleIds = matching.map((rule) => rule.id);
    scenarios.push({
      id: `case:${context.identity.id}:${context.resource.id}:${context.action}`,
      identityId: context.identity.id,
      roles: [...context.identity.roles].sort(compareIds),
      resourceId: context.resource.id,
      resourceType: context.resource.type,
      ownerId: context.resource.ownerId ?? null,
      action: context.action,
      expectedOutcome,
      basis: matching.length ? "explicit-rule" : "default-deny",
      matchedRuleIds,
      explanation: matching.length
        ? `Expected ${expectedOutcome}: matched ${matchedRuleIds.join(", ")}.`
        : "Expected deny: no explicit rule matches; default-deny applies.",
    });
  }
  return { scenarios, warnings: validation.warnings };
}
