import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PostgresRlsAdapter } from "../../src/adapters/postgres/adapter";
import { adminConnection, startContainer, stopContainer, waitForPostgres, type ContainerConfig } from "../../src/adapters/postgres/docker";
import { initializeDatabase } from "../../src/adapters/postgres/fixture";
import { runMutationCampaign } from "../../src/core/mutation/engine";
import type { MutationDefinition } from "../../src/core/models/results";
import { loadProject } from "../../src/cli/project";

const container: ContainerConfig = { name: "aal-postgres-integration", image: "postgres:16-alpine", port: 55433, password: "aal-disposable-local-only" };
let project: Awaited<ReturnType<typeof loadProject>>;
let db: ReturnType<typeof adminConnection>;
let original: string;

const policyQual = async () => {
  const client = new Client(db);
  await client.connect();
  try {
    return (await client.query<{ qual: string }>("SELECT qual FROM pg_policies WHERE policyname = 'notes_select_own'")).rows[0]?.qual;
  } finally {
    await client.end();
  }
};
const campaign = (adapter: PostgresRlsAdapter, mutations: MutationDefinition[] = project.mutations, scenarios = project.scenarios) =>
  runMutationCampaign({ specificationName: project.spec.name, adapter, scenarios, mutations });

beforeAll(async () => {
  project = await loadProject();
  await startContainer(container);
  await waitForPostgres(adminConnection(container));
  await initializeDatabase(adminConnection(container), project.target, project.schemaSql);
  db = adminConnection(container, project.target.database);
  original = await new PostgresRlsAdapter(project.target, db).captureAuthorizationState();
});

afterAll(async () => {
  await stopContainer(container);
});

describe("PostgreSQL RLS adapter (disposable container)", () => {
  it("passes the baseline, catches the permissive SELECT mutation and restores the policy", async () => {
    const report = await campaign(new PostgresRlsAdapter(project.target, db));
    expect(report.environment.ok).toBe(true);
    expect(report.baseline).toMatchObject({ total: 8, passed: 8 });
    const [mutation] = report.mutations;
    expect(mutation).toMatchObject({ status: "caught", caughtBy: ["case:alice:note-b:read", "case:bob:note-a:read"], restoration: { verified: true } });
    const crossRead = mutation?.suite?.results.find((r) => r.scenarioId === "case:alice:note-b:read");
    expect(crossRead).toMatchObject({ expectedOutcome: "deny", observedOutcome: "allow", evidence: { rowsReturned: 1 } });
    expect(report.baselineAfterRestore).toMatchObject({ total: 8, passed: 8 });
    expect(report.outcome.status).toBe("all-caught");
    expect(await policyQual()).toBe("(owner_id = app.current_user_id())");
  });

  it("observes denied reads as zero rows and denied updates as no data change", async () => {
    const obs = await new PostgresRlsAdapter(project.target, db).runScenarios(project.scenarios);
    const byId = new Map(project.scenarios.map((s, i) => [s.id, obs[i]]));
    expect(byId.get("case:alice:note-b:read")).toMatchObject({ observedOutcome: "deny", evidence: { rowsReturned: 0, resourceExists: true } });
    expect(byId.get("case:bob:note-a:update")).toMatchObject({ observedOutcome: "deny", evidence: { rowsAffected: 0, dataChanged: false } });
  });

  it("rolls back when a failure is injected after the mutation is applied, and reports inconclusive", async () => {
    const adapter = new PostgresRlsAdapter(project.target, db, { afterMutationApplied: async () => { throw new Error("injected failure"); } });
    const report = await campaign(adapter);
    expect(report.mutations[0]).toMatchObject({ status: "inconclusive", restoration: { verified: true } });
    expect(report.mutations[0]?.reason).toMatch(/injected failure/);
    expect(await adapter.captureAuthorizationState()).toBe(original);
    expect(report.baselineAfterRestore?.allPassed).toBe(true);
  });

  it("reports a mutation that cannot be applied as inconclusive, not caught", async () => {
    const target = { ...project.target, resourceTypes: { note: { ...project.target.resourceTypes.note!, actions: { read: { operation: "select" as const } } } } };
    const unmappable: MutationDefinition = { id: "notes-update-permissive", operator: "permissive-condition", description: "x", target: { resourceType: "note", action: "update" } };
    const report = await campaign(new PostgresRlsAdapter(target, db), [unmappable], project.scenarios.filter((s) => s.action === "read"));
    expect(report.mutations[0]).toMatchObject({ status: "inconclusive", change: null });
  });

  it("reports a survivor when the suite lacks cross-user read cases", async () => {
    const report = await campaign(new PostgresRlsAdapter(project.target, db), project.mutations, project.scenarios.filter((s) => s.expectedOutcome === "allow"));
    expect(report.mutations[0]?.status).toBe("survived");
    expect(report.outcome.status).toBe("survivors");
  });

  it("does not persist a mutation when the connection dies before rollback", async () => {
    const client = new Client(db);
    await client.connect();
    await client.query("BEGIN");
    await client.query("ALTER POLICY notes_select_own ON public.notes USING (true)");
    await client.end();
    expect(await new PostgresRlsAdapter(project.target, db).captureAuthorizationState()).toBe(original);
  });

  it("refuses non-local hosts", () => {
    expect(() => new PostgresRlsAdapter(project.target, { ...db, host: "db.example.com" })).toThrow(/non-local/);
  });
});
