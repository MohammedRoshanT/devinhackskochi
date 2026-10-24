import { caseKey, countCases, enumerateCases, expectedOutcomeFor, matchesRule } from "./evaluation";
import { permissionSpecificationSchema, type PermissionSpecification } from "./schema";

export const MAX_SCENARIOS = 10_000;

export interface SpecificationIssue {
  code: "syntax" | "schema" | "duplicate" | "reference" | "contradiction" | "limit" | "expectation-mismatch";
  path: string;
  message: string;
}

export interface SpecificationWarning {
  code: "unmatched-rule";
  path: string;
  message: string;
}

export type ValidationResult =
  | { valid: true; specification: PermissionSpecification; warnings: SpecificationWarning[] }
  | { valid: false; issues: SpecificationIssue[] };

export function validateSpecification(input: unknown): ValidationResult {
  const parsed = permissionSpecificationSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, issues: parsed.error.issues.map((issue) => ({
      code: "schema", path: issue.path.map(String).join(".") || "$", message: issue.message,
    })) };
  }

  const spec = parsed.data;
  const issues: SpecificationIssue[] = [];
  const unique = (values: string[], path: string) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) issues.push({ code: "duplicate", path: `${path}.${index}`, message: `Duplicate identifier "${value}".` });
      seen.add(value);
    });
  };
  const reference = (exists: boolean, path: string, message: string) => {
    if (!exists) issues.push({ code: "reference", path, message });
  };

  unique(spec.roles, "roles");
  unique(spec.identities.map((identity) => identity.id), "identities");
  unique(spec.resourceTypes.map((type) => type.id), "resourceTypes");
  unique(spec.resources.map((resource) => resource.id), "resources");
  unique(spec.rules.map((rule) => rule.id), "rules");

  const roles = new Set(spec.roles);
  const identities = new Set(spec.identities.map((identity) => identity.id));
  const types = new Map(spec.resourceTypes.map((type) => [type.id, type]));
  const resources = new Map(spec.resources.map((resource) => [resource.id, resource]));

  spec.identities.forEach((identity, index) => {
    unique(identity.roles, `identities.${index}.roles`);
    identity.roles.forEach((role, roleIndex) => reference(roles.has(role), `identities.${index}.roles.${roleIndex}`, `Unknown role "${role}".`));
  });
  spec.resourceTypes.forEach((type, index) => unique(type.actions, `resourceTypes.${index}.actions`));
  spec.resources.forEach((resource, index) => {
    reference(types.has(resource.type), `resources.${index}.type`, `Unknown resource type "${resource.type}".`);
    if (resource.ownerId !== undefined) reference(identities.has(resource.ownerId), `resources.${index}.ownerId`, `Unknown owner "${resource.ownerId}".`);
  });
  spec.rules.forEach((rule, index) => {
    unique(rule.actions, `rules.${index}.actions`);
    if (rule.subject.kind === "identity") reference(identities.has(rule.subject.identityId), `rules.${index}.subject.identityId`, `Unknown identity "${rule.subject.identityId}".`);
    if (rule.subject.kind === "role") reference(roles.has(rule.subject.role), `rules.${index}.subject.role`, `Unknown role "${rule.subject.role}".`);
    const typeId = rule.resource.kind === "type" ? rule.resource.type : resources.get(rule.resource.resourceId)?.type;
    if (rule.resource.kind === "instance") reference(resources.has(rule.resource.resourceId), `rules.${index}.resource.resourceId`, `Unknown resource "${rule.resource.resourceId}".`);
    if (rule.resource.kind === "type") reference(types.has(rule.resource.type), `rules.${index}.resource.type`, `Unknown resource type "${rule.resource.type}".`);
    const type = typeId ? types.get(typeId) : undefined;
    if (type) rule.actions.forEach((action, actionIndex) => reference(type.actions.includes(action), `rules.${index}.actions.${actionIndex}`, `Action "${action}" is not declared for "${type.id}".`));
  });

  const declared = new Set<string>();
  (spec.expectations ?? []).forEach((expectation, index) => {
    const path = `expectations.${index}`;
    const key = caseKey(expectation.identityId, expectation.resourceId, expectation.action);
    if (declared.has(key)) issues.push({ code: "duplicate", path, message: `Duplicate expectation for ${key}.` });
    declared.add(key);
    reference(identities.has(expectation.identityId), `${path}.identityId`, `Unknown identity "${expectation.identityId}".`);
    const resource = resources.get(expectation.resourceId);
    reference(resource !== undefined, `${path}.resourceId`, `Unknown resource "${expectation.resourceId}".`);
    const type = resource ? types.get(resource.type) : undefined;
    if (type) reference(type.actions.includes(expectation.action), `${path}.action`, `Action "${expectation.action}" is not declared for "${type.id}".`);
  });

  if (issues.length) return { valid: false, issues };
  const count = countCases(spec);
  if (count > MAX_SCENARIOS) return { valid: false, issues: [{
    code: "limit", path: "$", message: `This specification generates ${count} scenarios; the limit is ${MAX_SCENARIOS}. Reduce identities, resources or actions.`,
  }] };

  const matchedIds = new Set<string>();
  for (const context of enumerateCases(spec)) {
    const matching = spec.rules.filter((rule) => matchesRule(rule, context));
    matching.forEach((rule) => matchedIds.add(rule.id));
    if (matching.some((rule) => rule.effect === "allow") && matching.some((rule) => rule.effect === "deny")) {
      issues.push({ code: "contradiction", path: "rules", message: `Conflicting rules [${matching.map((rule) => rule.id).sort().join(", ")}] for ${context.identity.id} / ${context.resource.id} / ${context.action}. No allow/deny precedence is assumed.` });
      if (issues.length >= 20) break;
    }
  }
  if (issues.length) return { valid: false, issues };

  const identityById = new Map(spec.identities.map((identity) => [identity.id, identity]));
  (spec.expectations ?? []).forEach((expectation, index) => {
    const identity = identityById.get(expectation.identityId)!;
    const resource = resources.get(expectation.resourceId)!;
    const derived = expectedOutcomeFor(spec, { identity, resource, action: expectation.action }).outcome;
    if (derived !== expectation.outcome) issues.push({
      code: "expectation-mismatch",
      path: `expectations.${index}`,
      message: `Declared ${expectation.outcome} for ${caseKey(expectation.identityId, expectation.resourceId, expectation.action)}, but the rules produce ${derived}.`,
    });
  });
  if (issues.length) return { valid: false, issues };

  return { valid: true, specification: spec, warnings: spec.rules.flatMap((rule, index) => matchedIds.has(rule.id) ? [] : [{
    code: "unmatched-rule" as const,
    path: `rules.${index}`,
    message: `Rule "${rule.id}" matches no declared identity/resource/action combination. Future or undeclared entities are not evaluated.`,
  }]) };
}

export function parseSpecification(source: string): ValidationResult {
  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch (error) {
    return { valid: false, issues: [{ code: "syntax", path: "$", message: error instanceof Error ? error.message : "Invalid JSON." }] };
  }
  return validateSpecification(input);
}
