import { parseArgs, styleText } from "node:util";
import { resolveRunOptions } from "./lab";
import { run } from "./run";

const { values: args } = parseArgs({
  allowPositionals: true,
  options: {
    example: { type: "string" },
    config: { type: "string" },
    report: { type: "string" },
    "keep-db": { type: "boolean", default: false },
    "reuse-db": { type: "boolean", default: false },
  },
});

/**
 * `npm run validate`: the gateable command. Runs the full authorization validation for the
 * configured project (default `aal.config.json`): secure baseline must pass, every mutation
 * must be caught, restoration must be verified, baseline must pass again.
 * Exit 0 = validated, 2 = a mutation survived, 1 = any other failure (baseline, environment,
 * inconclusive mutation, restoration not verified, execution error).
 */
export function outcomeExitCode(status: string): number {
  return status === "all-caught" ? 0 : status === "survivors" ? 2 : 1;
}

if (process.argv[1]?.endsWith("validate.ts")) {
  resolveRunOptions(args).then(run).then((code) => {
    const verdict = code === 0 ? styleText("green", "VALIDATION PASSED") : styleText("red", `VALIDATION FAILED (exit ${code})`);
    console.log(`\n${verdict}`);
    process.exit(code);
  }, (error: unknown) => {
    console.error(styleText("red", `VALIDATION FAILED — ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  });
}
