import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { PerfSnapshot } from "@/lib/perfSampler";

// Long-term performance history, in SQLite under <app>/admin-site-data.
//
// The live sampler ticks at 1 Hz; this module folds those ticks into running
// sums and flushes the *delta* every FLUSH_MS into two resolutions at once:
//   res 'h' — hourly rows, pruned after HOURLY_KEEP_DAYS
//   res 'd' — daily rows, kept forever
// Rows store sum / count / max per metric (never a finished average), so each
// flush just adds to the row. That keeps a restart mid-hour from clobbering
// the bucket, and lets any coarser view (6h, 12h, weekly…) be rebuilt by
// summing rows. Daily rows are written alongside hourly ones, so there is no
// separate rollup job and nothing is lost when old hourly rows are pruned.

const DATA_DIR =
  process.env.ADMIN_DATA_DIR ??
  path.join(/* turbopackIgnore: true */ process.cwd(), "admin-site-data");
const DB_FILE = path.join(/* turbopackIgnore: true */ DATA_DIR, "perf-history.db");

const FLUSH_MS = 30_000;
const HOURLY_KEEP_DAYS = 35;
const HOUR = 3_600_000;

/** system-wide metrics, as pulled from a snapshot (null = no reading) */
export const PERF_METRICS = {
  cpu: (s) => s.cpu.overall,
  pkg: (s) => s.temp.packageC,
  freq: (s) => s.cpu.freqMaxMhz,
  cpuW: (s) => s.cpu.packageWatts,
  mem: (s) => s.mem.usedPct,
  memApp: (s) =>
    s.mem.totalBytes
      ? (Math.max(0, s.mem.usedBytes - s.mem.cacheBytes) / s.mem.totalBytes) *
        100
      : null,
  swap: (s) =>
    s.mem.swapTotalBytes ? (s.mem.swapUsedBytes / s.mem.swapTotalBytes) * 100 : null,
  memStall: (s) => s.psi.memory.some10,
  dimmW: (s) => s.mem.powerWatts,
  diskR: (s) => s.disk?.readBps ?? null,
  diskW: (s) => s.disk?.writeBps ?? null,
  diskAct: (s) => s.disk?.utilPct ?? null,
  nvmeC: (s) => s.temp.nvmeC,
  gpu: (s) => s.gpu[0]?.utilPct ?? null,
  gpuMem: (s) =>
    s.gpu[0]?.memTotalBytes
      ? (s.gpu[0].memUsedBytes / s.gpu[0].memTotalBytes) * 100
      : null,
  gpuC: (s) => s.gpu[0]?.tempC ?? null,
  gpuW: (s) => s.gpu[0]?.powerDrawW ?? null,
  netRx: (s) => s.net?.rxBps ?? null,
  netTx: (s) => s.net?.txBps ?? null,
  wLo: (s) => s.power.wallLo,
  wHi: (s) => s.power.wallHi,
  load1: (s) => s.load.load[0],
  load5: (s) => s.load.load[1],
  load15: (s) => s.load.load[2],
  procs: (s) => s.sys.procCount,
  uptime: (s) => s.uptimeSec,
  cpuStall: (s) => s.psi.cpu.some10,
  ioStall: (s) => s.psi.io.some10,
} satisfies Record<string, (s: PerfSnapshot) => number | null | undefined>;

/** per-drive metrics, same sum/count/max treatment */
export const SSD_METRICS = {
  temp: (d) => d.tempC,
  util: (d) => d.utilPct,
  rBps: (d) => d.readBps,
  wBps: (d) => d.writeBps,
} satisfies Record<string, (d: PerfSnapshot["disks"][number]) => number | null | undefined>;

/** per-drive values that are a state, not a rate: the latest reading wins */
const SSD_LATEST = [
  "health_pct",
  "spare_pct",
  "tbw_bytes",
  "power_on_hours",
  "fs_used_bytes",
  "capacity_bytes",
] as const;

export type PerfMetric = keyof typeof PERF_METRICS;
export type SsdMetric = keyof typeof SSD_METRICS;
export const perfMetricNames = Object.keys(PERF_METRICS) as PerfMetric[];
export const ssdMetricNames = Object.keys(SSD_METRICS) as SsdMetric[];

type Acc = { sum: number; n: number; max: number };
type SsdAcc = {
  model: string;
  m: Record<SsdMetric, Acc>;
  latest: Record<(typeof SSD_LATEST)[number], number | null>;
  /** samples folded in since the last flush */
  ticks: number;
};

const accFresh = (): Acc => ({ sum: 0, n: 0, max: -Infinity });
function accAdd(a: Acc, v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return;
  a.sum += v;
  a.n += 1;
  if (v > a.max) a.max = v;
}

type HistState = {
  db: Database.Database | null;
  perf: Record<PerfMetric, Acc>;
  ticks: number;
  ssd: Map<string, SsdAcc>;
  lastFlush: number;
  lastPrune: number;
  failed: boolean;
};

const GLOBAL_KEY = "__adminPerfHistory__";
const g = globalThis as unknown as Record<string, HistState | undefined>;
const hs: HistState =
  g[GLOBAL_KEY] ??
  (g[GLOBAL_KEY] = {
    db: null,
    perf: freshPerf(),
    ticks: 0,
    ssd: new Map(),
    lastFlush: Date.now(),
    lastPrune: 0,
    failed: false,
  });

function freshPerf(): Record<PerfMetric, Acc> {
  const o = {} as Record<PerfMetric, Acc>;
  for (const k of perfMetricNames) o[k] = accFresh();
  return o;
}

const metricCols = (names: string[]) =>
  names.flatMap((m) => [`${m}_sum REAL`, `${m}_n INTEGER`, `${m}_max REAL`]);

function open(): Database.Database {
  if (hs.db) return hs.db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_FILE);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS perf (
      res TEXT NOT NULL,
      ts INTEGER NOT NULL,
      ticks INTEGER NOT NULL DEFAULT 0,
      ${metricCols(perfMetricNames).join(",\n      ")},
      PRIMARY KEY (res, ts)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS ssd (
      res TEXT NOT NULL,
      ts INTEGER NOT NULL,
      dev TEXT NOT NULL,
      model TEXT,
      ticks INTEGER NOT NULL DEFAULT 0,
      ${metricCols(ssdMetricNames).join(",\n      ")},
      ${SSD_LATEST.map((c) => `${c} REAL`).join(",\n      ")},
      PRIMARY KEY (res, ts, dev)
    ) WITHOUT ROWID;
  `);
  // metrics added after a table was first created: add their columns
  const addMissing = (table: string, names: string[]) => {
    const have = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    for (const m of names) {
      for (const [suffix, type] of [["sum", "REAL"], ["n", "INTEGER"], ["max", "REAL"]]) {
        if (!have.has(`${m}_${suffix}`)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${m}_${suffix} ${type}`);
        }
      }
    }
  };
  addMissing("perf", perfMetricNames);
  addMissing("ssd", ssdMetricNames);
  hs.db = db;
  return db;
}

function dayStart(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function upsertSql(
  table: "perf" | "ssd",
  names: string[],
  extraCols: string[],
  latest: readonly string[],
): string {
  const cols = [
    "res",
    "ts",
    ...extraCols,
    "ticks",
    ...names.flatMap((m) => [`${m}_sum`, `${m}_n`, `${m}_max`]),
    ...latest,
  ];
  const sets = [
    "ticks = ticks + excluded.ticks",
    ...names.flatMap((m) => [
      `${m}_sum = COALESCE(${m}_sum, 0) + COALESCE(excluded.${m}_sum, 0)`,
      `${m}_n = COALESCE(${m}_n, 0) + COALESCE(excluded.${m}_n, 0)`,
      `${m}_max = MAX(COALESCE(${m}_max, excluded.${m}_max), COALESCE(excluded.${m}_max, ${m}_max))`,
    ]),
    ...latest.map((c) => `${c} = COALESCE(excluded.${c}, ${c})`),
    ...(table === "ssd" ? ["model = COALESCE(excluded.model, model)"] : []),
  ];
  const conflict = table === "ssd" ? "res, ts, dev" : "res, ts";
  return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols
    .map((c) => `@${c}`)
    .join(", ")}) ON CONFLICT(${conflict}) DO UPDATE SET ${sets.join(", ")}`;
}

const perfUpsert = () =>
  upsertSql("perf", perfMetricNames, [], []);
const ssdUpsert = () =>
  upsertSql("ssd", ssdMetricNames, ["dev", "model"], SSD_LATEST);

function flush(now: number) {
  const db = open();
  const hour = Math.floor(now / HOUR) * HOUR;
  const day = dayStart(now);

  const insPerf = db.prepare(perfUpsert());
  const insSsd = db.prepare(ssdUpsert());

  const tx = db.transaction(() => {
    if (hs.ticks > 0) {
      const row: Record<string, number | string | null> = { ticks: hs.ticks };
      for (const m of perfMetricNames) {
        const a = hs.perf[m];
        row[`${m}_sum`] = a.n ? a.sum : null;
        row[`${m}_n`] = a.n;
        row[`${m}_max`] = a.n ? a.max : null;
      }
      insPerf.run({ ...row, res: "h", ts: hour });
      insPerf.run({ ...row, res: "d", ts: day });
    }
    for (const [dev, a] of hs.ssd) {
      if (a.ticks === 0) continue;
      const row: Record<string, number | string | null> = {
        dev,
        model: a.model,
        ticks: a.ticks,
        ...a.latest,
      };
      for (const m of ssdMetricNames) {
        row[`${m}_sum`] = a.m[m].n ? a.m[m].sum : null;
        row[`${m}_n`] = a.m[m].n;
        row[`${m}_max`] = a.m[m].n ? a.m[m].max : null;
      }
      insSsd.run({ ...row, res: "h", ts: hour });
      insSsd.run({ ...row, res: "d", ts: day });
    }
  });
  tx();

  // reset the running sums; they were just written
  hs.perf = freshPerf();
  hs.ticks = 0;
  for (const a of hs.ssd.values()) {
    for (const m of ssdMetricNames) a.m[m] = accFresh();
    a.ticks = 0;
  }
  hs.lastFlush = now;

  // drop hourly rows past retention (daily rows are kept forever), once a day
  if (now - hs.lastPrune > 24 * HOUR) {
    const cutoff = now - HOURLY_KEEP_DAYS * 24 * HOUR;
    db.prepare("DELETE FROM perf WHERE res = 'h' AND ts < ?").run(cutoff);
    db.prepare("DELETE FROM ssd WHERE res = 'h' AND ts < ?").run(cutoff);
    hs.lastPrune = now;
  }
}

/** Called by the sampler once per tick with the freshly computed snapshot. */
export function recordSnapshot(s: PerfSnapshot): void {
  if (hs.failed) return;
  try {
    for (const m of perfMetricNames) accAdd(hs.perf[m], PERF_METRICS[m](s));
    hs.ticks++;

    for (const d of s.disks ?? []) {
      let a = hs.ssd.get(d.dev);
      if (!a) {
        a = {
          model: d.model,
          m: {} as SsdAcc["m"],
          latest: {} as SsdAcc["latest"],
          ticks: 0,
        };
        for (const m of ssdMetricNames) a.m[m] = accFresh();
        hs.ssd.set(d.dev, a);
      }
      a.model = d.model;
      for (const m of ssdMetricNames) accAdd(a.m[m], SSD_METRICS[m](d));
      a.ticks++;
      a.latest = {
        health_pct: d.healthPct,
        spare_pct: d.sparePct,
        tbw_bytes: d.tbwBytes,
        power_on_hours: d.powerOnHours,
        fs_used_bytes: d.fsUsedBytes,
        capacity_bytes: d.capacityBytes,
      };
    }

    const now = Date.now();
    // flush on the cadence, and always at an hour boundary so a bucket never
    // absorbs samples from the next hour
    if (
      now - hs.lastFlush >= FLUSH_MS ||
      Math.floor(now / HOUR) !== Math.floor(hs.lastFlush / HOUR)
    ) {
      flush(now);
    }
  } catch (err) {
    // history is best-effort: never take the live sampler down with it
    console.error("[perfHistory] disabled after error:", err);
    hs.failed = true;
  }
}

/* ------------------------------------------------------------------ queries */

export const RANGES = {
  "1d": { span: 24 * HOUR, bucket: HOUR, res: "h" },
  "7d": { span: 7 * 24 * HOUR, bucket: 6 * HOUR, res: "h" },
  "30d": { span: 30 * 24 * HOUR, bucket: 12 * HOUR, res: "h" },
  "1y": { span: 365 * 24 * HOUR, bucket: 24 * HOUR, res: "d" },
  all: { span: Infinity, bucket: 24 * HOUR, res: "d" },
} as const;
export type RangeKey = keyof typeof RANGES;

export type HistPoint = {
  t: number;
  /** seconds of samples behind this point (≈ 1 per logged tick) */
  ticks: number;
  /** per-metric average over the bucket (null = no reading) */
  avg: Record<string, number | null>;
  max: Record<string, number | null>;
};

export type SsdSeries = {
  dev: string;
  model: string;
  points: (HistPoint & {
    healthPct: number | null;
    sparePct: number | null;
    tbwBytes: number | null;
    powerOnHours: number | null;
    fsUsedBytes: number | null;
    capacityBytes: number | null;
  })[];
};

type Row = Record<string, number | string | null>;

function bucketOf(ts: number, bucket: number): number {
  if (bucket === 24 * HOUR) return dayStart(ts);
  return Math.floor(ts / bucket) * bucket;
}

function fold(rows: Row[], names: string[], bucket: number) {
  const out = new Map<
    number,
    { sum: Record<string, number>; n: Record<string, number>; max: Record<string, number>; ticks: number; last: Row }
  >();
  for (const r of rows) {
    const key = bucketOf(r.ts as number, bucket);
    let b = out.get(key);
    if (!b) {
      b = { sum: {}, n: {}, max: {}, ticks: 0, last: r };
      out.set(key, b);
    }
    b.ticks += (r.ticks as number) ?? 0;
    b.last = r; // rows arrive in ts order, so this ends as the latest
    for (const m of names) {
      const n = (r[`${m}_n`] as number | null) ?? 0;
      if (!n) continue;
      b.sum[m] = (b.sum[m] ?? 0) + ((r[`${m}_sum`] as number) ?? 0);
      b.n[m] = (b.n[m] ?? 0) + n;
      const mx = r[`${m}_max`] as number | null;
      if (mx != null) b.max[m] = Math.max(b.max[m] ?? -Infinity, mx);
    }
  }
  return [...out.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => {
      const avg: Record<string, number | null> = {};
      const max: Record<string, number | null> = {};
      for (const m of names) {
        avg[m] = b.n[m] ? b.sum[m] / b.n[m] : null;
        max[m] = b.n[m] ? b.max[m] : null;
      }
      return { t, ticks: b.ticks, avg, max, last: b.last };
    });
}

export function queryHistory(range: RangeKey): {
  range: RangeKey;
  bucketMs: number;
  since: number | null;
  perf: HistPoint[];
  ssd: SsdSeries[];
} {
  const cfg = RANGES[range];
  const db = open();
  const since = Number.isFinite(cfg.span) ? bucketOf(Date.now() - cfg.span, cfg.bucket) : 0;

  const perfRows = db
    .prepare("SELECT * FROM perf WHERE res = ? AND ts >= ? ORDER BY ts")
    .all(cfg.res, since) as Row[];
  const perf = fold(perfRows, perfMetricNames, cfg.bucket).map(
    ({ t, ticks, avg, max }) => ({ t, ticks, avg, max }),
  );

  const ssdRows = db
    .prepare("SELECT * FROM ssd WHERE res = ? AND ts >= ? ORDER BY ts")
    .all(cfg.res, since) as Row[];
  const byDev = new Map<string, Row[]>();
  for (const r of ssdRows) {
    const list = byDev.get(r.dev as string) ?? [];
    list.push(r);
    byDev.set(r.dev as string, list);
  }
  const ssd: SsdSeries[] = [...byDev.entries()].map(([dev, rows]) => {
    // the latest-value columns can be null in some rows (SMART not yet read);
    // carry the previous known value forward within the series
    const carry: Record<string, number | null> = {};
    for (const r of rows) {
      for (const c of SSD_LATEST) {
        const v = r[c] as number | null;
        if (v != null) carry[c] = v;
        else r[c] = carry[c] ?? null;
      }
    }
    const pts = fold(rows, ssdMetricNames, cfg.bucket).map(
      ({ t, ticks, avg, max, last }) => ({
        t,
        ticks,
        avg,
        max,
        healthPct: last.health_pct as number | null,
        sparePct: last.spare_pct as number | null,
        tbwBytes: last.tbw_bytes as number | null,
        powerOnHours: last.power_on_hours as number | null,
        fsUsedBytes: last.fs_used_bytes as number | null,
        capacityBytes: last.capacity_bytes as number | null,
      }),
    );
    return {
      dev,
      model: (rows[rows.length - 1].model as string | null) ?? dev,
      points: pts,
    };
  });

  return { range, bucketMs: cfg.bucket, since: since || null, perf, ssd };
}

// byjohnmichael*
