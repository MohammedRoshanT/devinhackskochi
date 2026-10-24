import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateScenarios, InvalidSpecificationError } from "../src/core/generation/generate";
import { MAX_SCENARIOS, parseSpecification, validateSpecification } from "../src/core/rules/validation";
import { cloneExample } from "./helpers";

const issuesOf = (input: unknown) => {
  const result = validateSpecification(input);
  if (result.valid) throw new Error("Expected an invalid specification");
  return result.issues;
};

describe("malformed specifications", () => {
  it("accepts the bundled example without warnings", () => {
    expect(validateSpecification(cloneExample())).toMatchObject({ valid: true, warnings: [] });
  });

  it("reports invalid JSON as a syntax issue", () => {
    expect(parseSpecification("{ not json")).toMatchObject({ valid: false, issues: [{ code: "syntax", path: "$" }] });
  });

  it.each([
    ["a non-object", 42],
    ["missing fields", { version: 1, name: "x" }],
    ["an unsupported version", { ...cloneExample(), version: 2 }],
    ["a default allow outcome", { ...cloneExample(), defaultOutcome: "allow" }],
    ["unknown top-level keys", { ...cloneExample(), extra: true }],
    ["an empty action list", { ...cloneExample(), resourceTypes: [{ id: "note", actions: [] }] }],
    ["an invalid identifier", { ...cloneExample(), roles: ["has space"] }],
  ])("rejects %s with schema issues", (_label, input) => {
    const issues = issuesOf(input);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => issue.code === "schema")).toBe(true);
  });

  it("rejects an unknown rule effect and ownership", () => {
    const spec = cloneExample() as unknown as { rules: Record<string, unknown>[] };
    spec.rules[0] = { ...spec.rules[0], effect: "maybe", ownership: "sometimes" };
    expect(issuesOf(spec).map((issue) => issue.path)).toEqual(expect.arrayContaining(["rules.0.effect", "rules.0.ownership"]));
  });

  it("rejects duplicate identifiers", () => {
    const spec = cloneExample();
    spec.identities.push({ id: "alice", roles: [] });
    spec.rules.push({ ...spec.rules[0]!, actions: ["read", "read"] });
    expect(issuesOf(spec)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate", path: "identities.3" }),
        expect.objectContaining({ code: "duplicate", path: "rules.3" }),
        expect.objectContaining({ code: "duplicate", path: "rules.3.actions.1" }),
      ]),
    );
  });

  it("rejects references to undeclared roles, identities, types, resources and actions", () => {
    const spec = cloneExample();
    spec.identities[0]!.roles.push("ghost-role");
    spec.resources.push({ id: "note-c", type: "ghost-type", ownerId: "ghost-user" });
    spec.rules.push(
      { id: "r1", effect: "allow", subject: { kind: "identity", identityId: "nobody" }, resource: { kind: "instance", resourceId: "missing" }, actions: ["read"], ownership: "any" },
      { id: "r2", effect: "allow", subject: { kind: "role", role: "ghost-role" }, resource: { kind: "type", type: "note" }, actions: ["share"], ownership: "any" },
    );
    const paths = issuesOf(spec).filter((issue) => issue.code === "reference").map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "identities.0.roles.1",
        "resources.2.type",
        "resources.2.ownerId",
        "rules.3.subject.identityId",
        "rules.3.resource.resourceId",
        "rules.4.subject.role",
        "rules.4.actions.0",
      ]),
    );
  });

  it("rejects specifications that exceed the scenario limit", () => {
    const spec = cloneExample();
    spec.resourceTypes = [{ id: "note", actions: Array.from({ length: 32 }, (_, i) => `a${i}`) }];
    spec.rules = [];
    spec.identities = Array.from({ length: 100 }, (_, i) => ({ id: `user${i}`, roles: [] }));
    spec.resources = Array.from({ length: 100 }, (_, i) => ({ id: `note${i}`, type: "note" }));
    expect(32 * 100 * 100).toBeGreaterThan(MAX_SCENARIOS);
    expect(issuesOf(spec)).toEqual([expect.objectContaining({ code: "limit" })]);
  });

  it("throws InvalidSpecificationError from the generator with issue details", () => {
    expect(() => generateScenarios({ version: 1 })).toThrow(InvalidSpecificationError);
    try {
      generateScenarios({ version: 1 });
    } catch (error) {
      expect((error as InvalidSpecificationError).issues.length).toBeGreaterThan(0);
    }
  });
});

describe("contradictory specifications", () => {
  it("rejects allow and deny rules that match the same case", () => {
    const spec = cloneExample();
    spec.rules.push({ id: "deny-alice-read", effect: "deny", subject: { kind: "identity", identityId: "alice" }, resource: { kind: "instance", resourceId: "note-a" }, actions: ["read"], ownership: "any" });
    const issues = issuesOf(spec);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "contradiction" });
    expect(issues[0]!.message).toContain("deny-alice-read, members-own-notes");
    expect(issues[0]!.message).toContain("alice / note-a / read");
  });

  it("detects contradictions introduced through roles", () => {
    const spec = cloneExample();
    spec.rules.push({ id: "deny-admin-read", effect: "deny", subject: { kind: "role", role: "admin" }, resource: { kind: "type", type: "note" }, actions: ["read"], ownership: "any" });
    expect(issuesOf(spec).filter((issue) => issue.code === "contradiction")).toHaveLength(2);
  });

  it("permits overlapping rules with the same effect", () => {
    const spec = cloneExample();
    spec.rules.push({ id: "alice-read-a", effect: "allow", subject: { kind: "identity", identityId: "alice" }, resource: { kind: "instance", resourceId: "note-a" }, actions: ["read"], ownership: "any" });
    const scenario = generateScenarios(spec).scenarios.find((s) => s.id === "case:alice:note-a:read");
    expect(scenario).toMatchObject({ expectedOutcome: "allow", matchedRuleIds: ["alice-read-a", "members-own-notes"] });
  });

  it("warns about rules that match no declared case", () => {
    const spec = cloneExample();
    spec.rules.push({ id: "carol-owner-update", effect: "allow", subject: { kind: "identity", identityId: "carol" }, resource: { kind: "type", type: "note" }, actions: ["update"], ownership: "owner" });
    expect(validateSpecification(spec)).toMatchObject({ valid: true, warnings: [{ code: "unmatched-rule", path: "rules.3" }] });
  });
});

describe("core independence", () => {
  it("does not import UI frameworks or backend SDKs", () => {
    const root = join(__dirname, "../src/core");
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'](react|react-dom|next|@supabase)(\/[^"']*)?["']/);
    }
  });
});
