import type { Identity, PermissionRule, PermissionSpecification, Resource } from "./schema";

export interface AuthorizationCase {
  identity: Identity;
  resource: Resource;
  action: string;
}

export const compareIds = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function matchesRule(rule: PermissionRule, { identity, resource, action }: AuthorizationCase): boolean {
  const subjectMatches = rule.subject.kind === "any"
    || (rule.subject.kind === "identity" && rule.subject.identityId === identity.id)
    || (rule.subject.kind === "role" && identity.roles.includes(rule.subject.role));
  const resourceMatches = rule.resource.kind === "type"
    ? rule.resource.type === resource.type
    : rule.resource.resourceId === resource.id;
  const ownershipMatches = rule.ownership === "any"
    || (resource.ownerId !== undefined && (rule.ownership === "owner"
      ? resource.ownerId === identity.id
      : resource.ownerId !== identity.id));

  return subjectMatches && resourceMatches && ownershipMatches && rule.actions.includes(action);
}

export function expectedOutcomeFor(spec: PermissionSpecification, context: AuthorizationCase) {
  const matching = spec.rules.filter((rule) => matchesRule(rule, context)).sort((a, b) => compareIds(a.id, b.id));
  return { matching, outcome: matching[0]?.effect ?? spec.defaultOutcome };
}

export const caseKey = (identityId: string, resourceId: string, action: string) => `${identityId}:${resourceId}:${action}`;

export function* enumerateCases(spec: PermissionSpecification): Generator<AuthorizationCase> {
  const identities = [...spec.identities].sort((a, b) => compareIds(a.id, b.id));
  const resources = [...spec.resources].sort((a, b) => compareIds(a.id, b.id));
  const actionsByType = new Map(spec.resourceTypes.map((type) => [type.id, [...type.actions].sort(compareIds)]));
  for (const identity of identities) {
    for (const resource of resources) {
      for (const action of actionsByType.get(resource.type) ?? []) {
        yield { identity, resource, action };
      }
    }
  }
}

export function countCases(spec: PermissionSpecification): number {
  const actionCounts = new Map(spec.resourceTypes.map((type) => [type.id, type.actions.length]));
  return spec.identities.length * spec.resources.reduce((count, resource) => count + (actionCounts.get(resource.type) ?? 0), 0);
}
