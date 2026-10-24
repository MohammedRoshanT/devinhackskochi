import { Client } from "pg";

export interface LocalConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Server-side limits so a hung or crashed client cannot hold an uncommitted mutation open. */
const SESSION_OPTIONS = "-c statement_timeout=10000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000";

export function assertLocal(connection: LocalConnection) {
  if (!LOCAL_HOSTS.has(connection.host)) {
    throw new Error(`Refusing to connect to non-local host "${connection.host}". This adapter only targets the disposable local test database.`);
  }
}

export async function withClient<T>(connection: LocalConnection, fn: (client: Client) => Promise<T>): Promise<T> {
  assertLocal(connection);
  const client = new Client({ ...connection, application_name: "authorization-assurance-lab", options: SESSION_OPTIONS });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Runs `fn` inside a transaction that is always rolled back; nothing it does is ever committed. */
export async function inRolledBackTransaction<T>(client: Client, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    return await fn();
  } finally {
    // If ROLLBACK itself fails the error propagates and withClient closes the connection,
    // which makes the server abort the open transaction.
    await client.query("ROLLBACK");
  }
}
