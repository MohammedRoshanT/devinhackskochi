import type { Client } from "pg";
import type { AuthorizationAdapter, MutationExecution } from "../../core/mutation/engine";
import type { AuthorizationScenario, EnvironmentCheck, Evidence, MutationDefinition, Observation } from "../../core/models/results";
import { assertLocal, inRolledBackTransaction, withClient, type LocalConnection } from "./connection";
import { qualified, quoteIdent, type PostgresTarget, type TableMapping } from "./target";

const POLICY_COMMAND = { select: "SELECT", update: "UPDATE" } as const;

export interface PostgresAdapterHooks {
  /** Test-only fault injection: runs inside the mutation transaction after the mutation is applied. */
  afterMutationApplied?: (client: Client) => Promise<void>;
}

interface PgError { code?: string; message?: string }
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Tests PostgreSQL Row Level Security directly. Every scenario runs inside a savepoint of a
 * rolled-back transaction: the bootstrap superuser verifies the fixture row, switches to the
 * non-superuser application role with SET LOCAL ROLE, sets the test identity with set_config,
 * performs the action and records what was actually observable.
 */
export class PostgresRlsAdapter implements AuthorizationAdapter {
  readonly id = "postgres-rls";
  readonly description = "PostgreSQL Row Level Security test adapter (SET LOCAL ROLE + session identity setting)";

  constructor(
    private readonly target: PostgresTarget,
    private readonly connection: LocalConnection,
    private readonly hooks: PostgresAdapterHooks = {},
  ) {
    assertLocal(connection);
  }

  private mapping(resourceType: string): TableMapping {
    const mapping = this.target.resourceTypes[resourceType];
    if (!mapping) throw new Error(`No PostgreSQL mapping for resource type "${resourceType}".`);
    return mapping;
  }

  async checkEnvironment(scenarios: AuthorizationScenario[]): Promise<EnvironmentCheck[]> {
    return withClient(this.connection, async (client) => {
      const checks: EnvironmentCheck[] = [{ name: "local-connection", passed: true, detail: `${this.connection.host}:${this.connection.port}/${this.connection.database}` }];
      const version = await client.query<{ v: string; n: string }>("SELECT current_setting('server_version') AS v, current_setting('server_version_num') AS n");
      checks.push({ name: "postgres-version", passed: Number(version.rows[0]!.n) >= 160000, detail: `PostgreSQL ${version.rows[0]!.v}` });

      const role = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1", [this.target.appRole]);
      const app = role.rows[0];
      checks.push({
        name: "app-role-cannot-bypass-rls",
        passed: !!app && !app.rolsuper && !app.rolbypassrls,
        detail: app ? `${this.target.appRole}: superuser=${app.rolsuper}, bypassrls=${app.rolbypassrls}` : `Role ${this.target.appRole} not found`,
      });

      const fn = await client.query<{ ok: boolean | null }>("SELECT has_function_privilege($1, to_regprocedure($2 || '()'), 'EXECUTE') AS ok", [this.target.appRole, this.target.identityFunction]);
      checks.push({ name: "identity-helper", passed: fn.rows[0]?.ok === true, detail: `${this.target.identityFunction}() executable by ${this.target.appRole}` });

      const missingMappings = scenarios.filter((s) => !this.target.resourceTypes[s.resourceType]?.actions[s.action]);
      checks.push({ name: "scenario-mapping", passed: missingMappings.length === 0, detail: missingMappings.length ? `Unmapped: ${missingMappings.map((s) => s.id).join(", ")}` : `All ${scenarios.length} scenarios map to SQL operations` });

      for (const [type, mapping] of Object.entries(this.target.resourceTypes)) {
        const table = await client.query<{ rls: boolean; force: boolean; owner: string }>(
          "SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2",
          [mapping.schema, mapping.table],
        );
        const t = table.rows[0];
        checks.push({
          name: `rls-enforced:${type}`,
          passed: !!t && t.rls && t.force && t.owner !== this.target.appRole,
          detail: t ? `${mapping.schema}.${mapping.table}: rls=${t.rls}, force=${t.force}, owner=${t.owner}` : `${mapping.schema}.${mapping.table} not found`,
        });
      }

      const fixtureProblems: string[] = [];
      for (const scenario of uniqueResources(scenarios)) {
        const mapping = this.target.resourceTypes[scenario.resourceType];
        if (!mapping) continue;
        const row = await client.query<{ owner: string }>(`SELECT ${quoteIdent(mapping.ownerColumn)}::text AS owner FROM ${qualified(mapping)} WHERE ${quoteIdent(mapping.idColumn)} = $1`, [scenario.resourceId]);
        if (row.rowCount !== 1) fixtureProblems.push(`${scenario.resourceId} missing`);
        else if (row.rows[0]!.owner !== (scenario.ownerId ?? null)) fixtureProblems.push(`${scenario.resourceId} owned by ${row.rows[0]!.owner}, spec says ${scenario.ownerId}`);
      }
      checks.push({ name: "fixtures-match-spec", passed: fixtureProblems.length === 0, detail: fixtureProblems.join("; ") || "Every resource exists with the specified owner" });
      return checks;
    });
  }

  async runScenarios(scenarios: AuthorizationScenario[]): Promise<Observation[]> {
    return withClient(this.connection, (client) =>
      inRolledBackTransaction(client, async () => {
        const observations: Observation[] = [];
        for (const scenario of scenarios) observations.push(await this.executeScenario(client, scenario));
        return observations;
      }));
  }

  async runScenariosUnderMutation(mutation: MutationDefinition, scenarios: AuthorizationScenario[]): Promise<MutationExecution> {
    const mapping = this.target.resourceTypes[mutation.target.resourceType];
    const action = mapping?.actions[mutation.target.action];
    if (!mapping || !action) {
      return { applied: false, reason: `No PostgreSQL mapping for ${mutation.target.resourceType}/${mutation.target.action}.`, change: null };
    }
    const command = POLICY_COMMAND[action.operation];

    return withClient(this.connection, (client) =>
      inRolledBackTransaction(client, async (): Promise<MutationExecution> => {
        const policies = await client.query<{ policyname: string; qual: string | null }>(
          "SELECT policyname, qual FROM pg_policies WHERE schemaname = $1 AND tablename = $2 AND cmd IN ($3, 'ALL') ORDER BY policyname",
          [mapping.schema, mapping.table, command],
        );
        if (policies.rowCount === 0) {
          return { applied: false, reason: `No ${command} policy exists on ${mapping.schema}.${mapping.table}.`, change: null };
        }
        const statements = policies.rows.map((p) => `ALTER POLICY ${quoteIdent(p.policyname)} ON ${qualified(mapping)} USING (true)`);
        const before = policies.rows.map((p) => `${p.policyname}: USING ${p.qual}`).join("; ");
        try {
          for (const statement of statements) await client.query(statement);
        } catch (error) {
          return { applied: false, reason: `Mutation DDL failed: ${errorMessage(error)}`, change: null };
        }
        const mutated = await client.query<{ policyname: string; qual: string | null }>(
          "SELECT policyname, qual FROM pg_policies WHERE schemaname = $1 AND tablename = $2 AND policyname = ANY($3) ORDER BY policyname",
          [mapping.schema, mapping.table, policies.rows.map((p) => p.policyname)],
        );
        const after = mutated.rows.map((p) => `${p.policyname}: USING ${p.qual}`).join("; ");
        const change = { description: mutation.description, statements, before, after };
        if (mutated.rows.length !== policies.rows.length || mutated.rows.some((p) => p.qual !== "true")) {
          return { applied: false, reason: "Mutation could not be confirmed in the catalog.", change };
        }

        await this.hooks.afterMutationApplied?.(client);
        const observations: Observation[] = [];
        for (const scenario of scenarios) observations.push(await this.executeScenario(client, scenario));
        return { applied: true, change, observations };
      }));
  }

  async captureAuthorizationState(): Promise<string> {
    const tables = Object.values(this.target.resourceTypes).map((m) => `${m.schema}.${m.table}`);
    return withClient(this.connection, async (client) => {
      const result = await client.query<{ state: unknown }>(
        `SELECT json_build_object(
           'tables', (SELECT coalesce(json_agg(json_build_object('table', n.nspname || '.' || c.relname, 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity, 'owner', pg_get_userbyid(c.relowner)) ORDER BY n.nspname, c.relname), '[]')
                      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname || '.' || c.relname = ANY($1)),
           'policies', (SELECT coalesce(json_agg(json_build_object('table', schemaname || '.' || tablename, 'name', policyname, 'permissive', permissive, 'roles', roles, 'cmd', cmd, 'using', qual, 'check', with_check) ORDER BY schemaname, tablename, policyname), '[]')
                        FROM pg_policies WHERE schemaname || '.' || tablename = ANY($1)),
           'grants', (SELECT coalesce(json_agg(json_build_object('table', table_schema || '.' || table_name, 'privilege', privilege_type) ORDER BY table_schema, table_name, privilege_type), '[]')
                      FROM information_schema.role_table_grants WHERE grantee = $2 AND table_schema || '.' || table_name = ANY($1)),
           'identityFunction', (SELECT pg_get_functiondef(to_regprocedure($3 || '()')))
         ) AS state`,
        [tables, this.target.appRole, this.target.identityFunction],
      );
      return JSON.stringify(result.rows[0]!.state);
    });
  }

  private async executeScenario(client: Client, scenario: AuthorizationScenario): Promise<Observation> {
    let mapping: TableMapping;
    try {
      mapping = this.mapping(scenario.resourceType);
    } catch (error) {
      return { status: "error", message: errorMessage(error) };
    }
    const action = mapping.actions[scenario.action];
    if (!action) return { status: "error", message: `No PostgreSQL operation mapped for action "${scenario.action}".` };

    const table = qualified(mapping);
    const idColumn = quoteIdent(mapping.idColumn);
    const evidence: Evidence = { operation: action.operation.toUpperCase() };
    await client.query("SAVEPOINT aal_scenario");
    try {
      // Oracle (bootstrap superuser, bypasses RLS): the row must exist, so "0 rows" later means filtered, not missing.
      const oracle = await client.query<{ owner: string }>(`SELECT ${quoteIdent(mapping.ownerColumn)}::text AS owner FROM ${table} WHERE ${idColumn} = $1`, [scenario.resourceId]);
      if (oracle.rowCount !== 1) return { status: "error", message: `Fixture row ${scenario.resourceId} does not exist.` };
      if (oracle.rows[0]!.owner !== scenario.ownerId) return { status: "error", message: `Fixture owner mismatch for ${scenario.resourceId}.` };
      evidence.resourceExists = true;

      await client.query(`SET LOCAL ROLE ${quoteIdent(this.target.appRole)}`);
      await client.query("SELECT set_config($1, $2, true)", [this.target.identitySetting, scenario.identityId]);
      const guard = await client.query<{ role: string; rolsuper: boolean; rolbypassrls: boolean; row_security: string; identity: string | null }>(
        `SELECT current_user::text AS role, r.rolsuper, r.rolbypassrls, current_setting('row_security') AS row_security, ${this.target.identityFunction}() AS identity
         FROM pg_roles r WHERE r.rolname = current_user`,
      );
      const g = guard.rows[0];
      if (!g || g.role !== this.target.appRole || g.rolsuper || g.rolbypassrls || g.row_security !== "on" || g.identity !== scenario.identityId) {
        return { status: "error", message: `Execution context check failed: ${JSON.stringify(g ?? null)}` };
      }
      evidence.executedAs = g.role;
      evidence.identity = g.identity;

      if (action.operation === "select") {
        const rows = await client.query(`SELECT ${idColumn} FROM ${table} WHERE ${idColumn} = $1`, [scenario.resourceId]);
        evidence.rowsReturned = rows.rowCount ?? 0;
        return { status: "completed", observedOutcome: evidence.rowsReturned > 0 ? "allow" : "deny", evidence };
      }

      const column = quoteIdent(action.column);
      const marker = `aal-probe:${scenario.id}`;
      let rowsAffected = 0;
      try {
        await client.query("SAVEPOINT aal_action");
        rowsAffected = (await client.query(`UPDATE ${table} SET ${column} = $2 WHERE ${idColumn} = $1`, [scenario.resourceId, marker])).rowCount ?? 0;
        await client.query("RELEASE SAVEPOINT aal_action");
      } catch (error) {
        if ((error as PgError).code !== "42501") throw error;
        await client.query("ROLLBACK TO SAVEPOINT aal_action");
        evidence.sqlstate = "42501";
      }
      // Verify the actual data as the superuser instead of trusting the row count alone.
      await client.query("RESET ROLE");
      const check = await client.query<{ changed: boolean }>(`SELECT ${column} = $2 AS changed FROM ${table} WHERE ${idColumn} = $1`, [scenario.resourceId, marker]);
      const changed = check.rows[0]?.changed === true;
      evidence.rowsAffected = rowsAffected;
      evidence.dataChanged = changed;
      if ((rowsAffected > 0) !== changed) return { status: "error", message: "Row count and observed data change disagree.", evidence };
      return { status: "completed", observedOutcome: changed ? "allow" : "deny", evidence };
    } catch (error) {
      return { status: "error", message: errorMessage(error), evidence };
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT aal_scenario");
      await client.query("RELEASE SAVEPOINT aal_scenario");
    }
  }
}

function uniqueResources(scenarios: AuthorizationScenario[]) {
  const seen = new Map<string, AuthorizationScenario>();
  for (const s of scenarios) if (!seen.has(s.resourceId)) seen.set(s.resourceId, s);
  return [...seen.values()];
}
