import { z } from "zod";

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Use letters, numbers, dots, underscores or hyphens; start with a letter or number.");
const subject = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("any") }).strict(),
  z.object({ kind: z.literal("identity"), identityId: id }).strict(),
  z.object({ kind: z.literal("role"), role: id }).strict(),
]);
const resource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("type"), type: id }).strict(),
  z.object({ kind: z.literal("instance"), resourceId: id }).strict(),
]);

export const permissionSpecificationSchema = z.object({
  version: z.literal(1),
  name: z.string().trim().min(1).max(120),
  defaultOutcome: z.literal("deny"),
  roles: z.array(id).min(1).max(64),
  identities: z.array(z.object({
    id,
    roles: z.array(id).max(64),
  }).strict()).min(1).max(100),
  resourceTypes: z.array(z.object({
    id,
    actions: z.array(id).min(1).max(32),
  }).strict()).min(1).max(32),
  resources: z.array(z.object({
    id,
    type: id,
    ownerId: id.optional(),
  }).strict()).min(1).max(100),
  rules: z.array(z.object({
    id,
    effect: z.enum(["allow", "deny"]),
    subject,
    resource,
    actions: z.array(id).min(1).max(32),
    ownership: z.enum(["any", "owner", "non-owner"]),
  }).strict()).max(256),
}).strict();

export type PermissionSpecification = z.infer<typeof permissionSpecificationSchema>;
export type PermissionRule = PermissionSpecification["rules"][number];
export type Identity = PermissionSpecification["identities"][number];
export type Resource = PermissionSpecification["resources"][number];
export type AuthorizationOutcome = PermissionRule["effect"];
