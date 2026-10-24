import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { parseReport } from "@/app/lib/report";
import type { ReportResponse } from "@/app/lib/lab-types";
import { DEFAULT_REPORT_PATH } from "@/src/cli/paths";
import { isLocalHostHeader } from "@/app/lib/host";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalHostHeader(request.headers.get("host"))) {
    return NextResponse.json({ error: "This dashboard only serves requests addressed to localhost." }, { status: 403 });
  }
  const file = join(/* turbopackIgnore: true */ process.cwd(), DEFAULT_REPORT_PATH);
  let body: ReportResponse;
  try {
    const [source, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    let json: unknown;
    try {
      json = JSON.parse(source);
    } catch {
      json = undefined;
    }
    const parsed = json === undefined ? { ok: false as const, error: "File is not valid JSON." } : parseReport(json);
    body = parsed.ok
      ? { status: "ok", path: DEFAULT_REPORT_PATH, modifiedAt: info.mtime.toISOString(), report: parsed.report }
      : { status: "invalid", path: DEFAULT_REPORT_PATH, error: parsed.error };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return NextResponse.json({ error: `Could not read ${DEFAULT_REPORT_PATH}.` }, { status: 500 });
    }
    body = { status: "missing", path: DEFAULT_REPORT_PATH };
  }
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
