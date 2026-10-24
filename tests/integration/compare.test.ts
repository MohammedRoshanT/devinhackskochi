import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresRlsAdapter } from "../../src/adapters/postgres/adapter";
import { adminConnection, startContainer, stopContainer, waitForPostgres, type ContainerConfig } from "../../src/adapters/postgres/docker";
import { initializeDatabase } from "../../src/adapters/postgres/fixture";
import { runMutationCampaign } from "../../src/core/mutation/engine";
import { computeMissingChecks, selectTypicalSuite } from "../../src/core/mutation/suites";
import { loadProject } from "../../src/cli/project";

const container: ContainerConfig = { name: "aal-postgres-compare", image: "postgres:16-alpine", port: 55435, password: "aal-disposable-local-only" };
let project: Awaited<ReturnType<typeof loadProject>>;
let db: ReturnType<typeof adminConnection>;

beforeAll(async () => {
  project = await loadProject();
  await startContainer(container);
  await waitForPostgres(adminConnection(container));
  await initializeDatabase(adminConnection(container), project.target, project.schemaSql);
  db = adminConnection(container, project.target.database);
});

afterAll(async () => {
  await stopContainer(container);
});

describe("npm run lab:compare workflow on real PostgreSQL", () => {
  it("the typical owner-only suite survives the mutation that the generated suite catches", async () => {
    const typical = selectTypicalSuite(project.scenarios);
    const adapter = new PostgresRlsAdapter(project.target, db);
    const weakReport = await runMutationCampaign({ specificationName: "typical", adapter, scenarios: typical, mutations: project.mutations });
    const generatedReport = await runMutationCampaign({ specificationName: "generated", adapter, scenarios: project.scenarios, mutations: project.mutations });

    expect(weakReport.baseline?.allPassed).toBe(true);
    expect(weakReport.mutations[0]?.status).toBe("survived");
    expect(weakReport.baselineAfterRestore?.allPassed).toBe(true);
    expect(weakReport.mutations[0]?.restoration.verified).toBe(true);

    expect(generatedReport.mutations[0]?.status).toBe("caught");
    const missing = computeMissingChecks(typical, weakReport.mutations, generatedReport);
    expect(missing.map((c) => c.scenarioId)).toEqual(["case:alice:note-b:read", "case:bob:note-a:read"]);
  });
});
