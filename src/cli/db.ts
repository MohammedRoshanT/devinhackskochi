import { adminConnection, defaultContainer, startContainer, stopContainer, waitForPostgres } from "../adapters/postgres/docker";
import { initializeDatabase } from "../adapters/postgres/fixture";
import { loadProject } from "./project";

const usage = "Usage: npm run db:start | db:init | db:stop";

async function main(command: string | undefined) {
  const container = defaultContainer;
  switch (command) {
    case "start":
      await startContainer(container);
      await waitForPostgres(adminConnection(container));
      console.log(`Disposable PostgreSQL running: container ${container.name}, 127.0.0.1:${container.port}`);
      return;
    case "init": {
      const project = await loadProject(process.argv[3]);
      await waitForPostgres(adminConnection(container), 5_000);
      await initializeDatabase(adminConnection(container), project.target, project.schemaSql);
      console.log(`Initialized database ${project.target.database} from ${project.dir}/schema.sql`);
      return;
    }
    case "stop":
      console.log((await stopContainer(container)) ? `Removed container ${container.name}` : `No container named ${container.name}`);
      return;
    default:
      throw new Error(usage);
  }
}

main(process.argv[2]).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
