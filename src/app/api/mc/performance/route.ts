import { NextResponse } from "next/server";
import { getMcPerf } from "@/lib/mcPerf";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getMcPerf());
}

// byjohnmichael*
