import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { runRcon } from "@/lib/rcon";
import { getPendingWhitelistRequests, getLocationRequests } from "@/lib/store";
import { getSpecs, type Specs } from "@/lib/specs";

const execFileAsync = promisify(execFile);

const MC_DATA_DIR = process.env.MC_DATA_DIR ?? "/opt/minecraft/server/data";
const MC_CONTAINER = process.env.MC_CONTAINER ?? "minecraft";
const MC_WORLD_DIR = process.env.MC_WORLD_DIR ?? path.join(MC_DATA_DIR, "world");

const WOW_MANGOSD_CONTAINER =
  process.env.WOW_MANGOSD_CONTAINER ?? "wow-wotlk-mangosd-1";
const WOW_REALMD_CONTAINER =
  process.env.WOW_REALMD_CONTAINER ?? "wow-wotlk-realmd-1";
const WOW_DB_CONTAINER =
  process.env.WOW_DB_CONTAINER ?? "wow-wotlk-database-1";
const WOW_DB_USER = process.env.WOW_DB_USER ?? "mangos";
const WOW_DB_PASSWORD = process.env.WOW_DB_PASSWORD ?? "mangos";

// systemd units for the three Next.js sites, shown as up/down dots.
const SITE_UNITS: { name: string; label: string; unit: string }[] = [
  { name: "admin", label: "admin.byjohnmichael.com", unit: "admin-site.service" },
  { name: "mc", label: "mc.byjohnmichael.com", unit: "mc-site.service" },
  { name: "wow", label: "wow.byjohnmichael.com", unit: "wow-site.service" },
];

// This app's own unit — stop/restart on it must be deferred so the HTTP
// response can flush before the process goes away.
const SELF_UNIT = process.env.ADMIN_SELF_UNIT ?? "admin-site.service";

// The "Services" panel lists every systemd .service unit by default. Set
// MANAGED_UNITS to a comma list to restrict it (each entry "unit.service" or
// "unit.service=Nice Label"); leaving it unset shows and manages them all.
const MANAGED_UNITS: { unit: string; label: string }[] = (
  process.env.MANAGED_UNITS ? process.env.MANAGED_UNITS.split(",") : []
)
  .map((raw) => raw.trim())
  .filter(Boolean)
  .map((entry) => {
    const eq = entry.indexOf("=");
    const unit = (eq === -1 ? entry : entry.slice(0, eq)).trim();
    const label =
      eq === -1 ? unit.replace(/\.service$/, "") : entry.slice(eq + 1).trim();
    return { unit, label };
  });

export const MANAGED_UNIT_NAMES = MANAGED_UNITS.map((u) => u.unit);
const RESTRICT_TO_MANAGED = MANAGED_UNITS.length > 0;

// Guards a unit name before it is handed to `sudo systemctl`. execFile already
// blocks shell injection; this also blocks option injection and junk names.
const SERVICE_UNIT_RE = /^[A-Za-z0-9@._:\\-]{1,255}\.service$/;

export type ServiceAction =
  | "start"
  | "stop"
  | "restart"
  | "enable"
  | "disable";

const SERVICE_ACTIONS: ServiceAction[] = [
  "start",
  "stop",
  "restart",
  "enable",
  "disable",
];

export type ServiceInfo = {
  unit: string;
  label: string;
  description: string;
  activeState: string; // active | inactive | failed | activating | deactivating
  subState: string; // running | exited | dead | failed | ...
  unitFileState: string; // enabled | disabled | static | masked | ...
  loadState: string; // loaded | not-found | masked
  running: boolean;
  enabled: boolean;
  canStart: boolean;
  canStop: boolean;
  canEnable: boolean;
  canDisable: boolean;
  self: boolean;
};

export type GeneralSummary = {
  system: {
    hostname: string;
    kernel: string;
    uptimeSec: number;
    load: [number, number, number];
    cpuCount: number;
    mem: { totalBytes: number; availableBytes: number };
    disk: {
      path: string;
      sizeBytes: number;
      usedBytes: number;
      availBytes: number;
      usePct: number;
    } | null;
  };
  minecraft: {
    up: boolean;
    health: string | null;
    startedAt: string | null;
    playersOnline: number | null;
    playersMax: number | null;
    worldBytes: number | null;
  };
  wow: {
    up: boolean;
    health: string | null;
    startedAt: string | null;
    accounts: number | null;
    charactersOnline: number | null;
    dbBytes: number | null;
  };
  sites: { name: string; label: string; active: boolean }[];
  services: ServiceInfo[];
  specs: Specs;
  todos: { key: string; label: string; count: number; href: string }[];
};

/** execFile that never throws: returns trimmed stdout, or stdout even when the
 * command exits non-zero (e.g. `systemctl is-active` with an inactive unit),
 * or null when it truly fails. */
async function run(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 8000 });
    return stdout.trim();
  } catch (err) {
    const stdout = (err as { stdout?: string }).stdout;
    if (typeof stdout === "string" && stdout.trim()) return stdout.trim();
    return null;
  }
}

async function readMem(): Promise<{ totalBytes: number; availableBytes: number }> {
  try {
    const raw = await fs.readFile("/proc/meminfo", "utf8");
    const total = /MemTotal:\s+(\d+)\s+kB/.exec(raw);
    const avail = /MemAvailable:\s+(\d+)\s+kB/.exec(raw);
    if (total && avail) {
      return {
        totalBytes: Number(total[1]) * 1024,
        availableBytes: Number(avail[1]) * 1024,
      };
    }
  } catch {
    // fall through to os.* below
  }
  return { totalBytes: os.totalmem(), availableBytes: os.freemem() };
}

async function readDisk(): Promise<GeneralSummary["system"]["disk"]> {
  const out = await run("df", [
    "-B1",
    "--output=target,size,used,avail,pcent",
    "/",
  ]);
  if (!out) return null;
  const line = out.trim().split("\n").pop() ?? "";
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  return {
    path: parts[0],
    sizeBytes: Number(parts[1]),
    usedBytes: Number(parts[2]),
    availBytes: Number(parts[3]),
    usePct: Number(parts[4].replace("%", "")),
  };
}

async function readSystem(): Promise<GeneralSummary["system"]> {
  const [mem, disk] = await Promise.all([readMem(), readDisk()]);
  const [l1, l5, l15] = os.loadavg();
  return {
    hostname: os.hostname(),
    kernel: os.release(),
    uptimeSec: Math.round(os.uptime()),
    load: [l1, l5, l15],
    cpuCount: os.cpus().length,
    mem,
    disk,
  };
}

type ContainerState = {
  running: boolean;
  startedAt: string | null;
  health: string | null;
};

/** `docker inspect` one or more containers. Health template is guarded because
 * containers without a healthcheck have no .State.Health. */
async function inspectContainers(
  names: string[],
): Promise<Map<string, ContainerState>> {
  const out = await run("docker", [
    "inspect",
    "--format",
    "{{.Name}}|{{.State.Running}}|{{.State.StartedAt}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}",
    ...names,
  ]);
  const map = new Map<string, ContainerState>();
  if (!out) return map;
  for (const line of out.split("\n")) {
    const [name, running, startedAt, health] = line.split("|");
    if (!name) continue;
    map.set(name.replace(/^\//, ""), {
      running: running === "true",
      startedAt: startedAt && startedAt !== "0001-01-01T00:00:00Z" ? startedAt : null,
      health: health || null,
    });
  }
  return map;
}

function parsePlayerList(
  response: string,
): { online: number; max: number } | null {
  const m = /There are (\d+) of a max of (\d+)/.exec(response);
  if (!m) return null;
  return { online: Number(m[1]), max: Number(m[2]) };
}

async function readMinecraft(): Promise<GeneralSummary["minecraft"]> {
  const [state, listOut, du] = await Promise.all([
    inspectContainers([MC_CONTAINER]).then((m) => m.get(MC_CONTAINER) ?? null),
    runRcon(["list"]).catch(() => null),
    run("du", ["-sb", MC_WORLD_DIR]),
  ]);

  const players = listOut ? parsePlayerList(listOut) : null;
  const worldBytes = du ? Number(du.split(/\s+/)[0]) : null;

  return {
    up: state?.running ?? false,
    health: state?.health ?? null,
    startedAt: state?.startedAt ?? null,
    playersOnline: players?.online ?? null,
    playersMax: players?.max ?? null,
    worldBytes: Number.isFinite(worldBytes) ? worldBytes : null,
  };
}

/** One row, tab-separated: accounts, characters online (bots included), bytes. */
async function readWowDb(): Promise<{
  accounts: number | null;
  charactersOnline: number | null;
  dbBytes: number | null;
}> {
  const sql =
    "SELECT " +
    "(SELECT COUNT(*) FROM wotlkrealmd.account), " +
    "(SELECT COUNT(*) FROM wotlkcharacters.characters WHERE online = 1), " +
    "(SELECT COALESCE(SUM(data_length + index_length), 0) FROM information_schema.tables WHERE table_schema LIKE 'wotlk%');";
  const out = await run("docker", [
    "exec",
    "-e",
    `MYSQL_PWD=${WOW_DB_PASSWORD}`,
    WOW_DB_CONTAINER,
    "mariadb",
    "-u",
    WOW_DB_USER,
    "-N",
    "-e",
    sql,
  ]);
  if (!out) return { accounts: null, charactersOnline: null, dbBytes: null };
  const [accounts, online, bytes] = out.trim().split(/\s+/).map(Number);
  return {
    accounts: Number.isFinite(accounts) ? accounts : null,
    charactersOnline: Number.isFinite(online) ? online : null,
    dbBytes: Number.isFinite(bytes) ? bytes : null,
  };
}

function worstHealth(states: ContainerState[]): string | null {
  const values = states.map((s) => s.health).filter(Boolean) as string[];
  if (values.includes("unhealthy")) return "unhealthy";
  if (values.includes("starting")) return "starting";
  if (values.length && values.every((v) => v === "healthy")) return "healthy";
  return values[0] ?? null;
}

async function readWow(): Promise<GeneralSummary["wow"]> {
  const [containers, db] = await Promise.all([
    inspectContainers([WOW_MANGOSD_CONTAINER, WOW_REALMD_CONTAINER]),
    readWowDb(),
  ]);
  const mangosd = containers.get(WOW_MANGOSD_CONTAINER);
  const realmd = containers.get(WOW_REALMD_CONTAINER);
  const present = [mangosd, realmd].filter(Boolean) as ContainerState[];

  const startedAts = present
    .map((s) => s.startedAt)
    .filter(Boolean)
    .sort() as string[];

  return {
    up: present.length > 0 && present.every((s) => s.running),
    health: worstHealth(present),
    startedAt: startedAts[0] ?? null,
    accounts: db.accounts,
    charactersOnline: db.charactersOnline,
    dbBytes: db.dbBytes,
  };
}

async function readSites(): Promise<GeneralSummary["sites"]> {
  // One call: `is-active` prints one line per unit and exits non-zero if any
  // are down, so `run` (which keeps stdout on non-zero exit) still gets them.
  const out = await run("systemctl", [
    "is-active",
    ...SITE_UNITS.map((s) => s.unit),
  ]);
  const lines = out ? out.split("\n") : [];
  return SITE_UNITS.map((site, i) => ({
    name: site.name,
    label: site.label,
    active: lines[i]?.trim() === "active",
  }));
}

function parseShowBlock(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

function toServiceInfo(unit: string, label: string, p: Record<string, string>): ServiceInfo {
  const activeState = p.ActiveState || "unknown";
  const unitFileState = p.UnitFileState || "unknown";
  const loadState = p.LoadState || "unknown";
  const running = activeState === "active";
  const enabled = unitFileState.startsWith("enabled"); // enabled, enabled-runtime
  const exists = loadState === "loaded";
  return {
    unit,
    label,
    description: p.Description && p.Description !== unit ? p.Description : "",
    activeState,
    subState: p.SubState || "",
    unitFileState,
    loadState,
    running,
    enabled,
    // start when it isn't already up; stop only when it is
    canStart: exists && !running && activeState !== "activating",
    canStop: exists && (running || activeState === "activating"),
    // enable/disable only make sense for an installable unit file
    canEnable: exists && unitFileState === "disabled",
    canDisable: exists && enabled,
    self: unit === SELF_UNIT,
  };
}

/** The curated set from MANAGED_UNITS, queried one-shot with `systemctl show`. */
async function readManagedServices(): Promise<ServiceInfo[]> {
  const out = await run("systemctl", [
    "show",
    "--no-pager",
    "--property=Id,Description,LoadState,ActiveState,SubState,UnitFileState",
    ...MANAGED_UNIT_NAMES,
  ]);
  const byId = new Map<string, Record<string, string>>();
  for (const block of (out ?? "").split(/\n\n+/)) {
    if (!block.trim()) continue;
    const props = parseShowBlock(block);
    if (props.Id) byId.set(props.Id, props);
  }
  return MANAGED_UNITS.map(({ unit, label }) =>
    toServiceInfo(unit, label, byId.get(unit) ?? {}),
  );
}

/** Every .service unit on the host: loaded units from `list-units --all`, plus
 * installed-but-not-loaded units from `list-unit-files`. Templates and aliases
 * are dropped (you can't act on them directly). */
async function readAllServices(): Promise<ServiceInfo[]> {
  const [unitsOut, filesOut] = await Promise.all([
    run("systemctl", [
      "list-units",
      "--type=service",
      "--all",
      "--plain",
      "--no-legend",
      "--no-pager",
    ]),
    run("systemctl", [
      "list-unit-files",
      "--type=service",
      "--no-legend",
      "--no-pager",
    ]),
  ]);

  const fileState = new Map<string, string>();
  for (const line of (filesOut ?? "").split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts[0]?.endsWith(".service")) fileState.set(parts[0], parts[1] ?? "");
  }

  const byUnit = new Map<string, ServiceInfo>();

  for (const line of (unitsOut ?? "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 4) continue;
    const [unit, loadState, activeState, subState] = parts;
    if (!unit.endsWith(".service") || unit.endsWith("@.service")) continue;
    byUnit.set(
      unit,
      toServiceInfo(unit, unit.replace(/\.service$/, ""), {
        LoadState: loadState,
        ActiveState: activeState,
        SubState: subState,
        UnitFileState: fileState.get(unit) ?? "",
        Description: parts.slice(4).join(" "),
      }),
    );
  }

  for (const [unit, state] of fileState) {
    if (byUnit.has(unit) || unit.endsWith("@.service")) continue;
    if (state === "alias" || state === "generated" || state === "transient") continue;
    byUnit.set(
      unit,
      toServiceInfo(unit, unit.replace(/\.service$/, ""), {
        LoadState: state.startsWith("masked") ? "masked" : "loaded",
        ActiveState: "inactive",
        SubState: "dead",
        UnitFileState: state,
        Description: "",
      }),
    );
  }

  return [...byUnit.values()].sort((a, b) => a.unit.localeCompare(b.unit));
}

async function readServices(): Promise<ServiceInfo[]> {
  return RESTRICT_TO_MANAGED ? readManagedServices() : readAllServices();
}

/** Run one systemctl action against a service unit. The name is shape-checked
 * (and, when MANAGED_UNITS is set, allowlisted). Actions on this app's own unit
 * that would kill the request are deferred a couple of seconds so the response
 * can flush first. */
export async function runServiceAction(
  unit: string,
  action: string,
): Promise<{ ok: boolean; deferred?: boolean; error?: string; service?: ServiceInfo }> {
  if (typeof unit !== "string" || unit.startsWith("-") || !SERVICE_UNIT_RE.test(unit)) {
    return { ok: false, error: "Invalid service unit name." };
  }
  if (RESTRICT_TO_MANAGED && !MANAGED_UNIT_NAMES.includes(unit)) {
    return { ok: false, error: "Unit is not in MANAGED_UNITS." };
  }
  if (!SERVICE_ACTIONS.includes(action as ServiceAction)) {
    return { ok: false, error: "Unknown action." };
  }

  const killsSelf =
    unit === SELF_UNIT && (action === "stop" || action === "restart");

  try {
    if (killsSelf) {
      await execFileAsync(
        "sudo",
        ["systemd-run", "--on-active=2", "systemctl", action, unit],
        { timeout: 8000 },
      );
      return { ok: true, deferred: true };
    }
    // container-wrapper units (docker compose up/down) can take a while
    await execFileAsync("sudo", ["systemctl", action, unit], {
      timeout: 120000,
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      ok: false,
      error: (e.stderr || e.message || "systemctl failed").trim(),
    };
  }

  const services = await readServices();
  return { ok: true, service: services.find((s) => s.unit === unit) };
}

async function readTodos(): Promise<GeneralSummary["todos"]> {
  const [whitelist, locations] = await Promise.all([
    getPendingWhitelistRequests().catch(() => []),
    getLocationRequests().catch(() => []),
  ]);
  return [
    {
      key: "whitelist",
      label: "whitelist requests",
      count: whitelist.length,
      href: "/mc",
    },
    {
      key: "locations",
      label: "location / map requests",
      count: locations.length,
      href: "/mc",
    },
  ];
}

export async function getGeneralSummary(): Promise<GeneralSummary> {
  const [system, minecraft, wow, sites, services, specs, todos] =
    await Promise.all([
      readSystem(),
      readMinecraft(),
      readWow(),
      readSites(),
      readServices(),
      getSpecs(),
      readTodos(),
    ]);
  return { system, minecraft, wow, sites, services, specs, todos };
}

/* ------------------------------------------------------ perf "Servers" panel */

type ServerDef = {
  key: string;
  label: string;
  /** systemd-managed servers */
  unit?: string;
  /** docker-compose-managed servers (no systemd unit) */
  composeFile?: string;
  /** containers whose memory rolls up into this server's RAM figure */
  containers?: string[];
  /** host process names whose RSS rolls up into this server's RAM figure */
  procNames?: string[];
};

const PERF_SERVERS: ServerDef[] = [
  {
    key: "minecraft",
    label: "Minecraft",
    unit: "minecraft.service",
    containers: ["minecraft"],
  },
  {
    key: "wow",
    label: "WoW",
    unit: "wow.service",
    containers: [
      "wow-wotlk-mangosd-1",
      "wow-wotlk-realmd-1",
      "wow-wotlk-database-1",
    ],
  },
  {
    key: "jellyfin",
    label: "Jellyfin",
    composeFile: "/opt/jellyfin/docker-compose.yml",
    containers: ["jellyfin"],
  },
  {
    key: "nginx",
    label: "Nginx (Websites)",
    unit: "nginx.service",
    procNames: ["nginx"],
  },
  {
    key: "vpn",
    label: "VPN (Mullvad)",
    unit: "vpn.service",
  },
];

export type PerfServer = {
  key: string;
  label: string;
  running: boolean;
  memBytes: number | null;
};

// "123.4MiB" / "1.02GiB" / "512KiB" / "0B" → bytes
function parseDockerMem(raw: string): number {
  const m = /^([\d.]+)\s*([KMGT]?i?B)$/i.exec(raw.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mul: Record<string, number> = {
    b: 1,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
  };
  return n * (mul[m[2].toLowerCase()] ?? 1);
}

async function readProcMemByName(
  names: string[],
): Promise<Map<string, number>> {
  const want = new Set(names);
  const out = new Map<string, number>();
  let pids: string[] = [];
  try {
    pids = await fs.readdir("/proc");
  } catch {
    return out;
  }
  await Promise.all(
    pids.map(async (pid) => {
      if (!/^\d+$/.test(pid)) return;
      let raw: string;
      try {
        raw = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      } catch {
        return;
      }
      const close = raw.lastIndexOf(")");
      if (close < 0) return;
      const comm = raw.slice(raw.indexOf("(") + 1, close);
      if (!want.has(comm)) return;
      const rest = raw.slice(close + 2).split(" ");
      const rssPages = Number(rest[21]); // field 24
      if (Number.isFinite(rssPages)) {
        out.set(comm, (out.get(comm) ?? 0) + rssPages * 4096);
      }
    }),
  );
  return out;
}

export async function getPerfServers(): Promise<PerfServer[]> {
  const units = PERF_SERVERS.map((s) => s.unit).filter(Boolean) as string[];
  const procNames = [
    ...new Set(PERF_SERVERS.flatMap((s) => s.procNames ?? [])),
  ];
  const [activeOut, statsOut, procMem] = await Promise.all([
    units.length ? run("systemctl", ["is-active", ...units]) : Promise.resolve(""),
    run("docker", [
      "stats",
      "--no-stream",
      "--format",
      "{{.Name}}\t{{.MemUsage}}",
    ]),
    procNames.length ? readProcMemByName(procNames) : Promise.resolve(new Map()),
  ]);

  const activeByUnit = new Map<string, string>();
  units.forEach((u, i) =>
    activeByUnit.set(u, ((activeOut ?? "").split("\n")[i] ?? "").trim()),
  );

  const memByContainer = new Map<string, number>();
  const runningContainers = new Set<string>();
  for (const line of (statsOut ?? "").split("\n")) {
    const [name, usage] = line.split("\t");
    if (!name) continue;
    runningContainers.add(name.trim());
    if (usage) {
      memByContainer.set(name.trim(), parseDockerMem(usage.split("/")[0]));
    }
  }

  return PERF_SERVERS.map((s) => {
    const running = s.unit
      ? activeByUnit.get(s.unit) === "active"
      : (s.containers ?? []).some((c) => runningContainers.has(c));
    let memBytes = 0;
    for (const c of s.containers ?? []) memBytes += memByContainer.get(c) ?? 0;
    for (const p of s.procNames ?? []) memBytes += procMem.get(p) ?? 0;
    return { key: s.key, label: s.label, running, memBytes: memBytes || null };
  });
}

export async function runPerfServerAction(
  key: string,
  action: string,
): Promise<{ ok: boolean; error?: string }> {
  const srv = PERF_SERVERS.find((s) => s.key === key);
  if (!srv) return { ok: false, error: "Unknown server." };
  if (action !== "start" && action !== "stop") {
    return { ok: false, error: "Unknown action." };
  }
  if (srv.unit) {
    const r = await runServiceAction(srv.unit, action);
    return { ok: r.ok, error: r.error };
  }
  if (srv.composeFile) {
    const args =
      action === "start"
        ? ["compose", "-f", srv.composeFile, "up", "-d"]
        : ["compose", "-f", srv.composeFile, "stop"];
    try {
      await execFileAsync("docker", args, { timeout: 120000 });
      return { ok: true };
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      return {
        ok: false,
        error: (e.stderr || e.message || "docker compose failed").trim(),
      };
    }
  }
  return { ok: false, error: "Server has no control method." };
}

/* ---------------------------------------------- full process list ("view more") */

export type ProcRow = {
  pid: number;
  name: string;
  cmd: string;
  user: string;
  state: string;
  threads: number;
  cpuPct: number;
  rssBytes: number;
};

const CLK_TCK = 100;
const PAGE_SIZE = 4096;

let uidCache: Map<number, string> | null = null;
async function uidToName(uid: number): Promise<string> {
  if (!uidCache) {
    uidCache = new Map();
    let raw = "";
    try {
      raw = await fs.readFile("/etc/passwd", "utf8");
    } catch {
      /* ignore */
    }
    for (const line of raw.split("\n")) {
      const f = line.split(":");
      if (f.length >= 3) uidCache.set(Number(f[2]), f[0]);
    }
  }
  return uidCache.get(uid) ?? String(uid);
}

type StatSnap = {
  comm: string;
  state: string;
  ticks: number;
  rssPages: number;
  threads: number;
  uid: number;
};

async function scanStat(): Promise<Map<number, StatSnap>> {
  const map = new Map<number, StatSnap>();
  let pids: string[] = [];
  try {
    pids = await fs.readdir("/proc");
  } catch {
    return map;
  }
  await Promise.all(
    pids.map(async (pid) => {
      if (!/^\d+$/.test(pid)) return;
      let raw: string;
      try {
        raw = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      } catch {
        return;
      }
      const close = raw.lastIndexOf(")");
      if (close < 0) return;
      const comm = raw.slice(raw.indexOf("(") + 1, close);
      const rest = raw.slice(close + 2).split(" ");
      const utime = Number(rest[11]);
      const stime = Number(rest[12]);
      if (!Number.isFinite(utime)) return;
      const st = await fs.stat(`/proc/${pid}`).catch(() => null);
      map.set(Number(pid), {
        comm,
        state: rest[0] || "",
        ticks: utime + stime,
        rssPages: Number(rest[21]) || 0,
        threads: Number(rest[17]) || 1,
        uid: st ? st.uid : -1,
      });
    }),
  );
  return map;
}

/** Every process on the host, with a ~300 ms CPU delta. RAM-sorted. */
export async function getProcessList(): Promise<ProcRow[]> {
  const a = await scanStat();
  await new Promise((r) => setTimeout(r, 300));
  const b = await scanStat();

  const rows: ProcRow[] = [];
  await Promise.all(
    [...b.entries()].map(async ([pid, cur]) => {
      const prev = a.get(pid);
      const dTicks = prev ? Math.max(0, cur.ticks - prev.ticks) : 0;
      const cpuPct = (dTicks / CLK_TCK / 0.3) * 100;
      let cmdRaw = "";
      try {
        cmdRaw = await fs.readFile(`/proc/${pid}/cmdline`, "utf8");
      } catch {
        /* ignore */
      }
      const cmd =
        cmdRaw.split("\0").filter(Boolean).join(" ").trim().slice(0, 200) ||
        cur.comm;
      rows.push({
        pid,
        name: cur.comm,
        cmd,
        user: await uidToName(cur.uid),
        state: cur.state,
        threads: cur.threads,
        cpuPct,
        rssBytes: cur.rssPages * PAGE_SIZE,
      });
    }),
  );
  return rows.sort((x, y) => y.rssBytes - x.rssBytes);
}

// byjohnmichael*
