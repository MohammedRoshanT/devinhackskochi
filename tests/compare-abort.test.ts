import { describe, expect, it, vi } from "vitest";
import spec from "../examples/postgres-notes/spec.json";
import mutations from "../examples/postgres-notes/mutations.json";
import { generateScenarios } from "../src/core/generation/generate";
import { parseSpecification } from "../src/core/rules/validation";
import { parseMutationDefinitions } from "../src/core/mutation/definitions";
import { computeMissingChecks, selectTypicalSuite } from "../src/core/mutation/suites";
import type { AuthorizationAdapter } from "../src/core/mutation/engine";
import type { MutationReport } from "../src/core/models/results";

const validated = parseSpecification(JSON.stringify(spec));
if (!validated.valid) throw new Error("example spec must stay valid");
const scenarios = generateScenarios(validated.specification).scenarios;

describe("computeMissingChecks deduplication", () => {
  const mutationReport = (id: string, status: MutationReport["status"], caughtBy: string[] = []): MutationReport =>
    ({ mutation: { id } as MutationReport["mutation"], status, caughtBy } as MutationReport);

  it("lists a shared catching scenario once even when several mutations survived", () => {
    const generated = {
      scenarios,
      mutations: [
        mutationReport("m1", "caught", ["case:alice:note-b:read", "case:bob:note-a:read"]),
        mutationReport("m2", "caught", ["case:alice:note-b:read"]),
      ],
    } as Parameters<typeof computeMissingChecks>[2];
    const weak = selectTypicalSuite(scenarios);
    const weakMutations = [mutationReport("m1", "survived"), mutationReport("m2", "survived")];
    const missing = computeMissingChecks(weak, weakMutations, generated);
    expect(missing.map((c) => c.scenarioId)).toEqual(["case:alice:note-b:read", "case:bob:note-a:read"]);
  });
});

describe("runComparison aborts when the typical campaign did not finish cleanly", () => {
  it("skips the generated campaign and reports the error outcome", async () => {
    // Restoration fails: the adapter's fingerprint changes after the mutation campaign.
    const dirtyAdapter: AuthorizationAdapter = {
      id: "dirty",
      description: "fingerprint drifts",
      checkEnvironment: async () => [{ name: "ok", passed: true, detail: "" }],
      captureAuthorizationState: (() => { let n = 0; return async () => `fp-${++n}`; })(),
      runScenarios: async (list) => list.map((s) => ({ status: "completed" as const, observedOutcome: s.expectedOutcome, evidence: {} })),
      runScenariosUnderMutation: async (_m, list) => ({
        applied: true,
        change: { description: "d", statements: ["x"], before: "a", after: "b" },
        observations: list.map((s) => ({ status: "completed" as const, observedOutcome: s.expectedOutcome, evidence: {} })),
      }),
    };
    const project = {
      spec: { ...validated.specification, name: "p" },
      scenarios,
      mutations: parseMutationDefinitions(mutations, validated.specification),
    };

    vi.resetModules();
    vi.doMock("../src/cli/run", async (importOriginal) => {
      const orig = await importOriginal<typeof import("../src/cli/run")>();
      return { ...orig, withLabDatabase: async (_o: unknown, _p: unknown, fn: (a: AuthorizationAdapter) => Promise<unknown>) => fn(dirtyAdapter) };
    });
    vi.doMock("../src/cli/project", () => ({ loadProject: async () => project }));
    const { runComparison } = await import("../src/cli/compare");

    const report = await runComparison({ keepDb: false, reuseDb: false } as Parameters<typeof runComparison>[0]);
    expect(report.outcome.status).toBe("error");
    expect(report.comparison?.suites).toHaveLength(1);
    expect(report.comparison?.suites[0]?.name).toBe("typical");
  });
});
