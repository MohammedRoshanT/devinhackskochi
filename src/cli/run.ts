import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { styleText } from "node:util";
import { PostgresRlsAdapter } from "../adapters/postgres/adapter";
import { adminConnection, defaultContainer, startContainer, stopContainer, waitForPostgres } from "../adapters/postgres/docker";
import { initializeDatabase } from "../adapters/postgres/fixture";
import type { AssuranceReport, SuiteRun } from "../core/models/results";
import { runMutationCampaign } from "../core/mutation/engine";
import { loadProject } from "./project";

export interface RunOptions {
  example: string;
  report: string;
  keepDb: boolean;
  reuseDb: boolean;
}
const ok = (text: string) => styleText("green", text);
const bad = (text: string) => styleText("red", text);
const warn = (text: string) => styleText("yellow", text);
const dim = (text: string) => styleText("dim", text);
const step = (text: string) => console.log(styleText("bold", `\n▸ ${text}`));

function printSuite(title: string, suite: SuiteRun | null) {
  if (!suite) return;
  console.log(`  ${title}: ${suite.allPassed ? ok(`${suite.passed}/${suite.total} passed`) : bad(`${suite.passed}/${suite.total} passed, ${suite.failed} failed, ${suite.errors} errors`)}`);
  for (const r of suite.results) {
    const mark = r.verdict === "passed" ? ok("PASS") : r.verdict === "failed" ? bad("FAIL") : warn("ERR ");
    const observed = r.status === "completed" ? r.observedOutcome : `error: ${r.message}`;
    const detail = r.evidence ? dim(Object.entries(r.evidence).filter(([k]) => ["rowsReturned", "rowsAffected", "dataChanged", "sqlstate"].includes(k)).map(([k, v]) => `${k}=${v}`).join(" ")) : "";
    console.log(`    ${mark} ${r.identityId.padEnd(6)} ${r.action.padEnd(7)} ${r.resourceId.padEnd(7)} expected ${r.expectedOutcome.padEnd(5)} observed ${observed.padEnd(5)} ${detail}`);
  }
}

function printReport(report: AssuranceReport) {
  step("Environment checks");
  for (const c of report.environment.checks) console.log(`  ${c.passed ? ok("✔") : bad("✘")} ${c.name} ${dim(c.detail)}`);
  step("Baseline (original policies)");
  printSuite("Suite", report.baseline);
  for (const m of report.mutations) {
    step(`Mutation ${m.mutation.id}`);
    console.log(`  ${m.mutation.description}`);
    if (m.change) {
      for (const s of m.change.statements) console.log(`  ${dim("SQL:")} ${s}`);
      console.log(`  ${dim("before:")} ${m.change.before}`);
      console.log(`  ${dim("after: ")} ${m.change.after}`);
    }
    printSuite("Relevant scenarios under mutation", m.suite);
    const status = m.status === "caught" ? ok("CAUGHT") : m.status === "survived" ? warn("SURVIVED") : bad("INCONCLUSIVE");
    console.log(`  Result: ${status} — ${m.reason}`);
    if (m.caughtBy.length) console.log(`  Caught by: ${m.caughtBy.join(", ")}`);
    console.log(`  Restoration: ${m.restoration.verified ? ok("verified") : bad("NOT verified")} — ${m.restoration.message}`);
  }
  step("Baseline after restoration");
  printSuite("Suite", report.baselineAfterRestore);
  const colour = report.outcome.status === "all-caught" ? ok : report.outcome.status === "survivors" ? warn : bad;
  console.log(`\n${colour(`Outcome: ${report.outcome.status}`)} — ${report.outcome.message}`);
}

export async function run(options: RunOptions): Promise<number> {
  step("Loading specification");
  const project = await loadProject(options.example);
  console.log(`  ${project.spec.name}: ${project.scenarios.length} generated scenarios, ${project.mutations.length} mutation(s)`);
  for (const warning of project.warnings) console.log(`  ${warn("warning:")} ${warning.message}`);

  const container = defaultContainer;
  const admin = adminConnection(container);
  const manageContainer = !options.reuseDb;
  try {
    if (manageContainer) {
      step(`Starting disposable PostgreSQL (${container.image}, 127.0.0.1:${container.port})`);
      await startContainer(container);
    }
    await waitForPostgres(admin);
    step("Initializing schema, roles and RLS policies");
    await initializeDatabase(admin, project.target, project.schemaSql);

    const adapter = new PostgresRlsAdapter(project.target, adminConnection(container, project.target.database));
    const report = await runMutationCampaign({ specificationName: project.spec.name, adapter, scenarios: project.scenarios, mutations: project.mutations });
    printReport(report);

    const reportPath = resolve(process.cwd(), options.report);
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(dim(`Report written to ${reportPath}`));
    return report.outcome.status === "all-caught" ? 0 : report.outcome.status === "survivors" ? 2 : 1;
  } finally {
    if (manageContainer && !options.keepDb) {
      await stopContainer(container).catch((error: unknown) => console.error(bad(`Failed to remove container: ${String(error)}`)));
      console.log(dim(`Removed disposable container ${container.name}`));
    }
  }
}

