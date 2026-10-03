// Shapes returned by /api/performance (and the Minecraft perf/backup routes).

/* ----------------------------------------------------------------- types */

export type Pressure = { some10: number; some60: number; full10: number };

export type CpuLane = {
  id: number;
  pct: number;
  freqMhz: number | null;
  tempC: number | null;
  topProc: string | null;
};

export type Snapshot = {
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

export type PerfServer = {
  key: string;
  label: string;
  running: boolean;
  memBytes: number | null;
};

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
  throttle: string;
  pstate: string;
};

export type CpuSpec = {
  model: string;
  vendor: string;
  arch: string | null;
  cores: number;
  threads: number;
  sockets: number;
  numaNodes: number;
  smt: string;
  threadsPerCore: number;
  baseGhz: number | null;
  maxMhz: number | null;
  minMhz: number | null;
  l1d: string | null;
  l1i: string | null;
  l2: string | null;
  l3: string | null;
  virtualization: string | null;
  family: number | null;
  modelId: number | null;
  stepping: number | null;
};

export type MemSlot = {
  index: number;
  locator: string;
  present: boolean;
  sizeBytes: number;
  type: string;
  speed: string;
  manufacturer: string;
  partNumber: string;
};
export type MemSpec = {
  totalBytes: number;
  maxCapacity: string | null;
  slotsUsed: number;
  slotsTotal: number;
  type: string | null;
  speed: string | null;
  slots: MemSlot[];
};

export type Meta = {
  cpuModel: string;
  logical: number;
  physicalCores: number;
  coreOfThread: number[];
  disk: { name: string; capacityBytes: number; dev: string } | null;
  net: { iface: string; speedMbps: number | null } | null;
  os: {
    distro: string;
    kernel: string;
    hostname: string;
    arch: string;
  } | null;
  cpuSpec: CpuSpec | null;
  memSpec: MemSpec | null;
};

export type HistPoint = {
  t: number;
  cpu: number;
  mem: number;
  memApp: number;
  diskR: number;
  diskW: number;
  diskAct: number;
  nvmeC: number | null;
  gpuTempC: number | null;
  estWLo: number;
  estWHi: number;
  load1: number;
  load5: number;
  netRx: number;
  netTx: number;
  pkg: number | null;
  gpu: number;
  gpuMem: number;
};

export type PerfResponse = {
  current: Snapshot | null;
  history: HistPoint[];
  meta: Meta | null;
  samples: number;
  error: string | null;
};

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

export type McPerfResponse = {
  current: McPerfSnapshot | null;
  history: McPerfSnapshot[];
  error: string | null;
};

export type SparkAction = "health" | "flamegraph";

export type BackupSnapshot = {
  id: string;
  time: string;
  sizeBytes: number;
  fileCount: number;
};

export type BackupsResponse = {
  hourly: BackupSnapshot[];
  monthly: BackupSnapshot[];
};

// byjohnmichael*
