import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

/** Optional `aal.config.json` describing which supported project the validation commands run. */
const configSchema = z.object({
  version: z.literal(1),
  name: z.string().optional(),
  adapter: z.literal("postgres-rls"),
  /** Directory containing spec.json, schema.sql, mutations.json and target.json, relative to this config file. */
  project: z.object({ dir: z.string().min(1) }).strict(),
  /** Overrides the report output path for validate/lab runs (repo-relative). */
  reportPath: z.string().min(1).optional(),
}).strict();

export const DEFAULT_CONFIG_PATH = "aal.config.json";

export interface LabConfig {
  path: string;
  name: string | null;
  adapter: "postgres-rls";
  projectDir: string;
  reportPath: string | null;
}

export async function loadConfig(configPath = DEFAULT_CONFIG_PATH): Promise<LabConfig> {
  const file = resolve(process.cwd(), configPath);
  const parsed = configSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`Invalid ${configPath}: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`);
  }
  const config = parsed.data;
  return {
    path: file,
    name: config.name ?? null,
    adapter: config.adapter,
    projectDir: resolve(dirname(file), config.project.dir),
    reportPath: config.reportPath ?? null,
  };
}
