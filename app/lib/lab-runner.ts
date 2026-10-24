import { spawn } from "node:child_process";
import type { LabRunState } from "./lab-types";

const COMMAND = "npm run lab";
const MAX_LOG_LINES = 400;
const RUN_TIMEOUT_MS = 5 * 60_000;

const idle = (): LabRunState => ({ status: "idle", startedAt: null, finishedAt: null, exitCode: null, error: null, log: [], command: COMMAND });

// Kept on globalThis so the single-run lock survives module reloads in `next dev`.
const store = globalThis as typeof globalThis & { __aalLabRun?: LabRunState };

export function getLabRun(): LabRunState {
  return store.__aalLabRun ?? idle();
}

/**
 * Starts the fixed `npm run lab` command (no arguments, no shell, no user input).
 * Only one run can be active at a time.
 */
export function startLabRun(): { started: boolean; state: LabRunState } {
  const current = getLabRun();
  if (current.status === "running") return { started: false, state: current };

  const state: LabRunState = { ...idle(), status: "running", startedAt: new Date().toISOString() };
  store.__aalLabRun = state;

  const npmCli = process.env.npm_execpath;
  const [command, args] = npmCli?.endsWith(".js")
    ? [process.execPath, [npmCli, "run", "lab"]]
    : ["npm", ["run", "lab"]];

  const push = (line: string) => {
    state.log.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
    if (state.log.length > MAX_LOG_LINES) state.log.splice(0, state.log.length - MAX_LOG_LINES);
  };
  let pending = "";
  const onData = (chunk: Buffer) => {
    const lines = (pending + chunk.toString("utf8")).split("\n");
    pending = lines.pop() ?? "";
    lines.forEach(push);
  };
  const finish = (exitCode: number | null, error: string | null) => {
    if (state.status !== "running") return;
    clearTimeout(timer);
    if (pending) push(pending);
    Object.assign(state, { status: "finished", finishedAt: new Date().toISOString(), exitCode, error });
  };

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  const timer = setTimeout(() => {
    child.kill("SIGTERM");
    finish(null, `Timed out after ${RUN_TIMEOUT_MS / 1000}s and was stopped.`);
  }, RUN_TIMEOUT_MS);
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("error", (error) => finish(null, `Could not start ${COMMAND}: ${error.message}`));
  child.on("close", (code, signal) => finish(code, signal ? `Process ended by signal ${signal}.` : null));

  return { started: true, state };
}
