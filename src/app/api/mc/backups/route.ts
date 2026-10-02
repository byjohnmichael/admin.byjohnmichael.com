import { NextResponse } from "next/server";
import { getBackups } from "@/lib/mcBackups";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getBackups());
}

// byjohnmichael*
