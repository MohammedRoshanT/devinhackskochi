import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReport } from "../app/lib/report";
import { generateScenarios } from "../src/core/generation/generate";
import { runMutationCampaign, type AuthorizationAdapter } from "../src/core/mutation/engine";
import spec from "../examples/postgres-notes/spec.json";

const scenarios = generateScenarios(spec).scenarios;
const adapter: AuthorizationAdapter = {
  id: "fake",
  description: "fake",
  checkEnvironment: async () => [{ name: "fake", passed: true, detail: "" }],
  runScenarios: async (list) => list.map((s) => ({ status: "completed", observedOutcome: s.expectedOutcome, evidence: { rowsReturned: 1 } })),
  runScenariosUnderMutation: async (_m, list) => ({ applied: true, change: { description: "", statements: ["ALTER"], before: "a", after: "b" }, observations: list.map(() => ({ status: "completed", observedOutcome: "allow", evidence: {} })) }),
  captureAuthorizationState: async () => "{}",
};

describe("dashboard report parsing", () => {
  it("accepts a report produced by the engine unchanged", async () => {
    const report = await runMutationCampaign({ specificationName: "t", adapter, scenarios, mutations: [{ id: "m", operator: "permissive-condition", description: "d", target: { resourceType: "note", action: "read" } }] });
    const parsed = parseReport(JSON.parse(JSON.stringify(report)));
    expect(parsed).toEqual({ ok: true, report: JSON.parse(JSON.stringify(report)) });
  });

  it("rejects malformed or unknown status values instead of guessing", () => {
    expect(parseReport({}).ok).toBe(false);
    const bad = parseReport({ schemaVersion: 1, outcome: { status: "passed", message: "" } });
    expect(bad.ok).toBe(false);
  });

  it("the dashboard reads the same path the CLI writes", () => {
    expect(readFileSync("src/cli/paths.ts", "utf8")).toContain("reports/assurance-report.json");
  });
});
