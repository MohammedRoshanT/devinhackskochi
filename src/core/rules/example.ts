import type { PermissionSpecification } from "./schema";

export const exampleSpecification: PermissionSpecification = {
  version: 1,
  name: "Team notes workspace",
  defaultOutcome: "deny",
  roles: ["member", "admin"],
  identities: [
    { id: "alice", roles: ["member"] },
    { id: "bob", roles: ["member"] },
    { id: "carol", roles: ["admin"] },
  ],
  resourceTypes: [{ id: "note", actions: ["read", "update", "delete"] }],
  resources: [
    { id: "note-a", type: "note", ownerId: "alice" },
    { id: "note-b", type: "note", ownerId: "bob" },
  ],
  rules: [
    {
      id: "members-own-notes",
      effect: "allow",
      subject: { kind: "role", role: "member" },
      resource: { kind: "type", type: "note" },
      actions: ["read", "update", "delete"],
      ownership: "owner",
    },
    {
      id: "members-no-cross-access",
      effect: "deny",
      subject: { kind: "role", role: "member" },
      resource: { kind: "type", type: "note" },
      actions: ["read", "update", "delete"],
      ownership: "non-owner",
    },
    {
      id: "admins-read-notes",
      effect: "allow",
      subject: { kind: "role", role: "admin" },
      resource: { kind: "type", type: "note" },
      actions: ["read"],
      ownership: "any",
    },
  ],
};
