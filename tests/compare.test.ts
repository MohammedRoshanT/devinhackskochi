import { describe, expect, it } from "vitest";
import spec from "../examples/postgres-notes/spec.json";
import mutations from "../examples/postgres-notes/mutations.json";
import { generateScenarios } from "../src/core/generation/generate";
import { parseSpecification } from "../src/core/rules/validation";
import { parseMutationDefinitions } from "../src/core/mutation/definitions";
import { runMutationCampaign, type AuthorizationAdapter } from "../src/core/mutation/engine";
import { computeMissingChecks, selectTypicalSuite, TYPICAL_SCENARIO_IDS } from "../src/core/mutation/suites";
import { parseReport } from "../app/lib/report";
import { readFileSync } from "node:fs";

const validated = parseSpecification(JSON.stringify(spec));
if (!validated.valid) throw new Error("example spec must stay valid");
const parsedSpec = validated.specification;
const scenarios = generateScenarios(parsedSpec).scenarios;
const defs = parseMutationDefinitions(mutations, parsedSpec);

/** Baseline reports expected outcomes; under the mutation everything is allowed (permissive policy). */
const permissiveFake: AuthorizationAdapter = {
  id: "fake",
  description: "fake",
  checkEnvironment: async () => [{ name: "fake", passed: true, detail: "" }],
  captureAuthorizationState: async () => "fingerprint",
  runScenarios: async (list) => list.map((s) => ({ status: "completed" as const, observedOutcome: s.expectedOutcome, evidence: {} })),
  runScenariosUnderMutation: async (_m, list) => ({
    applied: true,
    change: { description: "d", statements: ["ALTER POLICY x USING (true)"], before: "a", after: "b" },
    observations: list.map(() => ({ status: "completed" as const, observedOutcome: "allow" as const, evidence: {} })),
  }),
};

describe("typical suite", () => {
  it("contains exactly three owner-only generated scenarios with no cross-user check", () => {
    const typical = selectTypicalSuite(scenarios);
    expect(typical.map((s) => s.id)).toEqual([...TYPICAL_SCENARIO_IDS]);
    for (const s of typical) {
      expect(s.expectedOutcome).toBe("allow");
      expect(s.ownerId).toBe(s.identityId); // every scenario is the owner accessing their own resource
    }
  });
});

describe("weak vs complete suite classification", () => {
  it("the typical suite lets the mutation survive while the generated suite catches it", async () => {
    const typical = selectTypicalSuite(scenarios);
    const weak = await runMutationCampaign({ specificationName: "weak", adapter: permissiveFake, scenarios: typical, mutations: defs });
    const generated = await runMutationCampaign({ specificationName: "gen", adapter: permissiveFake, scenarios, mutations: defs });
    expect(weak.mutations[0]?.status).toBe("survived");
    expect(generated.mutations[0]?.status).toBe("caught");
    expect(generated.mutations[0]?.caughtBy).toEqual(["case:alice:note-b:read", "case:bob:note-a:read"]);
  });
});

describe("computeMissingChecks", () => {
  const run = async (list: typeof scenarios) => runMutationCampaign({ specificationName: "x", adapter: permissiveFake, scenarios: list, mutations: defs });
  const generated = runMutationCampaign({ specificationName: "gen", adapter: permissiveFake, scenarios, mutations: defs });

  it("lists the generated suite's catching scenarios that the weak suite lacks", async () => {
    const typical = selectTypicalSuite(scenarios);
    const weak = await run(typical);
    const missing = computeMissingChecks(typical, weak.mutations, await generated);
    expect(missing.map((c) => c.scenarioId)).toEqual(["case:alice:note-b:read", "case:bob:note-a:read"]);
    expect(missing[0]).toMatchObject({ identityId: "alice", resourceId: "note-b", action: "read", expectedOutcome: "deny" });
  });

  it("returns an empty list when the suite also caught the mutation", async () => {
    const gen = await generated;
    expect(computeMissingChecks(scenarios, gen.mutations, gen)).toEqual([]);
  });

  it("returns an empty list for inconclusive outcomes", async () => {
    const failedApply: AuthorizationAdapter = {
      ...permissiveFake,
      runScenariosUnderMutation: async () => ({ applied: false, reason: "policy missing", change: null }),
    };
    const inconclusive = await runMutationCampaign({ specificationName: "x", adapter: failedApply, scenarios, mutations: defs });
    expect(inconclusive.mutations[0]?.status).toBe("inconclusive");
    expect(computeMissingChecks(scenarios, inconclusive.mutations, await generated)).toEqual([]);
  });
});

describe("comparison report serialization", () => {
  const realReport = () => JSON.parse(readFileSync("reports/assurance-report.json", "utf8")) as Record<string, unknown>;

  it("older reports without a comparison field still parse", () => {
    expect(parseReport(realReport()).ok).toBe(true);
  });

  it("a report with comparison.suites parses and keeps the fields", () => {
    const report = realReport();
    report.comparison = { suites: [{ name: "typical", outcome: report.outcome, baseline: report.baseline, mutations: report.mutations, baselineAfterRestore: report.baselineAfterRestore, missingChecks: [{ scenarioId: "case:alice:note-b:read", identityId: "alice", resourceId: "note-b", action: "read", expectedOutcome: "deny" }] }] };
    const parsed = parseReport(report);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.report.comparison?.suites[0]?.missingChecks[0]?.expectedOutcome).toBe("deny");
  });
});
