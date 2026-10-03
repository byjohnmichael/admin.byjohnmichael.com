import { promises as fs } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";
import { getSpecs } from "@/lib/specs";
import { readAmdGpus } from "@/lib/amdGpu";

const execFileAsync = promisify(execFile);

const TICK_MS = 1000;
const HISTORY_MAX = 600; // 10 min at 1 Hz
const HISTORY_SEND = 150; // points returned to the client
const CLK_TCK = 100; // sysconf(_SC_CLK_TCK) on Linux
const PAGE_SIZE = 4096;
const SENSORS_EVERY = 3; // ticks between `sensors` calls (temps move slowly)
const CONTAINERS_EVERY = 30; // ticks between `docker ps` refreshes

const NET_IFACE_OVERRIDE = process.env.PERF_NET_IFACE ?? "";
const DISK_DEV_OVERRIDE = process.env.PERF_DISK_DEV ?? "";

// `perf stat -a` (via sudo — needs perf_event_paranoid<=0 otherwise) gives
// instructions / cycles / IPC / migrations. It blocks for the measurement
// window, so it runs on its own slow loop rather than in the 1 Hz tick.
const PERF_ENABLED = process.env.PERF_DISABLE_PERF !== "1";
const PERF_WINDOW_SEC = 1;
const PERF_INTERVAL_MS = 13_000;
const PERF_STALE_MS = 60_000;

/* ------------------------------------------------------------------- types */

type Pressure = { some10: number; some60: number; full10: number };

type RawProc = {
  comm: string;
  cpuTicks: number;
  rssPages: number;
  processor: number;
  state: string;
  threads: number;
  user: string;
  cmd: string;
};

export type GpuInfo = {
  index: number;
  name: string;
  driver: string;
  utilPct: number;
  memUtilPct: number;
  memTotalBytes: number;
  memUsedBytes: number;
  tempC: number | null;
  memTempC: number | null;
  powerDrawW: number | null;
  powerLimitW: number | null;
  fanPct: number | null;
  clockSmMhz: number | null;
  clockMemMhz: number | null;
  clockVideoMhz: number | null;
  clockMaxSmMhz: number | null;
  clockMaxMemMhz: number | null;
  encUtilPct: number | null;
  decUtilPct: number | null;
  encSessions: number | null;
  pcieGenCur: number | null;
  pcieGenMax: number | null;
  pcieWidthCur: number | null;
  pcieWidthMax: number | null;
  vbios: string;
  /** decoded clock-throttle reason ("" when only idle / none) */
  throttle: string;
  pstate: string;
};

// whole-system power estimate: a few measured rails (RAPL) + modelled rest,
// each item carrying a low/high bound; totals rolled up to a wall-socket range
export type PowerItem = {
  key: string;
  label: string;
  tier: "measured" | "estimate" | "guess";
  lo: number;
  hi: number;
};
export type PowerEstimate = {
  items: PowerItem[];
  dcLo: number;
  dcHi: number;
  wallLo: number;
  wallHi: number;
};

const PWR = {
  boardLo: 12,
  boardHi: 28,
  fanCount: Number(process.env.PERF_FAN_COUNT ?? 3),
  fanLoEach: 0.5,
  fanHiEach: 2,
  usbLo: 0,
  usbHi: 6,
  vrmLoFrac: 0.03,
  vrmHiFrac: 0.09,
  psuEffLo: 0.82,
  psuEffHi: 0.92,
  gpuIdleW: 7,
};

type DiskRaw = {
  readsCompleted: number;
  sectorsRead: number;
  msReading: number;
  writesCompleted: number;
  sectorsWritten: number;
  msWriting: number;
  iosInProgress: number;
  msDoingIo: number;
};

// NVMe SMART health, from `nvme smart-log`
type NvmeSmart = {
  healthPct: number | null; // 100 − percent_used
  sparePct: number | null; // available spare %
  tbwBytes: number | null; // lifetime bytes written (data_units_written)
  powerOnHours: number | null;
};

type Raw = {
  t: number;
  cpuAgg: CpuTimes;
  cpuThreads: { total: number; idle: number }[];
  ctxt: number;
  procsRunning: number;
  forks: number;
  boost: boolean | null;
  energyUj: number | null;
  dramEnergyUj: number | null;
  freqsMhz: number[];
  mem: Record<string, number>; // kB
  load: { load: [number, number, number]; running: number; total: number };
  uptimeSec: number;
  psi: { cpu: Pressure; memory: Pressure; io: Pressure };
  fdNr: { open: number; max: number } | null;
  /** per physical block device, keyed by kernel name (nvme0n1, sda, …) */
  disks: Record<string, DiskRaw>;
  /** summed filesystem usage per physical device (mounted partitions only) */
  fsByDev: Record<string, { usedBytes: number; sizeBytes: number }>;
  /** drive temperature per device from hwmon (nvme / drivetemp); null = none */
  driveTemps: Record<string, number | null>;
  /** NVMe SMART health per device (empty for non-NVMe / no nvme-cli) */
  nvmeSmart: Record<string, NvmeSmart>;
  net: { rxBytes: number; txBytes: number } | null;
  temp: {
    packageC: number | null;
    coresC: number[];
    critC: number | null;
    nvmeC: number | null;
    /** per-DIMM temps in slot order (jc42 0x18→0, 0x19→1, …); null = no sensor */
    dimmC: (number | null)[];
  };
  procs: Map<number, RawProc>;
  containers: { name: string; usageUsec: number; memBytes: number }[];
  gpu: GpuInfo[];
};

export type CpuLane = {
  id: number;
  pct: number;
  freqMhz: number | null;
  tempC: number | null;
  topProc: string | null;
};

export type PerfSnapshot = {
  t: number;
  cpu: {
    overall: number;
    freqAvgMhz: number;
    freqMaxMhz: number;
    freqMinMhz: number | null;
    boost: boolean | null;
    perCore: (CpuLane & { threadIds: number[] })[];
    perThread: CpuLane[];
    util: {
      user: number;
      nice: number;
      system: number;
      idle: number;
      iowait: number;
      irq: number;
      softirq: number;
      steal: number;
    };
    ctxSwitchesPerSec: number;
    migrationsPerSec: number | null;
    ipsPerSec: number | null;
    cyclesPerSec: number | null;
    ipc: number | null;
    runQueue: number;
    packageWatts: number | null;
  };
  load: { load: [number, number, number]; running: number; total: number };
  uptimeSec: number;
  psi: { cpu: Pressure; memory: Pressure; io: Pressure };
  sys: {
    procCount: number;
    threadCount: number;
    running: number;
    zombies: number;
    forksPerSec: number;
    fdOpen: number | null;
    fdMax: number | null;
  };
  mem: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    cacheBytes: number;
    usedPct: number;
    swapUsedBytes: number;
    swapTotalBytes: number;
    committedBytes: number;
    commitLimitBytes: number;
    powerWatts: number | null;
  };
  /** machine-wide aggregate across every physical drive */
  disk: {
    readBps: number;
    writeBps: number;
    readIops: number;
    writeIops: number;
    utilPct: number;
    awaitMs: number;
    queue: number;
    tempC: number | null;
  } | null;
  /** one row per physical drive */
  disks: {
    dev: string;
    model: string;
    capacityBytes: number;
    fsUsedBytes: number;
    fsSizeBytes: number;
    readBps: number;
    writeBps: number;
    readIops: number;
    writeIops: number;
    utilPct: number;
    awaitMs: number;
    queue: number;
    tempC: number | null;
    rotational: boolean;
    healthPct: number | null;
    sparePct: number | null;
    tbwBytes: number | null;
    powerOnHours: number | null;
  }[];
  net: {
    rxBps: number;
    txBps: number;
    rxTotalBytes: number;
    txTotalBytes: number;
  } | null;
  temp: {
    packageC: number | null;
    coresC: number[];
    critC: number | null;
    nvmeC: number | null;
    /** per-DIMM temps in slot order (jc42 0x18→0, 0x19→1, …); null = no sensor */
    dimmC: (number | null)[];
  };
  procs: {
    pid: number;
    name: string;
    cmd: string;
    user: string;
    state: string;
    threads: number;
    cpuPct: number;
    rssBytes: number;
  }[];
  services: { name: string; cpuPct: number; memBytes: number }[];
  gpu: GpuInfo[];
  power: PowerEstimate;
};

type Meta = {
  cpuModel: string;
  logical: number;
  /** logical-cpu index -> physical-core slot (0-based, dense) */
  coreOfThread: number[];
  physicalCores: number;
  disk: { name: string; capacityBytes: number; dev: string } | null;
  disks: {
    dev: string;
    model: string;
    capacityBytes: number;
    rotational: boolean;
    bus: string;
  }[];
  net: { iface: string; speedMbps: number | null } | null;
  os: import("@/lib/specs").Specs["os"] | null;
  cpuSpec: import("@/lib/specs").Specs["cpu"] | null;
  memSpec: import("@/lib/specs").Specs["memory"] | null;
  raplMaxUj: number | null;
  raplDramMaxUj: number | null;
};

type PerfCounters = {
  ipsPerSec: number | null;
  cyclesPerSec: number | null;
  ipc: number | null;
  migrationsPerSec: number | null;
  ts: number;
};

type SamplerState = {
  history: PerfSnapshot[];
  prev: Raw | null;
  containerDirs: { name: string; dir: string }[];
  sensorsCache: Raw["temp"] | null;
  fsCache: Record<string, { usedBytes: number; sizeBytes: number }> | null;
  driveTempCache: Record<string, number | null> | null;
  smartCache: Record<string, NvmeSmart> | null;
  gpuCache: GpuInfo[] | null;
  boostCache: boolean | null;
  perfCounters: PerfCounters | null;
  perfLoopRunning: boolean;
  meta: Meta | null;
  tick: number;
  timer: ReturnType<typeof setInterval> | null;
  priming: Promise<void> | null;
  lastError: string | null;
  busy: boolean;
};

/* --------------------------------------------------- process-wide singleton */

const GLOBAL_KEY = "__adminPerfSampler__";
const store = globalThis as unknown as Record<string, SamplerState | undefined>;
const state: SamplerState =
  store[GLOBAL_KEY] ??
  (store[GLOBAL_KEY] = {
    history: [],
    prev: null,
    containerDirs: [],
    sensorsCache: null,
    fsCache: null,
    driveTempCache: null,
    smartCache: null,
    gpuCache: null,
    boostCache: null,
    perfCounters: null,
    perfLoopRunning: false,
    meta: null,
    tick: 0,
    timer: null,
    priming: null,
    lastError: null,
    busy: false,
  });

/* ------------------------------------------------------------ small helpers */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

function parsePressure(block: string | null): Pressure {
  const empty = { some10: 0, some60: 0, full10: 0 };
  if (!block) return empty;
  const some = /some\s+avg10=([\d.]+)\s+avg60=([\d.]+)/.exec(block);
  const full = /full\s+avg10=([\d.]+)/.exec(block);
  return {
    some10: some ? Number(some[1]) : 0,
    some60: some ? Number(some[2]) : 0,
    full10: full ? Number(full[1]) : 0,
  };
}

/* -------------------------------------------------------------- raw readers */

type CpuTimes = {
  user: number;
  nice: number;
  system: number;
  idle: number;
  iowait: number;
  irq: number;
  softirq: number;
  steal: number;
  total: number;
};

function parseCpuTimes(fields: number[]): CpuTimes {
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] =
    fields;
  return {
    user,
    nice,
    system,
    idle,
    iowait,
    irq,
    softirq,
    steal,
    total: fields.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0),
  };
}

async function readProcStat() {
  const raw = (await readText("/proc/stat")) ?? "";
  let agg = parseCpuTimes([]);
  const threads: { total: number; idle: number }[] = [];
  let ctxt = 0;
  let procsRunning = 0;
  let forks = 0;
  for (const line of raw.split("\n")) {
    const m = /^cpu(\d*)\s+(.*)$/.exec(line);
    if (m) {
      const nums = m[2].trim().split(/\s+/).map(Number);
      if (m[1] === "") {
        agg = parseCpuTimes(nums);
      } else {
        const t = parseCpuTimes(nums);
        threads[Number(m[1])] = { total: t.total, idle: t.idle + t.iowait };
      }
      continue;
    }
    if (line.startsWith("ctxt ")) ctxt = Number(line.slice(5).trim());
    else if (line.startsWith("procs_running "))
      procsRunning = Number(line.slice(14).trim());
    else if (line.startsWith("processes "))
      forks = Number(line.slice(10).trim());
  }
  return { agg, threads: threads.filter(Boolean), ctxt, procsRunning, forks };
}

async function readCpuFreqs(logical: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < logical; i++) {
    const v = await readText(
      `/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`,
    );
    if (v) out.push(Number(v.trim()) / 1000);
  }
  if (out.length) return out;
  const info = (await readText("/proc/cpuinfo")) ?? "";
  for (const m of info.matchAll(/cpu MHz\s*:\s*([\d.]+)/g)) out.push(Number(m[1]));
  return out;
}

async function readMeminfo(): Promise<Record<string, number>> {
  const raw = (await readText("/proc/meminfo")) ?? "";
  const map: Record<string, number> = {};
  for (const line of raw.split("\n")) {
    const m = /^(\w+):\s+(\d+)/.exec(line);
    if (m) map[m[1]] = Number(m[2]); // kB
  }
  return map;
}

async function readLoadavg() {
  const raw = ((await readText("/proc/loadavg")) ?? "0 0 0 0/0 0").trim().split(/\s+/);
  const [running, total] = (raw[3] ?? "0/0").split("/").map(Number);
  return {
    load: [Number(raw[0]), Number(raw[1]), Number(raw[2])] as [number, number, number],
    running: running || 0,
    total: total || 0,
  };
}

async function readUptime(): Promise<number> {
  const raw = (await readText("/proc/uptime")) ?? "0";
  return Number(raw.trim().split(/\s+/)[0]) || 0;
}

async function readFileNr(): Promise<Raw["fdNr"]> {
  const raw = await readText("/proc/sys/fs/file-nr");
  if (!raw) return null;
  const [open, , max] = raw.trim().split(/\s+/).map(Number);
  return Number.isFinite(open) && Number.isFinite(max) ? { open, max } : null;
}

async function readPsi() {
  return {
    cpu: parsePressure(await readText("/proc/pressure/cpu")),
    memory: parsePressure(await readText("/proc/pressure/memory")),
    io: parsePressure(await readText("/proc/pressure/io")),
  };
}

async function detectDiskDevs(): Promise<string[]> {
  if (DISK_DEV_OVERRIDE) {
    return DISK_DEV_OVERRIDE.split(",").map((s) => s.trim()).filter(Boolean);
  }
  try {
    const entries = await fs.readdir("/sys/block");
    return entries
      .filter((e) => !/^(loop|ram|zram|dm-|md|sr|fd)/.test(e))
      .sort();
  } catch {
    return ["nvme0n1"];
  }
}

async function readAllDiskstats(
  devs: string[],
): Promise<Record<string, DiskRaw>> {
  const want = new Set(devs);
  const out: Record<string, DiskRaw> = {};
  const raw = (await readText("/proc/diskstats")) ?? "";
  for (const line of raw.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (!want.has(f[2])) continue;
    const n = f.slice(3).map(Number);
    out[f[2]] = {
      readsCompleted: n[0],
      sectorsRead: n[2],
      msReading: n[3],
      writesCompleted: n[4],
      sectorsWritten: n[6],
      msWriting: n[7],
      iosInProgress: n[8],
      msDoingIo: n[9],
    };
  }
  return out;
}

// "nvme0n1p3" -> "nvme0n1", "sda1" -> "sda"; whole-disk mounts pass through
function parentDisk(part: string): string {
  if (/^nvme\d+n\d+p\d+$/.test(part)) return part.replace(/p\d+$/, "");
  if (/^(sd|vd|hd|xvd)[a-z]+\d+$/.test(part)) return part.replace(/\d+$/, "");
  return part;
}

// filesystem bytes used / total, summed per physical device across its mounted
// partitions. A drive has no OS-level "used" of its own — this is the closest
// honest proxy for how full it is.
async function readFsUsage(
  devs: string[],
): Promise<Record<string, { usedBytes: number; sizeBytes: number }>> {
  const set = new Set(devs);
  const acc: Record<string, { usedBytes: number; sizeBytes: number }> = {};
  const mounts = (await readText("/proc/mounts")) ?? "";
  const seen = new Set<string>();
  for (const line of mounts.split("\n")) {
    const parts = line.split(" ");
    if (parts.length < 3) continue;
    const src = parts[0];
    const fstype = parts[2];
    if (!src.startsWith("/dev/")) continue;
    if (/^(squashfs|overlay|iso9660)$/.test(fstype)) continue;
    if (seen.has(src)) continue;
    const name = src.slice(5);
    if (name.startsWith("mapper/")) continue;
    const parent = parentDisk(name);
    if (!set.has(parent)) continue;
    const mnt = parts[1].replace(/\\(\d{3})/g, (_, o: string) =>
      String.fromCharCode(parseInt(o, 8)),
    );
    try {
      const st = await fs.statfs(mnt);
      const bsize = Number(st.bsize);
      const size = Number(st.blocks) * bsize;
      const used = (Number(st.blocks) - Number(st.bfree)) * bsize;
      const cur = acc[parent] ?? { usedBytes: 0, sizeBytes: 0 };
      cur.usedBytes += used;
      cur.sizeBytes += size;
      acc[parent] = cur;
      seen.add(src);
    } catch {
      // not mounted / not readable — skip this filesystem
    }
  }
  return acc;
}

// per-drive temperature via hwmon: the "nvme" / "drivetemp" classes expose a
// `device` symlink back to the controller, whose basename (e.g. "nvme0") maps
// to its block devices ("nvme0n1", …).
async function readDriveTemps(
  devs: string[],
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  let hwmons: string[];
  try {
    hwmons = await fs.readdir("/sys/class/hwmon");
  } catch {
    return out;
  }
  for (const h of hwmons) {
    const base = `/sys/class/hwmon/${h}`;
    const name = (await readText(`${base}/name`))?.trim();
    if (name !== "nvme" && name !== "drivetemp") continue;
    let ctrl = "";
    try {
      ctrl = path.basename(await fs.realpath(`${base}/device`));
    } catch {
      continue;
    }
    let temp: number | null = null;
    for (let i = 1; i <= 8; i++) {
      const val = await readText(`${base}/temp${i}_input`);
      if (val == null) continue;
      const c = Number(val.trim()) / 1000;
      if (!Number.isFinite(c)) continue;
      const lbl = (await readText(`${base}/temp${i}_label`))?.trim();
      if (lbl === "Composite" || (temp == null && i === 1)) temp = c;
    }
    if (temp == null) continue;
    for (const dev of devs) {
      if (name === "nvme" && dev.startsWith(`${ctrl}n`)) out[dev] = temp;
      else if (name === "drivetemp" && dev === ctrl) out[dev] = temp;
    }
  }
  return out;
}

const NVME_SMART_EMPTY: NvmeSmart = {
  healthPct: null,
  sparePct: null,
  tbwBytes: null,
  powerOnHours: null,
};

// `nvme smart-log -o json` (needs root, so via sudo). data_units_written is in
// units of 1000 × 512 B per the NVMe spec.
async function readNvmeSmart(dev: string): Promise<NvmeSmart> {
  if (!dev.startsWith("nvme")) return NVME_SMART_EMPTY;
  try {
    const { stdout } = await execFileAsync(
      "sudo",
      ["nvme", "smart-log", `/dev/${dev}`, "-o", "json"],
      { timeout: 5000 },
    );
    const d = JSON.parse(stdout) as Record<string, number>;
    const used = Number(d.percent_used);
    const spare = Number(d.avail_spare);
    const duw = Number(d.data_units_written);
    const poh = Number(d.power_on_hours);
    return {
      healthPct: Number.isFinite(used)
        ? Math.max(0, Math.min(100, 100 - used))
        : null,
      sparePct: Number.isFinite(spare) ? spare : null,
      tbwBytes: Number.isFinite(duw) ? duw * 512_000 : null,
      powerOnHours: Number.isFinite(poh) ? poh : null,
    };
  } catch {
    return NVME_SMART_EMPTY;
  }
}

async function readAllNvmeSmart(
  devs: string[],
): Promise<Record<string, NvmeSmart>> {
  const out: Record<string, NvmeSmart> = {};
  await Promise.all(
    devs.map(async (dev) => {
      out[dev] = await readNvmeSmart(dev);
    }),
  );
  return out;
}

async function detectNetIface(): Promise<string | null> {
  if (NET_IFACE_OVERRIDE) return NET_IFACE_OVERRIDE;
  try {
    const entries = await fs.readdir("/sys/class/net");
    const candidates = entries.filter(
      (e) => !/^(lo|docker|veth|br-|virbr|tap|tun)/.test(e),
    );
    let best: { iface: string; rx: number } | null = null;
    for (const iface of candidates) {
      const state = (
        await readText(`/sys/class/net/${iface}/operstate`)
      )?.trim();
      if (state !== "up") continue;
      const stats = await readText(`/sys/class/net/${iface}/statistics/rx_bytes`);
      const rx = stats ? Number(stats.trim()) : 0;
      if (!best || rx > best.rx) best = { iface, rx };
    }
    return best?.iface ?? candidates[0] ?? null;
  } catch {
    return null;
  }
}

async function readNetDev(iface: string): Promise<Raw["net"]> {
  const raw = (await readText("/proc/net/dev")) ?? "";
  for (const line of raw.split("\n")) {
    const m = new RegExp(`^\\s*${iface}:\\s*(.*)$`).exec(line);
    if (!m) continue;
    const n = m[1].trim().split(/\s+/).map(Number);
    return { rxBytes: n[0], txBytes: n[8] };
  }
  return null;
}

async function readSensors(): Promise<Raw["temp"]> {
  const fallback = {
    packageC: null,
    coresC: [],
    critC: null,
    nvmeC: null,
    dimmC: [] as (number | null)[],
  };
  try {
    const { stdout } = await execFileAsync("sensors", ["-j"], { timeout: 4000 });
    const data = JSON.parse(stdout) as Record<
      string,
      Record<string, Record<string, number>>
    >;
    const core = Object.entries(data).find(([k]) => k.startsWith("coretemp"));
    let packageC: number | null = null;
    let critC: number | null = null;
    const coresC: number[] = [];
    if (core) {
      for (const [label, vals] of Object.entries(core[1])) {
        const input = Object.entries(vals).find(([k]) => k.endsWith("_input"));
        if (!input) continue;
        if (/package/i.test(label)) {
          packageC = input[1];
          const crit = Object.entries(vals).find(([k]) => k.endsWith("_crit"));
          if (crit) critC = crit[1];
        } else if (/^Core /i.test(label)) {
          coresC.push(input[1]);
        }
      }
    }
    let nvmeC: number | null = null;
    const nvme = Object.entries(data).find(([k]) => k.startsWith("nvme"));
    if (nvme) {
      const comp = nvme[1]["Composite"] ?? Object.values(nvme[1])[0];
      const input = comp && Object.entries(comp).find(([k]) => k.endsWith("_input"));
      if (input) nvmeC = input[1];
    }

    // per-DIMM thermal sensors: adapter key "jc42-i2c-<bus>-<addr hex>",
    // addresses 0x18..0x1f map to DIMM slots 0..7
    const dimmC: (number | null)[] = [];
    for (const [key, vals] of Object.entries(data)) {
      const m = /^(?:jc42|spd5118)-i2c-\d+-([0-9a-fA-F]{2})$/.exec(key);
      if (!m) continue;
      const idx = parseInt(m[1], 16) - 0x18;
      if (idx < 0 || idx > 15) continue;
      const sub = Object.values(vals).find(
        (v) => v && typeof v === "object",
      ) as Record<string, number> | undefined;
      const input =
        sub && Object.entries(sub).find(([k]) => k.endsWith("_input"));
      if (input) dimmC[idx] = input[1];
    }
    for (let i = 0; i < dimmC.length; i++) if (dimmC[i] === undefined) dimmC[i] = null;

    return { packageC, coresC, critC, nvmeC, dimmC };
  } catch {
    return fallback;
  }
}

// Intel RAPL package-power domain. energy_uj is root-only on modern kernels,
// so it's read via sudo; delta µJ / delta time = package watts.
const RAPL_PATH =
  process.env.PERF_RAPL_PATH ?? "/sys/class/powercap/intel-rapl:0";

async function readEnergyUj(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "sudo",
      ["cat", `${RAPL_PATH}/energy_uj`],
      { timeout: 3000 },
    );
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// The DRAM RAPL domain is a sub-zone of the package (intel-rapl:0:N whose
// `name` is "dram"). Its index isn't fixed, so it's resolved once at startup.
let raplDramPath: string | null = null;

async function resolveDramRaplPath(): Promise<string | null> {
  const override = process.env.PERF_RAPL_DRAM_PATH;
  if (override) return override;
  for (let i = 0; i < 8; i++) {
    const dir = `${RAPL_PATH}:${i}`;
    try {
      const { stdout } = await execFileAsync("cat", [`${dir}/name`], {
        timeout: 2000,
      });
      if (stdout.trim() === "dram") return dir;
    } catch {
      // zone missing — keep scanning
    }
  }
  return null;
}

async function readDramEnergyUj(): Promise<number | null> {
  if (!raplDramPath) return null;
  try {
    const { stdout } = await execFileAsync(
      "sudo",
      ["cat", `${raplDramPath}/energy_uj`],
      { timeout: 3000 },
    );
    const n = Number(stdout.trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

const NVIDIA_SMI = process.env.PERF_NVIDIA_SMI ?? "nvidia-smi";
const GPU_QUERY = [
  "index",
  "name",
  "driver_version",
  "utilization.gpu",
  "utilization.memory",
  "memory.total",
  "memory.used",
  "temperature.gpu",
  "power.draw",
  "power.limit",
  "fan.speed",
  "clocks.sm",
  "clocks.mem",
  "pstate",
  "temperature.memory",
  "utilization.encoder",
  "utilization.decoder",
  "encoder.stats.sessionCount",
  "clocks.max.sm",
  "clocks.max.memory",
  "clocks.video",
  "pcie.link.gen.current",
  "pcie.link.gen.max",
  "pcie.link.width.current",
  "pcie.link.width.max",
  "vbios_version",
  "clocks_event_reasons.active",
].join(",");

// clocks_event_reasons.active bitmask → short human reason (idle alone = none)
function decodeThrottle(hex: string): string {
  const n = Number.parseInt(hex, 16);
  if (!Number.isFinite(n)) return "";
  const on: string[] = [];
  if (n & 0x40) on.push("HW thermal");
  else if (n & 0x20) on.push("SW thermal");
  if (n & 0x80) on.push("power brake");
  else if (n & 0x04) on.push("power cap");
  if (n & 0x08) on.push("HW slowdown");
  return on.join(" · ");
}

/** Every GPU: NVIDIA cards via nvidia-smi, then AMD cards via amdgpu sysfs. */
async function readGpu(): Promise<GpuInfo[]> {
  const nvidia = await readNvidiaGpus();
  return [...nvidia, ...(await readAmdGpus(nvidia.length))];
}

/** NVIDIA GPUs via `nvidia-smi`. Returns [] when there's no tool or no card;
 * fields the card doesn't report (e.g. power draw on a GTX 1050 Ti) come back
 * as null. */
async function readNvidiaGpus(): Promise<GpuInfo[]> {
  try {
    const { stdout } = await execFileAsync(
      NVIDIA_SMI,
      [`--query-gpu=${GPU_QUERY}`, "--format=csv,noheader,nounits"],
      { timeout: 4000 },
    );
    const toNum = (s: string) => {
      const v = parseFloat(s);
      return Number.isFinite(v) ? v : null;
    };
    const MiB = 1024 * 1024;
    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const c = line.split(",").map((x) => x.trim());
        return {
          index: toNum(c[0]) ?? 0,
          name: c[1] || "GPU",
          driver: c[2] || "",
          utilPct: toNum(c[3]) ?? 0,
          memUtilPct: toNum(c[4]) ?? 0,
          memTotalBytes: (toNum(c[5]) ?? 0) * MiB,
          memUsedBytes: (toNum(c[6]) ?? 0) * MiB,
          tempC: toNum(c[7]),
          powerDrawW: toNum(c[8]),
          powerLimitW: toNum(c[9]),
          fanPct: toNum(c[10]),
          clockSmMhz: toNum(c[11]),
          clockMemMhz: toNum(c[12]),
          pstate: c[13] || "",
          memTempC: toNum(c[14]),
          encUtilPct: toNum(c[15]),
          decUtilPct: toNum(c[16]),
          encSessions: toNum(c[17]),
          clockMaxSmMhz: toNum(c[18]),
          clockMaxMemMhz: toNum(c[19]),
          clockVideoMhz: toNum(c[20]),
          pcieGenCur: toNum(c[21]),
          pcieGenMax: toNum(c[22]),
          pcieWidthCur: toNum(c[23]),
          pcieWidthMax: toNum(c[24]),
          vbios: c[25] || "",
          throttle: decodeThrottle(c[26] || "0"),
        };
      });
  } catch {
    return [];
  }
}

// uid → login name, from /etc/passwd (built once; users don't change at runtime)
let passwdCache: Map<number, string> | null = null;
async function uidName(uid: number): Promise<string> {
  if (!passwdCache) {
    passwdCache = new Map();
    const raw = (await readText("/etc/passwd")) ?? "";
    for (const line of raw.split("\n")) {
      const f = line.split(":");
      if (f.length >= 3) passwdCache.set(Number(f[2]), f[0]);
    }
  }
  return passwdCache.get(uid) ?? String(uid);
}

async function readProcesses(): Promise<Map<number, RawProc>> {
  const map = new Map<number, RawProc>();
  let pids: string[];
  try {
    pids = await fs.readdir("/proc");
  } catch {
    return map;
  }
  await Promise.all(
    pids.map(async (pid) => {
      if (!/^\d+$/.test(pid)) return;
      const [raw, cmdRaw, st] = await Promise.all([
        readText(`/proc/${pid}/stat`),
        readText(`/proc/${pid}/cmdline`),
        fs.stat(`/proc/${pid}`).catch(() => null),
      ]);
      if (!raw) return;
      const user = st ? await uidName(st.uid) : "?";
      const close = raw.lastIndexOf(")");
      if (close < 0) return;
      const comm = raw.slice(raw.indexOf("(") + 1, close);
      const rest = raw.slice(close + 2).split(" ");
      // rest[0] is field 3 (state); field N -> rest[N - 3]
      const utime = Number(rest[11]);
      const stime = Number(rest[12]);
      const rssPages = Number(rest[21]);
      const processor = Number(rest[36]); // field 39: last CPU the task ran on
      if (!Number.isFinite(utime)) return;
      const cmd = (cmdRaw ?? "")
        .split("\0")
        .filter(Boolean)
        .join(" ")
        .trim()
        .slice(0, 200);
      map.set(Number(pid), {
        comm,
        cpuTicks: utime + stime,
        rssPages,
        processor: Number.isFinite(processor) ? processor : -1,
        state: rest[0] || "", // field 3
        threads: Number(rest[17]) || 1, // field 20: num_threads
        user,
        cmd: cmd || comm,
      });
    }),
  );
  return map;
}

async function refreshContainerDirs(): Promise<void> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["ps", "--no-trunc", "--format", "{{.ID}}\t{{.Names}}"],
      { timeout: 5000 },
    );
    const dirs: { name: string; dir: string }[] = [];
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const [id, name] = line.split("\t");
      dirs.push({
        name,
        dir: `/sys/fs/cgroup/system.slice/docker-${id}.scope`,
      });
    }
    state.containerDirs = dirs;
  } catch {
    // keep the previous list
  }
}

async function readContainers(): Promise<Raw["containers"]> {
  return Promise.all(
    state.containerDirs.map(async (c) => {
      const [cpuStat, mem] = await Promise.all([
        readText(path.join(c.dir, "cpu.stat")),
        readText(path.join(c.dir, "memory.current")),
      ]);
      const usage = cpuStat && /usage_usec\s+(\d+)/.exec(cpuStat);
      return {
        name: c.name,
        usageUsec: usage ? Number(usage[1]) : 0,
        memBytes: mem ? Number(mem.trim()) : 0,
      };
    }),
  );
}

/* --------------------------------------------------------------- meta (1x) */

async function runPerfOnce(): Promise<PerfCounters | null> {
  try {
    const { stderr } = await execFileAsync(
      "sudo",
      [
        "perf",
        "stat",
        "-a",
        "--no-big-num",
        "-e",
        "instructions,cycles,migrations",
        "--",
        "sleep",
        String(PERF_WINDOW_SEC),
      ],
      { timeout: 8000 },
    );
    const num = (re: RegExp) => {
      const m = re.exec(stderr);
      return m ? Number(m[1]) : null;
    };
    const instructions = num(/^\s*([\d]+)\s+instructions\b/m);
    const cycles = num(/^\s*([\d]+)\s+cycles\b/m);
    const migrations = num(/^\s*([\d]+)\s+migrations\b/m);
    const elapsed = num(/([\d.]+)\s+seconds time elapsed/) || PERF_WINDOW_SEC;
    if (instructions == null && cycles == null) return null;
    return {
      ipsPerSec: instructions != null ? instructions / elapsed : null,
      cyclesPerSec: cycles != null ? cycles / elapsed : null,
      ipc: instructions != null && cycles ? instructions / cycles : null,
      migrationsPerSec: migrations != null ? migrations / elapsed : null,
      ts: Date.now(),
    };
  } catch {
    return null;
  }
}

function startPerfLoop(): void {
  if (!PERF_ENABLED || state.perfLoopRunning) return;
  state.perfLoopRunning = true;
  void (async () => {
    while (state.perfLoopRunning) {
      const r = await runPerfOnce();
      if (r) state.perfCounters = r;
      else if (!state.perfCounters) {
        // perf unusable (not installed / paranoid) — stop retrying
        state.perfLoopRunning = false;
        return;
      }
      await sleep(PERF_INTERVAL_MS);
    }
  })();
}

async function readBoost(): Promise<boolean | null> {
  const b = await readText("/sys/devices/system/cpu/cpufreq/boost");
  if (b) return b.trim() === "1";
  const noTurbo = await readText(
    "/sys/devices/system/cpu/intel_pstate/no_turbo",
  );
  if (noTurbo) return noTurbo.trim() === "0";
  return null;
}

/** Map each logical CPU to a dense physical-core slot via sysfs topology. */
async function readTopology(logical: number): Promise<number[]> {
  const coreIds: number[] = [];
  for (let i = 0; i < logical; i++) {
    const v = await readText(
      `/sys/devices/system/cpu/cpu${i}/topology/core_id`,
    );
    coreIds[i] = v ? Number(v.trim()) : i;
  }
  const unique = [...new Set(coreIds)].sort((a, b) => a - b);
  const slot = new Map(unique.map((id, idx) => [id, idx]));
  return coreIds.map((id) => slot.get(id) ?? 0);
}

async function buildMeta(): Promise<Meta> {
  const cpus = os.cpus();
  const logical = cpus.length;
  const devs = await detectDiskDevs();
  const [diskInfos, coreOfThread, specs] = await Promise.all([
    Promise.all(
      devs.map(async (dev) => {
        const [sizeRaw, modelRaw, rotaRaw] = await Promise.all([
          readText(`/sys/block/${dev}/size`),
          readText(`/sys/block/${dev}/device/model`),
          readText(`/sys/block/${dev}/queue/rotational`),
        ]);
        return {
          dev,
          model: modelRaw?.trim() || dev,
          capacityBytes: sizeRaw ? Number(sizeRaw.trim()) * 512 : 0,
          rotational: rotaRaw?.trim() === "1",
          bus: dev.startsWith("nvme") ? "NVMe" : "SATA",
        };
      }),
    ),
    readTopology(logical),
    getSpecs().catch(() => null),
  ]);
  const diskDrives = diskInfos.filter((d) => d.capacityBytes > 0);
  const primaryDisk = diskDrives[0] ?? null;
  const iface = await detectNetIface();
  const speedRaw = iface
    ? await readText(`/sys/class/net/${iface}/speed`)
    : null;

  let raplMaxUj: number | null = null;
  try {
    const { stdout } = await execFileAsync(
      "sudo",
      ["cat", `${RAPL_PATH}/max_energy_range_uj`],
      { timeout: 3000 },
    );
    raplMaxUj = Number(stdout.trim()) || null;
  } catch {
    // no RAPL — power just won't be reported
  }

  raplDramPath = await resolveDramRaplPath();
  let raplDramMaxUj: number | null = null;
  if (raplDramPath) {
    try {
      const { stdout } = await execFileAsync(
        "sudo",
        ["cat", `${raplDramPath}/max_energy_range_uj`],
        { timeout: 3000 },
      );
      raplDramMaxUj = Number(stdout.trim()) || null;
    } catch {
      // dram zone present but unreadable — leave power unreported
    }
  }

  return {
    cpuModel: specs?.cpu.model || cpus[0]?.model?.trim() || "CPU",
    os: specs?.os ?? null,
    logical,
    coreOfThread,
    physicalCores: new Set(coreOfThread).size,
    raplMaxUj,
    raplDramMaxUj,
    disk: primaryDisk
      ? {
          dev: primaryDisk.dev,
          name: primaryDisk.model,
          capacityBytes: primaryDisk.capacityBytes,
        }
      : null,
    disks: diskDrives,
    net: iface
      ? { iface, speedMbps: speedRaw ? Number(speedRaw.trim()) : null }
      : null,
    cpuSpec: specs?.cpu ?? null,
    memSpec: specs?.memory ?? null,
  };
}

/* --------------------------------------------------------------- one tick  */

async function readRaw(): Promise<Raw> {
  const logical = state.meta?.logical ?? os.cpus().length;
  const takeSlow = state.tick % SENSORS_EVERY === 0 || !state.sensorsCache;
  const diskDevs = state.meta?.disks.map((d) => d.dev) ?? [];

  const [
    stat,
    freqsMhz,
    mem,
    load,
    uptimeSec,
    psi,
    fdNr,
    disks,
    fsByDev,
    driveTemps,
    nvmeSmart,
    net,
    temp,
    gpu,
    boost,
    energyUj,
    dramEnergyUj,
    procs,
    containers,
  ] = await Promise.all([
    readProcStat(),
    readCpuFreqs(logical),
    readMeminfo(),
    readLoadavg(),
    readUptime(),
    readPsi(),
    readFileNr(),
    diskDevs.length ? readAllDiskstats(diskDevs) : Promise.resolve({}),
    diskDevs.length && (takeSlow || !state.fsCache)
      ? readFsUsage(diskDevs)
      : Promise.resolve(state.fsCache ?? {}),
    diskDevs.length && (takeSlow || !state.driveTempCache)
      ? readDriveTemps(diskDevs)
      : Promise.resolve(state.driveTempCache ?? {}),
    diskDevs.length && (takeSlow || !state.smartCache)
      ? readAllNvmeSmart(diskDevs)
      : Promise.resolve(state.smartCache ?? {}),
    state.meta?.net ? readNetDev(state.meta.net.iface) : Promise.resolve(null),
    takeSlow ? readSensors() : Promise.resolve(state.sensorsCache!),
    takeSlow || !state.gpuCache
      ? readGpu()
      : Promise.resolve(state.gpuCache),
    takeSlow || state.boostCache === null
      ? readBoost()
      : Promise.resolve(state.boostCache),
    readEnergyUj(),
    readDramEnergyUj(),
    readProcesses(),
    readContainers(),
  ]);

  state.sensorsCache = temp;
  state.fsCache = fsByDev;
  state.driveTempCache = driveTemps;
  state.smartCache = nvmeSmart;
  state.gpuCache = gpu;
  state.boostCache = boost;

  return {
    t: Date.now(),
    cpuAgg: stat.agg,
    cpuThreads: stat.threads,
    ctxt: stat.ctxt,
    procsRunning: stat.procsRunning,
    forks: stat.forks,
    boost,
    energyUj,
    dramEnergyUj,
    freqsMhz,
    mem,
    load,
    uptimeSec,
    psi,
    fdNr,
    disks,
    fsByDev,
    driveTemps,
    nvmeSmart,
    net,
    temp,
    procs,
    containers,
    gpu,
  };
}

function estimatePower(
  cpuPkgW: number | null,
  dramW: number | null,
  gpu: GpuInfo | undefined,
  disks: PerfSnapshot["disks"],
  net: PerfSnapshot["net"],
): PowerEstimate {
  const items: PowerItem[] = [];
  const add = (
    key: string,
    label: string,
    tier: PowerItem["tier"],
    lo: number,
    hi: number,
  ) => items.push({ key, label, tier, lo: Math.max(0, lo), hi: Math.max(0, hi) });

  // measured — RAPL rails, small tolerance band
  const cpu = cpuPkgW ?? 20;
  add("cpu", "CPU package", "measured", cpu * 0.97, cpu * 1.03);
  const dram = dramW ?? 2;
  add("dram", "DRAM", "measured", dram * 0.95, dram * 1.05);

  // GPU: the card's own power reading when it reports one (most NVIDIA cards
  // and amdgpu), else an estimate from utilisation vs TDP
  if (gpu && gpu.powerDrawW != null) {
    add("gpu", "GPU", "measured", gpu.powerDrawW * 0.95, gpu.powerDrawW * 1.05);
  } else if (gpu) {
    const tdp = gpu.powerLimitW ?? 75;
    const idle = PWR.gpuIdleW;
    const util = gpu.utilPct ?? 0;
    // NVIDIA idles in P8+; amdgpu has no P-states, so low utilisation alone counts
    const nvidiaIdle = /P(8|10|12|15)/.test((gpu.pstate ?? "").toUpperCase());
    const idling = util < 3 && (nvidiaIdle || !/^P\d+$/i.test(gpu.pstate ?? ""));
    if (idling) add("gpu", "GPU", "estimate", 4, idle + 3);
    else {
      const base = idle + (util / 100) * (tdp - idle);
      add("gpu", "GPU", "estimate", base * 0.72, base * 1.15 + 6);
    }
  }

  // estimate — storage from per-drive activity
  let sLo = 0;
  let sHi = 0;
  for (const d of disks) {
    const idleW = d.rotational ? 4 : 0.8;
    const actW = d.rotational ? 8.5 : 6.5;
    const w = idleW + (d.utilPct / 100) * (actW - idleW);
    sLo += w * 0.7;
    sHi += w * 1.3 + 0.5;
  }
  if (disks.length) add("storage", "Storage", "estimate", sLo, sHi);

  // estimate — NIC + Wi-Fi, weakly scaled by throughput
  const netBps = net ? net.rxBps + net.txBps : 0;
  const wifiHi = 0.3 + (Math.min(netBps, 6e6) / 6e6) * 1.8;
  add("net", "Network", "estimate", 0.5, 0.9 + wifiHi);

  // guesses — fixed ranges, no live signal
  add("board", "Mainboard", "guess", PWR.boardLo, PWR.boardHi);
  add("vrm", "VRM loss", "guess", cpu * PWR.vrmLoFrac, cpu * PWR.vrmHiFrac);
  add(
    "fans",
    "Fans",
    "guess",
    PWR.fanCount * PWR.fanLoEach,
    PWR.fanCount * PWR.fanHiEach,
  );
  add("usb", "Peripherals", "guess", PWR.usbLo, PWR.usbHi);

  const dcLo = items.reduce((a, i) => a + i.lo, 0);
  const dcHi = items.reduce((a, i) => a + i.hi, 0);
  return {
    items,
    dcLo,
    dcHi,
    wallLo: dcLo / PWR.psuEffHi,
    wallHi: dcHi / PWR.psuEffLo,
  };
}

function pct(deltaBusy: number, deltaTotal: number): number {
  if (deltaTotal <= 0) return 0;
  return Math.max(0, Math.min(100, (deltaBusy / deltaTotal) * 100));
}

function computeSnapshot(prev: Raw, cur: Raw): PerfSnapshot {
  const dt = (cur.t - prev.t) / 1000;
  const kB = 1024;

  const dAggTotal = cur.cpuAgg.total - prev.cpuAgg.total;
  const dIdle = cur.cpuAgg.idle - prev.cpuAgg.idle;
  const dIowait = cur.cpuAgg.iowait - prev.cpuAgg.iowait;
  const asPct = (v: number) =>
    dAggTotal > 0 ? Math.max(0, (v / dAggTotal) * 100) : 0;
  const cpuUtil = {
    user: asPct(cur.cpuAgg.user - prev.cpuAgg.user),
    nice: asPct(cur.cpuAgg.nice - prev.cpuAgg.nice),
    system: asPct(cur.cpuAgg.system - prev.cpuAgg.system),
    idle: asPct(dIdle),
    iowait: asPct(dIowait),
    irq: asPct(cur.cpuAgg.irq - prev.cpuAgg.irq),
    softirq: asPct(cur.cpuAgg.softirq - prev.cpuAgg.softirq),
    steal: asPct(cur.cpuAgg.steal - prev.cpuAgg.steal),
  };
  const overall = pct(dAggTotal - dIdle - dIowait, dAggTotal);

  const threadPct = cur.cpuThreads.map((c, i) => {
    const p = prev.cpuThreads[i];
    if (!p) return 0;
    return pct(c.total - p.total - (c.idle - p.idle), c.total - p.total);
  });

  // per-process rates, reused for the process list and per-cpu "what's running"
  const procRates = [...cur.procs.entries()].map(([pid, p]) => {
    const before = prev.procs.get(pid);
    const cpuPct = before
      ? Math.max(0, ((p.cpuTicks - before.cpuTicks) / CLK_TCK / dt) * 100)
      : 0;
    return {
      pid,
      name: p.comm,
      cmd: p.cmd,
      user: p.user,
      pstate: p.state,
      threads: p.threads,
      cpuPct,
      rssBytes: p.rssPages * PAGE_SIZE,
      processor: p.processor,
    };
  });

  const threadTop: (string | null)[] = new Array(threadPct.length).fill(null);
  const threadTopPct: number[] = new Array(threadPct.length).fill(0);
  for (const p of procRates) {
    const i = p.processor;
    if (i >= 0 && i < threadPct.length && p.cpuPct > threadTopPct[i]) {
      threadTopPct[i] = p.cpuPct;
      threadTop[i] = p.name;
    }
  }

  const coreOf = state.meta?.coreOfThread ?? threadPct.map((_, i) => i);
  const nCores = state.meta?.physicalCores || threadPct.length;
  const coreBins = Array.from({ length: nCores }, () => ({
    sum: 0,
    n: 0,
    freqSum: 0,
    freqN: 0,
    threadIds: [] as number[],
    top: null as string | null,
    topPct: 0,
  }));
  threadPct.forEach((v, i) => {
    const b = coreBins[coreOf[i] ?? 0];
    if (!b) return;
    b.sum += v;
    b.n += 1;
    const f = cur.freqsMhz[i];
    if (f != null && Number.isFinite(f)) {
      b.freqSum += f;
      b.freqN += 1;
    }
    b.threadIds.push(i);
    if (threadTopPct[i] > b.topPct) {
      b.topPct = threadTopPct[i];
      b.top = threadTop[i];
    }
  });
  const perCore = coreBins.map((b, i) => ({
    id: i,
    pct: b.n ? b.sum / b.n : 0,
    freqMhz: b.freqN ? b.freqSum / b.freqN : null,
    tempC: cur.temp.coresC[i] ?? null,
    threadIds: b.threadIds,
    topProc: b.top,
  }));
  const perThread = threadPct.map((v, i) => ({
    id: i,
    pct: v,
    freqMhz: cur.freqsMhz[i] ?? null,
    tempC: perCore[coreOf[i] ?? 0]?.tempC ?? null,
    topProc: threadTop[i],
  }));

  const ctxSwitchesPerSec =
    dt > 0 ? Math.max(0, (cur.ctxt - prev.ctxt) / dt) : 0;

  let zombies = 0;
  for (const p of cur.procs.values()) if (p.state === "Z") zombies++;
  const sys = {
    procCount: cur.procs.size,
    threadCount: cur.load.total,
    running: cur.load.running,
    zombies,
    forksPerSec:
      dt > 0 ? Math.max(0, (cur.forks - prev.forks) / dt) : 0,
    fdOpen: cur.fdNr?.open ?? null,
    fdMax: cur.fdNr?.max ?? null,
  };

  const freqAvgMhz = cur.freqsMhz.length
    ? cur.freqsMhz.reduce((a, b) => a + b, 0) / cur.freqsMhz.length
    : 0;
  const freqMaxMhz = cur.freqsMhz.length ? Math.max(...cur.freqsMhz) : 0;
  const freqMinMhz = state.meta?.cpuSpec?.minMhz ?? null;

  const m = cur.mem;
  const totalBytes = (m.MemTotal ?? 0) * kB;
  const availableBytes = (m.MemAvailable ?? m.MemFree ?? 0) * kB;
  const usedBytes = totalBytes - availableBytes;
  const cacheBytes =
    ((m.Cached ?? 0) + (m.Buffers ?? 0) + (m.SReclaimable ?? 0)) * kB;

  const diskMeta = state.meta?.disks ?? [];
  const perDisk = diskMeta.map((info) => {
    const d = cur.disks[info.dev];
    const p = prev.disks[info.dev];
    const usage = cur.fsByDev[info.dev];
    let readBps = 0;
    let writeBps = 0;
    let readIops = 0;
    let writeIops = 0;
    let utilPct = 0;
    let awaitMs = 0;
    let queue = 0;
    if (d && p && dt > 0) {
      const dReads = d.readsCompleted - p.readsCompleted;
      const dWrites = d.writesCompleted - p.writesCompleted;
      readBps = Math.max(0, ((d.sectorsRead - p.sectorsRead) * 512) / dt);
      writeBps = Math.max(0, ((d.sectorsWritten - p.sectorsWritten) * 512) / dt);
      readIops = Math.max(0, dReads / dt);
      writeIops = Math.max(0, dWrites / dt);
      utilPct = Math.max(
        0,
        Math.min(100, ((d.msDoingIo - p.msDoingIo) / (dt * 1000)) * 100),
      );
      awaitMs =
        dReads + dWrites > 0
          ? (d.msReading - p.msReading + (d.msWriting - p.msWriting)) /
            (dReads + dWrites)
          : 0;
      queue = d.iosInProgress;
    }
    return {
      dev: info.dev,
      model: info.model,
      capacityBytes: info.capacityBytes,
      fsUsedBytes: usage?.usedBytes ?? 0,
      fsSizeBytes: usage?.sizeBytes ?? 0,
      readBps,
      writeBps,
      readIops,
      writeIops,
      utilPct,
      awaitMs,
      queue,
      tempC: cur.driveTemps[info.dev] ?? null,
      rotational: info.rotational,
      healthPct: cur.nvmeSmart[info.dev]?.healthPct ?? null,
      sparePct: cur.nvmeSmart[info.dev]?.sparePct ?? null,
      tbwBytes: cur.nvmeSmart[info.dev]?.tbwBytes ?? null,
      powerOnHours: cur.nvmeSmart[info.dev]?.powerOnHours ?? null,
    };
  });

  let disk: PerfSnapshot["disk"] = null;
  if (perDisk.length) {
    disk = {
      readBps: perDisk.reduce((a, x) => a + x.readBps, 0),
      writeBps: perDisk.reduce((a, x) => a + x.writeBps, 0),
      readIops: perDisk.reduce((a, x) => a + x.readIops, 0),
      writeIops: perDisk.reduce((a, x) => a + x.writeIops, 0),
      utilPct: Math.max(0, ...perDisk.map((x) => x.utilPct)),
      awaitMs: Math.max(0, ...perDisk.map((x) => x.awaitMs)),
      queue: perDisk.reduce((a, x) => a + x.queue, 0),
      tempC: perDisk.reduce<number | null>(
        (a, x) => (x.tempC != null ? Math.max(a ?? 0, x.tempC) : a),
        null,
      ),
    };
  }

  let net: PerfSnapshot["net"] = null;
  if (cur.net && prev.net && dt > 0) {
    net = {
      rxBps: Math.max(0, (cur.net.rxBytes - prev.net.rxBytes) / dt),
      txBps: Math.max(0, (cur.net.txBytes - prev.net.txBytes) / dt),
      rxTotalBytes: cur.net.rxBytes,
      txTotalBytes: cur.net.txBytes,
    };
  }

  // candidate set for the Processes list: the RAM-heaviest, unioned with the
  // CPU-heaviest so a low-RAM runaway still shows up. The client sorts/slices.
  const procRow = (p: (typeof procRates)[number]) => ({
    pid: p.pid,
    name: p.name,
    cmd: p.cmd,
    user: p.user,
    state: p.pstate,
    threads: p.threads,
    cpuPct: p.cpuPct,
    rssBytes: p.rssBytes,
  });
  const byRss = [...procRates]
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, 14)
    .map(procRow);
  const seen = new Set(byRss.map((p) => p.pid));
  const byCpu = [...procRates]
    .sort((a, b) => b.cpuPct - a.cpuPct)
    .slice(0, 8)
    .map(procRow)
    .filter((p) => !seen.has(p.pid));
  const procs = [...byRss, ...byCpu].sort((a, b) => b.rssBytes - a.rssBytes);

  const services = cur.containers
    .map((c) => {
      const before = prev.containers.find((x) => x.name === c.name);
      const cpuPct = before
        ? Math.max(0, ((c.usageUsec - before.usageUsec) / (dt * 1e6)) * 100)
        : 0;
      return { name: c.name, cpuPct, memBytes: c.memBytes };
    })
    .sort((a, b) => b.cpuPct - a.cpuPct);

  const perf =
    state.perfCounters && cur.t - state.perfCounters.ts < PERF_STALE_MS
      ? state.perfCounters
      : null;

  let packageWatts: number | null = null;
  if (cur.energyUj != null && prev.energyUj != null && dt > 0) {
    let dUj = cur.energyUj - prev.energyUj;
    if (dUj < 0) dUj += state.meta?.raplMaxUj ?? 2 ** 62; // counter wrap
    const w = dUj / 1e6 / dt; // µJ → J → W
    if (Number.isFinite(w) && w >= 0 && w < 2000) packageWatts = w;
  }

  let dramWatts: number | null = null;
  if (cur.dramEnergyUj != null && prev.dramEnergyUj != null && dt > 0) {
    let dUj = cur.dramEnergyUj - prev.dramEnergyUj;
    if (dUj < 0) dUj += state.meta?.raplDramMaxUj ?? 2 ** 62;
    const w = dUj / 1e6 / dt;
    if (Number.isFinite(w) && w >= 0 && w < 500) dramWatts = w;
  }

  return {
    t: cur.t,
    cpu: {
      overall,
      freqAvgMhz,
      freqMaxMhz,
      freqMinMhz,
      boost: cur.boost,
      perCore,
      perThread,
      util: cpuUtil,
      ctxSwitchesPerSec,
      migrationsPerSec: perf?.migrationsPerSec ?? null,
      ipsPerSec: perf?.ipsPerSec ?? null,
      cyclesPerSec: perf?.cyclesPerSec ?? null,
      ipc: perf?.ipc ?? null,
      runQueue: cur.procsRunning,
      packageWatts,
    },
    load: cur.load,
    uptimeSec: cur.uptimeSec,
    psi: cur.psi,
    sys,
    mem: {
      totalBytes,
      usedBytes,
      availableBytes,
      cacheBytes,
      usedPct: totalBytes ? (usedBytes / totalBytes) * 100 : 0,
      swapUsedBytes: ((m.SwapTotal ?? 0) - (m.SwapFree ?? 0)) * kB,
      swapTotalBytes: (m.SwapTotal ?? 0) * kB,
      committedBytes: (m.Committed_AS ?? 0) * kB,
      commitLimitBytes: (m.CommitLimit ?? 0) * kB,
      powerWatts: dramWatts,
    },
    disk,
    disks: perDisk,
    net,
    temp: cur.temp,
    gpu: cur.gpu,
    power: estimatePower(packageWatts, dramWatts, cur.gpu[0], perDisk, net),
    procs,
    services,
  };
}

async function tick(): Promise<void> {
  // A "slow" tick (sensors/nvidia-smi/smartctl calls, every SENSORS_EVERY
  // ticks) can take longer than TICK_MS. Without this guard, setInterval
  // fires a second, overlapping tick() that reads/writes state.prev out of
  // order - producing a near-zero dt between two Raw samples and, since
  // readBps/writeBps divide a normal counter delta by that near-zero dt, a
  // single wildly-oversized rate sample that spikes the graph until it ages
  // out of the history window.
  if (state.busy) return;
  state.busy = true;
  try {
    if (!state.meta) state.meta = await buildMeta();
    if (state.tick % CONTAINERS_EVERY === 0 || !state.containerDirs.length) {
      await refreshContainerDirs();
    }
    const raw = await readRaw();
    if (state.prev) {
      state.history.push(computeSnapshot(state.prev, raw));
      if (state.history.length > HISTORY_MAX) state.history.shift();
    }
    state.prev = raw;
    state.tick++;
    state.lastError = null;
  } catch (err) {
    state.lastError = (err as Error).message ?? String(err);
  } finally {
    state.busy = false;
  }
}

function ensureSampler(): void {
  startPerfLoop();
  if (state.timer) return;
  const timer = setInterval(tick, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  state.timer = timer;
}

/* ------------------------------------------------------------------- public */

export type PerfResponse = {
  current: PerfSnapshot | null;
  history: {
    t: number;
    cpu: number;
    mem: number;
    /** app/anon memory as % of total (used minus reclaimable cache) */
    memApp: number;
    diskR: number;
    diskW: number;
    /** machine-wide disk activity (busy time), 0-100 */
    diskAct: number;
    /** NVMe composite temperature °C (null = no sensor) */
    nvmeC: number | null;
    netRx: number;
    netTx: number;
    pkg: number | null;
    gpu: number;
    gpuMem: number;
    gpuTempC: number | null;
    /** estimated whole-system wall power, low / high bound */
    estWLo: number;
    estWHi: number;
    /** load averages (1-min / 5-min) */
    load1: number;
    load5: number;
  }[];
  meta: Meta | null;
  samples: number;
  error: string | null;
};

export async function getPerf(): Promise<PerfResponse> {
  ensureSampler();

  // On a cold process there is no delta yet — prime two samples quickly so the
  // first page load has real numbers instead of an empty state.
  if (state.history.length === 0 && !state.priming) {
    state.priming = (async () => {
      await tick();
      await sleep(350);
      await tick();
    })();
  }
  if (state.priming) {
    await state.priming;
    state.priming = null;
  }

  return {
    current: state.history[state.history.length - 1] ?? null,
    history: state.history.slice(-HISTORY_SEND).map((s) => ({
      t: s.t,
      cpu: s.cpu.overall,
      mem: s.mem.usedPct,
      memApp: s.mem.totalBytes
        ? (Math.max(0, s.mem.usedBytes - s.mem.cacheBytes) / s.mem.totalBytes) *
          100
        : 0,
      diskR: s.disk?.readBps ?? 0,
      diskW: s.disk?.writeBps ?? 0,
      diskAct: s.disk?.utilPct ?? 0,
      nvmeC: s.temp.nvmeC,
      netRx: s.net?.rxBps ?? 0,
      netTx: s.net?.txBps ?? 0,
      pkg: s.temp.packageC,
      gpu: s.gpu[0]?.utilPct ?? 0,
      gpuMem: s.gpu[0]
        ? s.gpu[0].memTotalBytes
          ? (s.gpu[0].memUsedBytes / s.gpu[0].memTotalBytes) * 100
          : 0
        : 0,
      gpuTempC: s.gpu[0]?.tempC ?? null,
      estWLo: s.power.wallLo,
      estWHi: s.power.wallHi,
      load1: s.load.load[0],
      load5: s.load.load[1],
    })),
    meta: state.meta,
    samples: state.history.length,
    error: state.lastError,
  };
}

// byjohnmichael*
