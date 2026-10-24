import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import type { LocalConnection } from "./connection";

const run = promisify(execFile);
const LABEL = "dev.authorization-assurance-lab=disposable";

export interface ContainerConfig {
  name: string;
  image: string;
  port: number;
  password: string;
}

export const defaultContainer: ContainerConfig = {
  name: process.env.AAL_PG_CONTAINER ?? "aal-postgres-lab",
  image: "postgres:16-alpine",
  port: Number(process.env.AAL_PG_PORT ?? 55432),
  // Throwaway credential for a container bound to 127.0.0.1 with in-memory storage.
  password: "aal-disposable-local-only",
};

export const adminConnection = (container: ContainerConfig, database = "postgres"): LocalConnection => ({
  host: "127.0.0.1",
  port: container.port,
  user: "postgres",
  password: container.password,
  database,
});

async function docker(args: string[]) {
  const { stdout } = await run("docker", args, { timeout: 120_000 });
  return stdout.trim();
}

async function existingContainer(name: string): Promise<{ id: string; labelled: boolean } | null> {
  const id = await docker(["ps", "-aq", "--filter", `name=^/${name}$`]);
  if (!id) return null;
  const labels = await docker(["inspect", "--format", "{{json .Config.Labels}}", id]);
  return { id, labelled: labels.includes('"dev.authorization-assurance-lab":"disposable"') };
}

/** Starts a fresh disposable container, replacing a previous lab container with the same name. */
export async function startContainer(container: ContainerConfig) {
  await stopContainer(container);
  await docker([
    "run", "-d", "--rm",
    "--name", container.name,
    "--label", LABEL,
    "-e", `POSTGRES_PASSWORD=${container.password}`,
    "-p", `127.0.0.1:${container.port}:5432`,
    "--tmpfs", "/var/lib/postgresql/data",
    container.image,
  ]);
}

export async function stopContainer(container: ContainerConfig): Promise<boolean> {
  const existing = await existingContainer(container.name);
  if (!existing) return false;
  if (!existing.labelled) throw new Error(`Container "${container.name}" exists but was not created by Authorization Assurance Lab; refusing to remove it.`);
  await docker(["rm", "-f", existing.id]);
  return true;
}

export async function waitForPostgres(connection: LocalConnection, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new Client({ ...connection, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await client.end().catch(() => undefined);
    }
  }
  throw new Error(`PostgreSQL did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}
