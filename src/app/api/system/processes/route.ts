import { NextResponse } from "next/server";
import { getProcessList } from "@/lib/serverStatus";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ procs: await getProcessList() });
}

// byjohnmichael*
