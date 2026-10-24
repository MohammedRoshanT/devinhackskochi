import { z } from "zod";
import type { MutationDefinition } from "../models/results";
import type { PermissionSpecification } from "../rules/schema";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const mutationDefinitionsSchema = z.array(z.object({
  id,
  operator: z.literal("permissive-condition"),
  description: z.string().trim().min(1).max(300),
  target: z.object({ resourceType: id, action: id }).strict(),
}).strict()).min(1).max(50);

/** Validates mutation definitions and checks that each targets a declared resource type and action. */
export function parseMutationDefinitions(input: unknown, spec: PermissionSpecification): MutationDefinition[] {
  const mutations = mutationDefinitionsSchema.parse(input);
  const ids = new Set<string>();
  for (const mutation of mutations) {
    if (ids.has(mutation.id)) throw new Error(`Duplicate mutation id "${mutation.id}".`);
    ids.add(mutation.id);
    const type = spec.resourceTypes.find((t) => t.id === mutation.target.resourceType);
    if (!type) throw new Error(`Mutation "${mutation.id}" targets unknown resource type "${mutation.target.resourceType}".`);
    if (!type.actions.includes(mutation.target.action)) throw new Error(`Mutation "${mutation.id}" targets undeclared action "${mutation.target.action}".`);
  }
  return mutations;
}
