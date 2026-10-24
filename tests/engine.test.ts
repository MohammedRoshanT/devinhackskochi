import { describe, expect, it } from "vitest";
import { generateScenarios } from "../src/core/generation/generate";
import type { AuthorizationScenario, MutationDefinition, Observation } from "../src/core/models/results";
import { classifyMutation, runMutationCampaign, type AuthorizationAdapter, type MutationExecution } from "../src/core/mutation/engine";
import { parseMutationDefinitions } from "../src/core/mutation/definitions";
import { validateSpecification } from "../src/core/rules/validation";
import spec from "../examples/postgres-notes/spec.json";

const scenarios = generateScenarios(spec).scenarios;
const mutation: MutationDefinition = { id: "m", operator: "permissive-condition", description: "open reads", target: { resourceType: "note", action: "read" } };
const correct = (s: AuthorizationScenario): Observation => ({ status: "completed", observedOutcome: s.expectedOutcome, evidence: {} });
const permissive = (): Observation => ({ status: "completed", observedOutcome: "allow", evidence: {} });

class FakeAdapter implements AuthorizationAdapter {
  readonly id = "fake";
  readonly description = "in-memory fake";
  state = "secure";
  constructor(private readonly behaviour: { mutate?: (s: AuthorizationScenario) => Observation; failApply?: boolean; throwDuring?: boolean; leak?: boolean } = {}) {}
  async checkEnvironment() { return [{ name: "fake", passed: true, detail: "" }]; }
  async runScenarios(list: AuthorizationScenario[]) { return list.map((s) => (this.state === "secure" ? correct(s) : permissive())); }
  async captureAuthorizationState() { return this.state; }
  async runScenariosUnderMutation(_m: MutationDefinition, list: AuthorizationScenario[]): Promise<MutationExecution> {
    if (this.behaviour.failApply) return { applied: false, reason: "policy missing", change: null };
    this.state = "mutated";
    try {
      if (this.behaviour.throwDuring) throw new Error("connection lost");
      const change = { description: "", statements: ["ALTER"], before: "secure", after: "mutated" };
      return { applied: true, change, observations: list.map(this.behaviour.mutate ?? permissive) };
    } finally {
      if (!this.behaviour.leak) this.state = "secure";
    }
  }
}

const run = (adapter: AuthorizationAdapter, list = scenarios) =>
  runMutationCampaign({ specificationName: "t", adapter, scenarios: list, mutations: [mutation], now: () => new Date(0) });

describe("mutation engine", () => {
  it("reports a caught mutation with restoration and a green re-run", async () => {
    const report = await run(new FakeAdapter());
    expect(report.outcome.status).toBe("all-caught");
    expect(report.baseline?.allPassed).toBe(true);
    expect(report.mutations[0]).toMatchObject({ status: "caught", caughtBy: ["case:alice:note-b:read", "case:bob:note-a:read"], restoration: { verified: true } });
    expect(report.mutations[0]?.relevantScenarioIds).toHaveLength(4);
    expect(report.baselineAfterRestore?.allPassed).toBe(true);
  });

  it("reports a survivor as a suite blind spot", async () => {
    const ownOnly = scenarios.filter((s) => s.expectedOutcome === "allow");
    const report = await run(new FakeAdapter(), ownOnly);
    expect(report.mutations[0]?.status).toBe("survived");
    expect(report.outcome.status).toBe("survivors");
  });

  it("never reports errors or unapplied mutations as caught", async () => {
    const errored = await run(new FakeAdapter({ mutate: () => ({ status: "error", message: "permission denied for schema" }) }));
    expect(errored.mutations[0]?.status).toBe("inconclusive");
    const unapplied = await run(new FakeAdapter({ failApply: true }));
    expect(unapplied.mutations[0]).toMatchObject({ status: "inconclusive", change: null });
    const thrown = await run(new FakeAdapter({ throwDuring: true }));
    expect(thrown.mutations[0]?.status).toBe("inconclusive");
    expect(thrown.mutations[0]?.restoration.verified).toBe(true);
  });

  it("stops with an error when restoration cannot be verified", async () => {
    const report = await run(new FakeAdapter({ leak: true }));
    expect(report.mutations[0]?.restoration.verified).toBe(false);
    expect(report.outcome.status).toBe("error");
    expect(report.baselineAfterRestore).toBeNull();
  });

  it("does not mutate when the baseline fails", async () => {
    const adapter = new FakeAdapter();
    adapter.state = "broken";
    const report = await run(adapter);
    expect(report.outcome.status).toBe("error");
    expect(report.mutations).toHaveLength(0);
  });

  it("treats a mutation with no relevant scenarios as survived", () => {
    const execution: MutationExecution = { applied: true, change: { description: "", statements: [], before: "", after: "" }, observations: [] };
    expect(classifyMutation(execution, null).status).toBe("survived");
  });
});

describe("declared expectations", () => {
  it("covers the four required cases in the demo specification", () => {
    const byId = new Map(scenarios.map((s) => [s.id, s]));
    expect(byId.get("case:alice:note-a:read")).toMatchObject({ expectedOutcome: "allow", declaredExpectation: true });
    expect(byId.get("case:bob:note-b:read")).toMatchObject({ expectedOutcome: "allow", declaredExpectation: true });
    expect(byId.get("case:alice:note-b:read")).toMatchObject({ expectedOutcome: "deny", declaredExpectation: true });
    expect(byId.get("case:bob:note-a:update")).toMatchObject({ expectedOutcome: "deny", declaredExpectation: true });
  });

  it("rejects expectations that disagree with the rules or reference unknown entities", () => {
    const mismatch = validateSpecification({ ...spec, expectations: [{ identityId: "alice", resourceId: "note-b", action: "read", outcome: "allow" }] });
    expect(mismatch.valid ? [] : mismatch.issues.map((i) => i.code)).toEqual(["expectation-mismatch"]);
    const unknown = validateSpecification({ ...spec, expectations: [{ identityId: "eve", resourceId: "note-b", action: "delete", outcome: "deny" }] });
    expect(unknown.valid ? [] : unknown.issues.map((i) => i.code)).toContain("reference");
  });

  it("validates mutation definitions against the specification", () => {
    const parsed = validateSpecification(spec);
    if (!parsed.valid) throw new Error("demo spec invalid");
    expect(() => parseMutationDefinitions([{ ...mutation, target: { resourceType: "note", action: "delete" } }], parsed.specification)).toThrow(/undeclared action/);
  });
});
