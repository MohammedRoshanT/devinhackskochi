import { parseArgs } from "node:util";
import { loadConfig } from "./config";
import { DEFAULT_EXAMPLE } from "./project";
import { DEFAULT_REPORT_PATH } from "./paths";
import { run } from "./run";

const { values: args } = parseArgs({
  options: {
    example: { type: "string" },
    config: { type: "string" },
    report: { type: "string" },
    "keep-db": { type: "boolean", default: false },
    "reuse-db": { type: "boolean", default: false },
  },
});

/** `--example`/`--config` explicit = use them; otherwise aal.config.json wins over the built-in example. */
export async function resolveRunOptions(flags = args): Promise<import("./run").RunOptions> {
  // `--example`/`--config` explicit = use them; otherwise aal.config.json wins over the built-in example.
  let example = flags.example;
  let report = flags.report;
  if (!example || flags.config !== undefined) {
    let projectDir = DEFAULT_EXAMPLE;
    try {
      const config = await loadConfig(flags.config ?? undefined);
      projectDir = config.projectDir;
      report ??= config.reportPath ?? DEFAULT_REPORT_PATH;
    } catch (error) {
      if (flags.config === undefined && (error as NodeJS.ErrnoException).code === "ENOENT" && (error as NodeJS.ErrnoException).path?.endsWith("aal.config.json")) {
        // no config file: use the built-in example
      } else {
        throw error;
      }
    }
    example ??= projectDir;
  }
  return { example, report: report ?? DEFAULT_REPORT_PATH, keepDb: flags["keep-db"], reuseDb: flags["reuse-db"] };
}

if (process.argv[1]?.endsWith("lab.ts")) {
  resolveRunOptions().then(run).then((code) => process.exit(code), (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
