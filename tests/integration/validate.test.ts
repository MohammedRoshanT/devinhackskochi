import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { PostgresRlsAdapter } from "../../src/adapters/postgres/adapter";
import { adminConnection, startContainer, stopContainer, waitForPostgres, type ContainerConfig } from "../../src/adapters/postgres/docker";
import { initializeDatabase } from "../../src/adapters/postgres/fixture";
import { runMutationCampaign } from "../../src/core/mutation/engine";
import type { AuthorizationScenario, MutationDefinition } from "../../src/core/models/results";
import { loadProject } from "../../src/cli/project";
import { outcomeExitCode } from "../../src/cli/validate";

const container: ContainerConfig = { name: "aal-postgres-validate", image: "postgres:16-alpine", port: 55434, password: "aal-disposable-local-only" };
let project: Awaited<ReturnType<typeof loadProject>>;
let db: ReturnType<typeof adminConnection>;

const weaken = async (sql: string) => {
  const client = new Client(adminConnection(container, project.target.database));
  await client.connect();
  await client.query(sql);
  await client.end();
};

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

afterEach(async () => {
  await initializeDatabase(adminConnection(container), project.target, project.schemaSql);
});

describe("validation failure paths on real PostgreSQL", () => {
  it("detects a baseline failure (denied cases become allowed)", async () => {
    class BrokenBaseline extends PostgresRlsAdapter {
      override async runScenarios(list: AuthorizationScenario[]) {
        await weaken('ALTER POLICY "notes_select_own" ON "public"."notes" USING (true)');
        return super.runScenarios(list);
      }
    }
    const broken = new BrokenBaseline(project.target, db);
    const report = await runMutationCampaign({ specificationName: project.spec.name, adapter: broken, scenarios: project.scenarios, mutations: project.mutations });
    expect(report.baseline?.allPassed).toBe(false);
    expect(outcomeExitCode(report.outcome.status)).toBe(1);
  });

  it("detects restoration failure (policy differs after mutation rollback)", async () => {
    class CorruptAfterMutation extends PostgresRlsAdapter {
      override async runScenariosUnderMutation(mutation: MutationDefinition, list: AuthorizationScenario[]) {
        const result = await super.runScenariosUnderMutation(mutation, list);
        await weaken('ALTER POLICY "notes_update_own" ON "public"."notes" USING (false)');
        return result;
      }
    }
    const wrapped = new CorruptAfterMutation(project.target, db);
    const report = await runMutationCampaign({ specificationName: project.spec.name, adapter: wrapped, scenarios: project.scenarios, mutations: project.mutations });
    expect(report.mutations[0]?.restoration.verified).toBe(false);
    expect(outcomeExitCode(report.outcome.status)).toBe(1);
  });
});
