import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/cli/config";
import { loadProject } from "../src/cli/project";
import { outcomeExitCode } from "../src/cli/validate";
import { runMutationCampaign, type AuthorizationAdapter } from "../src/core/mutation/engine";
import spec from "../examples/postgres-notes/spec.json";
import mutations from "../examples/postgres-notes/mutations.json";
import { generateScenarios } from "../src/core/generation/generate";
import { parseSpecification } from "../src/core/rules/validation";
import { parseMutationDefinitions } from "../src/core/mutation/definitions";

const validated = parseSpecification(JSON.stringify(spec));
if (!validated.valid) throw new Error("example spec must stay valid");
const parsedSpec = validated.specification;
const scenarios = generateScenarios(parsedSpec).scenarios;
const defs = parseMutationDefinitions(mutations, parsedSpec);

const adapter = (mutatedOutcome: (scenario: (typeof scenarios)[number]) => "allow" | "deny" | undefined): AuthorizationAdapter => ({
  id: "fake",
  description: "fake",
  checkEnvironment: async () => [{ name: "fake", passed: true, detail: "" }],
  captureAuthorizationState: async () => "fingerprint",
  runScenarios: async (list) => list.map(() => ({ status: "completed" as const, observedOutcome: "allow" as const, evidence: {} })),
  runScenariosUnderMutation: async (_m, list) => ({
    applied: true,
    change: { description: "d", statements: ["ALTER POLICY x USING (true)"], before: "a", after: "b" },
    observations: list.map((s) => {
      const forced = mutatedOutcome(s);
      return { status: "completed" as const, observedOutcome: forced ?? s.expectedOutcome, evidence: {} };
    }),
  }),
});

describe("npm run validate outcome mapping", () => {
  it.each([
    ["all-caught", 0],
    ["survivors", 2],
    ["inconclusive", 1],
    ["error", 1],
  ])("%s → exit %i", (status, code) => expect(outcomeExitCode(status)).toBe(code));

  it("baseline failure makes the outcome inconclusive (nonzero)", async () => {
    const report = await runMutationCampaign({ specificationName: parsedSpec.name, adapter: adapter(() => undefined), scenarios, mutations: defs });
    expect(report.baseline?.allPassed).toBe(false); // every deny scenario wrongly allowed
    expect(report.outcome.status).not.toBe("all-caught");
    expect(outcomeExitCode(report.outcome.status)).not.toBe(0);
  });

  it("a mutation that no scenario catches is reported survived → exit 2", async () => {
    const ok = (scenario: (typeof scenarios)[number]) => scenario.expectedOutcome;
    const report = await runMutationCampaign({
      specificationName: parsedSpec.name,
      adapter: {
        ...adapter(() => undefined),
        runScenarios: async (list) => list.map((s) => ({ status: "completed" as const, observedOutcome: ok(s), evidence: {} })),
      },
      scenarios,
      mutations: defs,
    });
    expect(report.mutations[0]?.status).toBe("survived");
    expect(report.outcome.status).toBe("survivors");
    expect(outcomeExitCode(report.outcome.status)).toBe(2);
  });
});

describe("aal.config.json", () => {
  const tmp = () => mkdtempSync(join(tmpdir(), "aal-config-"));
  it("resolves the project directory relative to the config file", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "aal.config.json"), JSON.stringify({ version: 1, adapter: "postgres-rls", project: { dir: join(process.cwd(), "examples/postgres-notes") } }));
    const config = await loadConfig(join(dir, "aal.config.json"));
    expect(config.adapter).toBe("postgres-rls");
    expect((await loadProject(config.projectDir)).scenarios.length).toBe(8);
  });
  it("rejects unknown adapters and extra fields instead of guessing", async () => {
    const dir = tmp();
    for (const bad of [{ adapter: "supabase" }, { githubUrl: "https://github.com/x/y" }]) {
      writeFileSync(join(dir, "c.json"), JSON.stringify({ version: 1, project: { dir: "." }, ...bad }));
      await expect(loadConfig(join(dir, "c.json"))).rejects.toThrow(/Invalid/);
    }
  });
  it("the committed aal.config.json points at a loadable project", async () => {
    const config = await loadConfig("aal.config.json");
    expect((await loadProject(config.projectDir)).mutations.length).toBe(1);
  });
});

describe("git pre-push hook (explicitly installed)", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  const makeRepo = (validateExit: number) => {
    const dir = mkdtempSync(join(tmpdir(), "aal-repo-"));
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // the installer copies scripts/git-hooks/pre-push from the repo being hooked
    mkdirSync(join(dir, "scripts/git-hooks"), { recursive: true });
    execFileSync("cp", ["-r", join(process.cwd(), "scripts/git-hooks"), join(dir, "scripts/")]);
    writeFileSync(join(bin, "npm"), `#!/bin/sh\nif [ "$1" = "run" ] && [ "$2" = "validate" ]; then echo "stub npm: validate"; exit ${validateExit}; fi\nexit 9\n`);
    writeFileSync(join(bin, "git"), "#!/bin/sh\nexec /usr/bin/git \"$@\"\n");
    execFileSync("chmod", ["+x", join(bin, "npm"), join(bin, "git")]);
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@t");
    git(dir, "config", "user.name", "t");
    writeFileSync(join(dir, "f.txt"), "x");
    git(dir, "add", ".");
    git(dir, "commit", "-qm", "init");
    git(dir, "init", "-q", "--bare", join(dir, "remote.git"));
    git(dir, "remote", "add", "origin", join(dir, "remote.git"));
    return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GIT_TERMINAL_PROMPT: "0" } };
  };
  const push = (env: NodeJS.ProcessEnv, dir: string) =>
    spawnSync("git", ["push", "-u", "origin", "HEAD:main"], { cwd: dir, env, encoding: "utf8" });

  it("install script copies the hook and refuses to overwrite a foreign one", () => {
    const { dir } = makeRepo(0);
    writeFileSync(join(dir, ".git/hooks/pre-push"), "#!/bin/sh\n# mine\n");
    const refused = spawnSync("sh", [join(process.cwd(), "scripts/install-hooks.sh")], { cwd: dir, encoding: "utf8" });
    expect(refused.status).toBe(1);
    expect(readFileSync(join(dir, ".git/hooks/pre-push"), "utf8")).toContain("# mine");
    execFileSync("rm", [join(dir, ".git/hooks/pre-push")]);
    const installed = spawnSync("sh", [join(process.cwd(), "scripts/install-hooks.sh")], { cwd: dir, encoding: "utf8" });
    expect(installed.status).toBe(0);
    expect(readFileSync(join(dir, ".git/hooks/pre-push"), "utf8")).toContain("npm run validate");
  });

  it("blocks the push when validation fails and allows it when validation passes", () => {
    const failing = makeRepo(1);
    execFileSync("sh", [join(process.cwd(), "scripts/install-hooks.sh")], { cwd: failing.dir });
    const blocked = push(failing.env, failing.dir);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr + blocked.stdout).toContain("npm run validate");

    const passing = makeRepo(0);
    execFileSync("sh", [join(process.cwd(), "scripts/install-hooks.sh")], { cwd: passing.dir });
    const allowed = push(passing.env, passing.dir);
    expect(allowed.status).toBe(0);
  });
});
