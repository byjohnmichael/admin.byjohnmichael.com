import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const pid = Number(body?.pid);
  const signal: NodeJS.Signals = body?.signal === "KILL" ? "SIGKILL" : "SIGTERM";

  if (!Number.isInteger(pid) || pid <= 1) {
    return NextResponse.json({ error: "Invalid PID." }, { status: 400 });
  }
  if (pid === process.pid || pid === process.ppid) {
    return NextResponse.json(
      { error: "Refusing to kill the dashboard process." },
      { status: 400 },
    );
  }

  // try as the app's own user first; fall back to passwordless sudo for
  // processes owned by someone else (e.g. root)
  try {
    process.kill(pid, signal);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return NextResponse.json({ error: "No such process." }, { status: 404 });
    }
    if (code !== "EPERM") {
      return NextResponse.json(
        { error: (err as Error).message || "kill failed" },
        { status: 400 },
      );
    }
  }

  const flag = signal === "SIGKILL" ? "-KILL" : "-TERM";
  try {
    await execFileAsync("sudo", ["-n", "kill", flag, String(pid)], {
      timeout: 5000,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return NextResponse.json(
      { error: (e.stderr || e.message || "kill failed").trim() },
      { status: 400 },
    );
  }
}

// byjohnmichael*
