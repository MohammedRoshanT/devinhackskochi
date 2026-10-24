import { NextResponse, type NextRequest } from "next/server";
import { getLabRun, startLabRun } from "@/app/lib/lab-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "cache-control": "no-store" };

export function GET() {
  return NextResponse.json(getLabRun(), { headers: noStore });
}

/** Starts the fixed lab command. The request body is ignored; nothing from the browser reaches the process. */
export function POST(request: NextRequest) {
  if (process.env.AAL_DISABLE_LAB_RUNS === "1") {
    return NextResponse.json({ error: "Lab runs are disabled on this server (AAL_DISABLE_LAB_RUNS=1). Run npm run lab in a terminal." }, { status: 403 });
  }
  // A custom header cannot be sent cross-origin without a CORS preflight, which this route never approves.
  if (request.headers.get("x-aal-action") !== "run-lab" || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Rejected: lab runs can only be started from the dashboard." }, { status: 403 });
  }
  const { started, state } = startLabRun();
  return NextResponse.json(state, { status: started ? 202 : 409, headers: noStore });
}
