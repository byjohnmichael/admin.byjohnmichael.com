import { NextResponse } from "next/server";
import { getGeneralSummary } from "@/lib/serverStatus";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getGeneralSummary());
}

// byjohnmichael*
