import { NextResponse } from "next/server";
import { getPackagesStatus } from "@/lib/packages";

export const dynamic = "force-dynamic";

// Read-only: installed packages and pending updates. ?refresh=1 re-checks the
// mirrors (at most once a minute). There is deliberately no upgrade action.
export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  return NextResponse.json(await getPackagesStatus(refresh));
}

// byjohnmichael*
