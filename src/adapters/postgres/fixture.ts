import type { LocalConnection } from "./connection";
import { withClient } from "./connection";
import { quoteIdent, type PostgresTarget } from "./target";

/** Recreates the disposable database, its roles and the system-under-test schema from scratch. */
export async function initializeDatabase(admin: LocalConnection, target: PostgresTarget, schemaSql: string) {
  await withClient({ ...admin, database: "postgres" }, async (client) => {
    await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()", [target.database]);
    await client.query(`DROP DATABASE IF EXISTS ${quoteIdent(target.database)}`);
    for (const role of [target.appRole, target.ownerRole]) await client.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
    for (const role of [target.ownerRole, target.appRole]) {
      await client.query(`CREATE ROLE ${quoteIdent(role)} NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT`);
    }
    await client.query(`CREATE DATABASE ${quoteIdent(target.database)}`);
  });
  await withClient({ ...admin, database: target.database }, async (client) => {
    await client.query(schemaSql);
  });
}
