import type { AssuranceReport } from "@/src/core/models/results";

export interface LabRunState {
  status: "idle" | "running" | "finished";
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  log: string[];
  command: string;
}

export type ReportResponse =
  | { status: "ok"; path: string; modifiedAt: string; report: AssuranceReport }
  | { status: "missing"; path: string }
  | { status: "invalid"; path: string; error: string };
