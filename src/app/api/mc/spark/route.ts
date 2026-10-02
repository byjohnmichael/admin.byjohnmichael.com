import { NextResponse } from "next/server";
import { generateSparkReport, type SparkAction } from "@/lib/mcPerf";

const ACTIONS: SparkAction[] = ["health", "flamegraph"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (!ACTIONS.includes(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const result = await generateSparkReport(action);
  if (!result.url) {
    return NextResponse.json({ error: result.error ?? "Failed." }, { status: 502 });
  }
  return NextResponse.json({ url: result.url });
}

// byjohnmichael*
