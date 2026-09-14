import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.confirm !== "reboot") {
    return NextResponse.json(
      { error: "Confirmation required." },
      { status: 400 },
    );
  }

  try {
    // Schedule the reboot a few seconds out via a transient timer so this
    // response can flush before the box goes down.
    await execFileAsync("sudo", [
      "systemd-run",
      "--on-active=3",
      "systemctl",
      "reboot",
    ]);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to schedule reboot: ${(err as Error).message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

// byjohnmichael*
