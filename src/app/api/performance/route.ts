import { NextResponse } from "next/server";
import { getPerf } from "@/lib/perfSampler";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getPerf());
}

// byjohnmichael*
