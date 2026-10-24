import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { generateScenarios } from "../core/generation/generate";
import { parseMutationDefinitions } from "../core/mutation/definitions";
import { parseSpecification } from "../core/rules/validation";
import { postgresTargetSchema } from "../adapters/postgres/target";

export const DEFAULT_EXAMPLE = "examples/postgres-notes";
export { DEFAULT_REPORT_PATH } from "./paths";

export async function loadProject(directory = DEFAULT_EXAMPLE) {
  const dir = resolve(process.cwd(), directory);
  const read = (file: string) => readFile(join(dir, file), "utf8");
  const validation = parseSpecification(await read("spec.json"));
  if (!validation.valid) {
    throw new Error(`Invalid specification:\n${validation.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  }
  const spec = validation.specification;
  return {
    dir,
    spec,
    warnings: validation.warnings,
    scenarios: generateScenarios(spec).scenarios,
    mutations: parseMutationDefinitions(JSON.parse(await read("mutations.json")), spec),
    target: postgresTargetSchema.parse(JSON.parse(await read("target.json"))),
    schemaSql: await read("schema.sql"),
  };
}
