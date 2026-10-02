import { execFile } from "child_process";
import { promisify } from "util";
import { runRcon } from "@/lib/rcon";

const execFileAsync = promisify(execFile);

const MC_CONTAINER = process.env.MC_CONTAINER ?? "minecraft";

const TICK_MS = 4000;
const HISTORY_MAX = 150; // 10 min at 4s

export type McPerfSnapshot = {
  t: number;
  tps1m: number | null;
  tps5m: number | null;
  tps15m: number | null;
  msptAvg5s: number | null;
  msptMin5s: number | null;
  msptMax5s: number | null;
  msptAvg1m: number | null;
};

type SamplerState = {
  history: McPerfSnapshot[];
  timer: ReturnType<typeof setInterval> | null;
  priming: Promise<void> | null;
  lastError: string | null;
};

const GLOBAL_KEY = "__adminMcPerfSampler__";
const store = globalThis as unknown as Record<string, SamplerState | undefined>;
const state: SamplerState =
  store[GLOBAL_KEY] ??
  (store[GLOBAL_KEY] = {
    history: [],
    timer: null,
    priming: null,
    lastError: null,
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// rcon-cli's own stdout carries both ANSI escapes (its terminal renderer) and
// literal Minecraft §-codes (from components rcon-cli didn't recolor) — strip
// both before parsing the numbers out.
function stripCodes(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/§./g, "");
}

function parseTps(
  raw: string,
): Pick<McPerfSnapshot, "tps1m" | "tps5m" | "tps15m"> {
  const clean = stripCodes(raw);
  const m = /([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(clean);
  if (!m) return { tps1m: null, tps5m: null, tps15m: null };
  return { tps1m: Number(m[1]), tps5m: Number(m[2]), tps15m: Number(m[3]) };
}

function parseMspt(
  raw: string,
): Pick<McPerfSnapshot, "msptAvg5s" | "msptMin5s" | "msptMax5s" | "msptAvg1m"> {
  const clean = stripCodes(raw);
  // "avg/min/max" for the 5s, 10s, 1m windows, in that order
  const groups = clean.match(/([\d.]+)\/([\d.]+)\/([\d.]+)/g);
  if (!groups || groups.length < 3) {
    return { msptAvg5s: null, msptMin5s: null, msptMax5s: null, msptAvg1m: null };
  }
  const nums = (g: string) => g.split("/").map(Number);
  const [avg5s, min5s, max5s] = nums(groups[0]);
  const [avg1m] = nums(groups[2]);
  return { msptAvg5s: avg5s, msptMin5s: min5s, msptMax5s: max5s, msptAvg1m: avg1m };
}

async function tick(): Promise<void> {
  try {
    const [tpsRaw, msptRaw] = await Promise.all([
      runRcon(["tps"]),
      runRcon(["mspt"]),
    ]);
    state.history.push({
      t: Date.now(),
      ...parseTps(tpsRaw),
      ...parseMspt(msptRaw),
    });
    if (state.history.length > HISTORY_MAX) state.history.shift();
    state.lastError = null;
  } catch (err) {
    state.lastError = (err as Error).message ?? String(err);
  }
}

function ensureSampler(): void {
  if (state.timer) return;
  const timer = setInterval(tick, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  state.timer = timer;
}

export type McPerfResponse = {
  current: McPerfSnapshot | null;
  history: McPerfSnapshot[];
  error: string | null;
};

export async function getMcPerf(): Promise<McPerfResponse> {
  ensureSampler();

  if (state.history.length === 0 && !state.priming) {
    state.priming = tick();
  }
  if (state.priming) {
    await state.priming;
    state.priming = null;
  }

  return {
    current: state.history[state.history.length - 1] ?? null,
    history: state.history,
    error: state.lastError,
  };
}

/* --------------------------------------------------------- spark reports */
//
// spark's `health` and `profiler stop` commands don't return their report
// over RCON — the link is only ever printed to the server console, uploaded
// asynchronously a couple of seconds after the command completes. So: send
// the command, then poll `docker logs` (scoped to just-now) until the link
// shows up or we give up.

export type SparkAction = "health" | "flamegraph";

const SPARK_COMMANDS: Record<SparkAction, string[]> = {
  health: ["spark", "health"],
  // `profiler stop` reports on whatever's been captured by spark's
  // always-on background profiler since it last started/restarted, and
  // spark immediately restarts a fresh background window afterwards.
  flamegraph: ["spark", "profiler", "stop"],
};

const SPARK_LINK_RE = /https:\/\/spark\.lucko\.me\/\S+/;

export async function generateSparkReport(
  action: SparkAction,
): Promise<{ url: string | null; error: string | null }> {
  const sinceSec = Math.floor(Date.now() / 1000);
  try {
    await runRcon(SPARK_COMMANDS[action]);
  } catch (err) {
    return { url: null, error: (err as Error).message ?? String(err) };
  }

  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    try {
      const { stdout } = await execFileAsync(
        "docker",
        ["logs", "--since", String(sinceSec), MC_CONTAINER],
        { timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      );
      const m = SPARK_LINK_RE.exec(stripCodes(stdout));
      if (m) return { url: m[0], error: null };
    } catch {
      // container logs briefly unavailable — keep polling
    }
  }
  return { url: null, error: "Timed out waiting for spark's report link." };
}

// byjohnmichael*
