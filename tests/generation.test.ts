import { describe, expect, it } from "vitest";
import { generateScenarios, InvalidSpecificationError } from "../src/core/generation/generate";
import type { PermissionSpecification } from "../src/core/rules/schema";
import { cloneExample } from "./helpers";

const find = (spec: unknown, identityId: string, resourceId: string, action: string) => {
  const scenario = generateScenarios(spec).scenarios.find(
    (s) => s.identityId === identityId && s.resourceId === resourceId && s.action === action,
  );
  if (!scenario) throw new Error(`Missing scenario ${identityId}/${resourceId}/${action}`);
  return scenario;
};

describe("owner access and cross-user denial", () => {
  it("allows owners to access their own notes", () => {
    for (const action of ["read", "update", "delete"]) {
      expect(find(cloneExample(), "alice", "note-a", action)).toMatchObject({ expectedOutcome: "allow", matchedRuleIds: ["members-own-notes"] });
      expect(find(cloneExample(), "bob", "note-b", action)).toMatchObject({ expectedOutcome: "allow", matchedRuleIds: ["members-own-notes"] });
    }
  });

  it("denies cross-user access explicitly", () => {
    for (const action of ["read", "update", "delete"]) {
      expect(find(cloneExample(), "alice", "note-b", action)).toMatchObject({ expectedOutcome: "deny", basis: "explicit-rule", matchedRuleIds: ["members-no-cross-access"] });
      expect(find(cloneExample(), "bob", "note-a", action)).toMatchObject({ expectedOutcome: "deny", basis: "explicit-rule", matchedRuleIds: ["members-no-cross-access"] });
    }
  });

  it("falls back to default deny for cross-user access when no deny rule exists", () => {
    const spec = cloneExample();
    spec.rules = spec.rules.filter((rule) => rule.id !== "members-no-cross-access");
    expect(find(spec, "alice", "note-b", "read")).toMatchObject({ expectedOutcome: "deny", basis: "default-deny", matchedRuleIds: [] });
  });

  it("does not treat unowned resources as owned by anyone", () => {
    const spec = cloneExample();
    spec.resources.push({ id: "note-shared", type: "note" });
    expect(find(spec, "alice", "note-shared", "read")).toMatchObject({ expectedOutcome: "deny", basis: "default-deny" });
  });
});

describe("role-based permissions", () => {
  it("grants role permissions regardless of ownership when ownership is any", () => {
    expect(find(cloneExample(), "carol", "note-a", "read")).toMatchObject({ expectedOutcome: "allow", matchedRuleIds: ["admins-read-notes"] });
    expect(find(cloneExample(), "carol", "note-b", "read")).toMatchObject({ expectedOutcome: "allow" });
  });

  it("denies role actions that are not granted", () => {
    expect(find(cloneExample(), "carol", "note-a", "update")).toMatchObject({ expectedOutcome: "deny", basis: "default-deny" });
    expect(find(cloneExample(), "carol", "note-b", "delete")).toMatchObject({ expectedOutcome: "deny", basis: "default-deny" });
  });

  it("evaluates identity-specific rules alongside role rules", () => {
    const spec = cloneExample();
    spec.roles.push("auditor");
    spec.identities.push({ id: "dave", roles: ["member", "auditor"] });
    spec.rules.push({
      id: "dave-delete-note-a",
      effect: "allow",
      subject: { kind: "identity", identityId: "dave" },
      resource: { kind: "instance", resourceId: "note-a" },
      actions: ["delete"],
      ownership: "any",
    });
    // As a non-owning member, dave also matches the member deny rule: a contradiction.
    expect(() => generateScenarios(spec)).toThrow(InvalidSpecificationError);

    spec.identities = spec.identities.map((identity) => (identity.id === "dave" ? { id: "dave", roles: ["auditor"] } : identity));
    expect(find(spec, "dave", "note-a", "delete")).toMatchObject({ expectedOutcome: "allow", matchedRuleIds: ["dave-delete-note-a"] });
    expect(find(spec, "dave", "note-b", "delete").expectedOutcome).toBe("deny");
  });
});

describe("multiple resources and actions", () => {
  const spec: PermissionSpecification = {
    version: 1,
    name: "Projects and invoices",
    defaultOutcome: "deny",
    roles: ["viewer", "editor", "billing"],
    identities: [
      { id: "erin", roles: ["editor"] },
      { id: "frank", roles: ["viewer", "billing"] },
    ],
    resourceTypes: [
      { id: "project", actions: ["read", "write", "archive"] },
      { id: "invoice", actions: ["read", "pay"] },
    ],
    resources: [
      { id: "project-1", type: "project", ownerId: "erin" },
      { id: "project-2", type: "project", ownerId: "frank" },
      { id: "invoice-1", type: "invoice" },
    ],
    rules: [
      { id: "viewers-read-projects", effect: "allow", subject: { kind: "role", role: "viewer" }, resource: { kind: "type", type: "project" }, actions: ["read"], ownership: "any" },
      { id: "editors-write-projects", effect: "allow", subject: { kind: "role", role: "editor" }, resource: { kind: "type", type: "project" }, actions: ["read", "write"], ownership: "any" },
      { id: "owners-archive", effect: "allow", subject: { kind: "any" }, resource: { kind: "type", type: "project" }, actions: ["archive"], ownership: "owner" },
      { id: "billing-invoices", effect: "allow", subject: { kind: "role", role: "billing" }, resource: { kind: "type", type: "invoice" }, actions: ["read", "pay"], ownership: "any" },
    ],
  };

  it("generates one scenario per identity, resource and declared action", () => {
    const { scenarios } = generateScenarios(spec);
    expect(scenarios).toHaveLength(2 * (3 + 3 + 2));
    expect(new Set(scenarios.map((s) => s.id)).size).toBe(scenarios.length);
    expect(scenarios.some((s) => s.resourceType === "invoice" && s.action === "write")).toBe(false);
  });

  it("evaluates each resource type and action independently", () => {
    expect(find(spec, "erin", "project-2", "write").expectedOutcome).toBe("allow");
    expect(find(spec, "erin", "project-2", "archive").expectedOutcome).toBe("deny");
    expect(find(spec, "erin", "project-1", "archive").expectedOutcome).toBe("allow");
    expect(find(spec, "erin", "invoice-1", "pay").expectedOutcome).toBe("deny");
    expect(find(spec, "frank", "project-1", "read").expectedOutcome).toBe("allow");
    expect(find(spec, "frank", "project-1", "write").expectedOutcome).toBe("deny");
    expect(find(spec, "frank", "invoice-1", "pay").expectedOutcome).toBe("allow");
  });
});

describe("deterministic generation", () => {
  it("returns identical output for identical input", () => {
    expect(JSON.stringify(generateScenarios(cloneExample()))).toBe(JSON.stringify(generateScenarios(cloneExample())));
  });

  it("is independent of declaration order", () => {
    const reordered = cloneExample();
    reordered.identities.reverse();
    reordered.resources.reverse();
    reordered.rules.reverse();
    reordered.roles.reverse();
    reordered.resourceTypes.forEach((type) => type.actions.reverse());
    reordered.identities.forEach((identity) => identity.roles.reverse());
    expect(generateScenarios(reordered)).toEqual(generateScenarios(cloneExample()));
  });

  it("orders scenarios by identity, resource and action", () => {
    const ids = generateScenarios(cloneExample()).scenarios.map((s) => s.id);
    expect(ids.slice(0, 3)).toEqual(["case:alice:note-a:delete", "case:alice:note-a:read", "case:alice:note-a:update"]);
    expect(ids).toHaveLength(18);
  });

  it("does not mutate the input specification", () => {
    const spec = cloneExample();
    const before = JSON.stringify(spec);
    generateScenarios(spec);
    expect(JSON.stringify(spec)).toBe(before);
  });
});
