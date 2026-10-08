"use client";

import { useCallback, useEffect, useState } from "react";
import { useCachedState } from "@/lib/useCachedState";
import { HoverSparkline } from "@/components/perf/DotGraph";
import {
  CPU_BLUE,
  GPU_GREEN,
  MEM_ORANGE,
  NET_PURPLE,
  PSU_YELLOW,
  SSD_RED,
  fmtBytes,
  fmtMhz,
  fmtRate,
  fmtUptime,
  healthColor,
  heatColor,
  tempHeat,
  tempLineColor,
} from "@/lib/perf/format";
import type { HistPoint, RangeKey, SsdSeries } from "@/lib/perfHistory";

type HistoryResponse = {
  range: RangeKey;
  bucketMs: number;
  since: number | null;
  perf: HistPoint[];
  ssd: SsdSeries[];
};

const RANGE_LABELS: { key: RangeKey; label: string; hint: string }[] = [
  { key: "1d", label: "1 day", hint: "hourly" },
  { key: "7d", label: "7 days", hint: "6-hour" },
  { key: "30d", label: "1 month", hint: "12-hour" },
  { key: "1y", label: "1 year", hint: "daily" },
  { key: "all", label: "All", hint: "daily" },
];

const DAY = 86_400_000;
const GB = 1024 ** 3;

function fmtTimeFor(range: RangeKey) {
  return (t: number) => {
    const d = new Date(t);
    return range === "1y" || range === "all"
      ? d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
      : d.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "numeric",
        });
  };
}

function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-dim">{k}</dt>
      <dd className="text-right tabular-nums" style={color ? { color } : undefined}>
        {v}
      </dd>
    </div>
  );
}

function days(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1) return "< 1 day";
  if (n < 90) return `${Math.round(n)} days`;
  if (n < 730) return `${(n / 30.4).toFixed(0)} months`;
  return `${(n / 365).toFixed(1)} years`;
}

function GraphBox({
  title,
  children,
  ready,
}: {
  title: string;
  children: React.ReactNode;
  ready: boolean;
}) {
  return (
    <div className="flex flex-col rounded-md border border-panel-border bg-panel-border/10 p-3">
      <div className="mb-2 shrink-0 text-[13px] font-bold tracking-wide text-ink uppercase">
        {title}
      </div>
      <div className="flex min-h-[9rem] flex-1 flex-col">
        {ready ? (
          children
        ) : (
          <div className="m-auto text-xs text-ink-dim">
            Collecting data — check back soon
          </div>
        )}
      </div>
    </div>
  );
}

function DriveHistory({ drive, range }: { drive: SsdSeries; range: RangeKey }) {
  const pts = drive.points;
  const ready = pts.length >= 2;
  const fmtTime = fmtTimeFor(range);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const model =
    drive.model.replace(/\s+with heatsink/i, "").replace(/\s{2,}/g, " ").trim() ||
    drive.dev;

  const spanDays = ready ? Math.max(1 / 24, (last.t - first.t) / DAY) : 0;

  // bytes written between consecutive buckets, from the lifetime counter
  const writtenPer = pts.map((p, i) => {
    const prev = pts[i - 1];
    return {
      t: p.t,
      v:
        prev && p.tbwBytes != null && prev.tbwBytes != null
          ? Math.max(0, p.tbwBytes - prev.tbwBytes)
          : 0,
    };
  });
  const writtenInRange =
    ready && first.tbwBytes != null && last.tbwBytes != null
      ? last.tbwBytes - first.tbwBytes
      : null;
  const writtenPerDay = writtenInRange != null ? writtenInRange / spanDays : null;

  const wearNow = last?.healthPct != null ? 100 - last.healthPct : null;
  // total endurance implied by wear so far: lifetime written / fraction worn.
  // Needs at least 1% wear to mean anything.
  const endurance =
    wearNow != null && wearNow >= 1 && last.tbwBytes != null
      ? last.tbwBytes / (wearNow / 100)
      : null;
  const lifeDays =
    endurance != null && last.tbwBytes != null && writtenPerDay && writtenPerDay > 0
      ? (endurance - last.tbwBytes) / writtenPerDay
      : null;

  const usedGrowthPerDay =
    ready && first.fsUsedBytes != null && last.fsUsedBytes != null
      ? (last.fsUsedBytes - first.fsUsedBytes) / spanDays
      : null;
  const fullInDays =
    usedGrowthPerDay != null &&
    usedGrowthPerDay > 0 &&
    last.fsUsedBytes != null &&
    last.capacityBytes != null
      ? (last.capacityBytes - last.fsUsedBytes) / usedGrowthPerDay
      : null;
  const usedPct =
    last?.fsUsedBytes != null && last.capacityBytes
      ? (last.fsUsedBytes / last.capacityBytes) * 100
      : null;

  const peakTemp = pts.reduce<number | null>(
    (m, p) => (p.max.temp != null && (m == null || p.max.temp > m) ? p.max.temp : m),
    null,
  );

  const num = (v: number | null | undefined) => v ?? 0;
  const readPts = pts.map((p) => ({ t: p.t, v: num(p.avg.rBps) }));
  const writePts = pts.map((p) => ({ t: p.t, v: num(p.avg.wBps) }));
  const tempPts = pts.map((p) => ({ t: p.t, v: num(p.avg.temp) }));
  const rateMax = Math.max(1024, ...readPts.map((p) => p.v), ...writePts.map((p) => p.v)) * 1.1;
  const writtenMax = Math.max(GB, ...writtenPer.map((p) => p.v)) * 1.15;
  const usedPts = pts.map((p) => ({ t: p.t, v: num(p.fsUsedBytes) }));
  const capMax = Math.max(1, ...pts.map((p) => num(p.capacityBytes)));
  const wearPts = pts.map((p) => ({
    t: p.t,
    v: p.healthPct != null ? 100 - p.healthPct : 0,
  }));
  const wearMax = Math.max(2, Math.ceil(Math.max(...wearPts.map((p) => p.v)) * 1.5));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="truncate text-xs font-semibold tracking-wide text-ink uppercase" title={drive.model}>
          {model}
        </div>
        <div className="text-xs text-ink-dim">
          {drive.dev} · {pts.length} data point{pts.length === 1 ? "" : "s"}
        </div>
      </div>

      <dl className="grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <KV
          k="Drive health"
          v={last?.healthPct != null ? `${last.healthPct.toFixed(0)}%` : "—"}
          color={healthColor(last?.healthPct ?? null)}
        />
        <KV
          k="Available spare"
          v={last?.sparePct != null ? `${last.sparePct.toFixed(0)}%` : "—"}
        />
        <KV
          k="Power-on time"
          v={last?.powerOnHours != null ? days(last.powerOnHours / 24) : "—"}
        />
        <KV
          k="Lifetime written"
          v={last?.tbwBytes != null ? fmtBytes(last.tbwBytes) : "—"}
        />
        <KV
          k="Written in range"
          v={writtenInRange != null ? fmtBytes(writtenInRange) : "—"}
        />
        <KV
          k="Avg written / day"
          v={writtenPerDay != null ? fmtBytes(writtenPerDay) : "—"}
        />
        <KV
          k="Space used"
          v={
            last?.fsUsedBytes != null && last.capacityBytes
              ? `${fmtBytes(last.fsUsedBytes)} / ${fmtBytes(last.capacityBytes)}`
              : "—"
          }
          color={usedPct != null ? heatColor(usedPct) : undefined}
        />
        <KV
          k="Space change / day"
          v={
            usedGrowthPerDay != null
              ? `${usedGrowthPerDay >= 0 ? "+" : "−"}${fmtBytes(Math.abs(usedGrowthPerDay))}`
              : "—"
          }
        />
        <KV k="Full in" v={fullInDays != null ? days(fullInDays) : "—"} />
        <KV
          k="Peak temperature"
          v={peakTemp != null ? `${peakTemp.toFixed(0)}°C` : "—"}
          color={peakTemp != null ? tempHeat(peakTemp) : undefined}
        />
        <KV
          k="Est. life at this rate"
          v={lifeDays != null ? days(lifeDays) : "—"}
        />
      </dl>
      {lifeDays == null && (
        <p className="-mt-3 text-[11px] text-ink-dim">
          life estimate appears once the drive reports ≥1% wear and enough write
          history has been logged
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <GraphBox title="Read / write / temp" ready={ready}>
          <HoverSparkline
            mirror
            points={readPts}
            points2={writePts}
            points3={tempPts}
            color="#ff8a9a"
            color2={SSD_RED}
            color3={tempLineColor(last?.avg.temp ?? 0)}
            keys={["read", "write", "temp"]}
            fmt={(v) => fmtRate(v)}
            fmt3={(v) => `${v.toFixed(0)}°`}
            max={rateMax}
            max3={100}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Data written per period" ready={ready}>
          <HoverSparkline
            points={writtenPer}
            color={SSD_RED}
            keys={["written"]}
            fmt={(v) => fmtBytes(v)}
            max={writtenMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Space used" ready={ready}>
          <HoverSparkline
            points={usedPts}
            color={heatColor(usedPct ?? 0)}
            keys={["used"]}
            fmt={(v) => fmtBytes(v)}
            max={capMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Wear used" ready={ready}>
          <HoverSparkline
            points={wearPts}
            color={healthColor(last?.healthPct ?? null)}
            keys={["wear"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            max={wearMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- CPU / RAM history */

type Kind = "avg" | "max";
const series = (pts: HistPoint[], key: string, kind: Kind = "avg") =>
  pts.map((p) => ({ t: p.t, v: p[kind][key] ?? 0 }));
const vals = (pts: HistPoint[], key: string, kind: Kind = "avg") =>
  pts.map((p) => p[kind][key]).filter((v): v is number => v != null);
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const peak = (a: number[]) => (a.length ? Math.max(...a) : null);
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v.toFixed(d)}%`);
const deg = (v: number | null) => (v == null ? "—" : `${v.toFixed(0)}°C`);
const watts = (v: number | null) => (v == null ? "—" : `${v.toFixed(v < 10 ? 1 : 0)} W`);

function SectionShell({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel ${className} p-6`}>
      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="sec-title">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function CpuHistory({ pts, range }: { pts: HistPoint[]; range: RangeKey }) {
  const ready = pts.length >= 2;
  const fmtTime = fmtTimeFor(range);
  const usage = vals(pts, "cpu");
  const temp = vals(pts, "pkg");
  const tempPeak = peak(vals(pts, "pkg", "max"));
  const w = vals(pts, "cpuW");
  const freq = vals(pts, "freq");
  const load = vals(pts, "load1");
  const tempNow = temp[temp.length - 1] ?? 0;
  const wMax = Math.max(10, ...series(pts, "cpuW", "max").map((p) => p.v)) * 1.1;
  const freqMax = Math.max(1000, ...series(pts, "freq", "max").map((p) => p.v)) * 1.1;
  const loadMax = Math.max(1, ...series(pts, "load1", "max").map((p) => p.v)) * 1.1;
  // energy = mean power x time covered by the logged buckets
  const spanH = ready ? (pts[pts.length - 1].t - pts[0].t) / 3_600_000 : 0;
  const kwh = mean(w) != null && spanH > 0 ? (mean(w)! * spanH) / 1000 : null;

  return (
    <SectionShell title="cpu" className="cpu-section">
      <dl className="mb-5 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <KV k="Avg usage" v={pct(mean(usage), 1)} />
        <KV k="Peak usage" v={pct(peak(vals(pts, "cpu", "max")))} />
        <KV k="Avg load (1 min)" v={mean(load)?.toFixed(2) ?? "—"} />
        <KV
          k="Avg temperature"
          v={deg(mean(temp))}
          color={mean(temp) != null ? tempHeat(mean(temp)!) : undefined}
        />
        <KV
          k="Peak temperature"
          v={deg(tempPeak)}
          color={tempPeak != null ? tempHeat(tempPeak) : undefined}
        />
        <KV k="Avg clock" v={mean(freq) != null ? fmtMhz(mean(freq)!) : "—"} />
        <KV k="Avg package power" v={watts(mean(w))} />
        <KV k="Peak package power" v={watts(peak(vals(pts, "cpuW", "max")))} />
        <KV k="Energy in range" v={kwh != null ? `${kwh.toFixed(kwh < 10 ? 2 : 1)} kWh` : "—"} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <GraphBox title="Usage & temperature" ready={ready}>
          <HoverSparkline
            points={series(pts, "cpu")}
            points3={series(pts, "pkg")}
            color={CPU_BLUE}
            color3={tempLineColor(tempNow)}
            keys={["usage", "", "temp"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fmt3={(v) => `${v.toFixed(0)}°`}
            max3={100}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Peak usage" ready={ready}>
          <HoverSparkline
            points={series(pts, "cpu", "max")}
            color={CPU_BLUE}
            keys={["peak"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Package power" ready={ready}>
          <HoverSparkline
            points={series(pts, "cpuW")}
            points2={series(pts, "cpuW", "max")}
            color={PSU_YELLOW}
            color2={PSU_YELLOW}
            keys={["peak", "avg"]}
            fmt={(v) => `${v.toFixed(0)} W`}
            max={wMax}
            fillSecond={false}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Clock speed & load" ready={ready}>
          <HoverSparkline
            points={series(pts, "freq")}
            points3={series(pts, "load1")}
            color={CPU_BLUE}
            color3="#ffffff"
            keys={["clock", "", "load"]}
            fmt={(v) => fmtMhz(v)}
            fmt3={(v) => v.toFixed(2)}
            max={freqMax}
            max3={loadMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
      </div>
    </SectionShell>
  );
}

function RamHistory({ pts, range }: { pts: HistPoint[]; range: RangeKey }) {
  const ready = pts.length >= 2;
  const fmtTime = fmtTimeFor(range);
  const dimm = vals(pts, "dimmW");
  const stallPeak = peak(vals(pts, "memStall", "max"));
  const swapPeak = peak(vals(pts, "swap", "max"));
  const stallMax = Math.max(5, Math.ceil((stallPeak ?? 0) * 1.2));
  const swapMax = Math.max(5, Math.ceil((swapPeak ?? 0) * 1.2));
  const dimmMax = Math.max(2, ...series(pts, "dimmW", "max").map((p) => p.v)) * 1.2;
  const memAvg = mean(vals(pts, "mem"));
  const memPeak = peak(vals(pts, "mem", "max"));

  return (
    <SectionShell title="ram" className="ram-section">
      <dl className="mb-5 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <KV k="Avg used" v={pct(memAvg, 1)} color={memAvg != null ? heatColor(memAvg) : undefined} />
        <KV k="Peak used" v={pct(memPeak)} color={memPeak != null ? heatColor(memPeak) : undefined} />
        <KV k="Avg in use (apps)" v={pct(mean(vals(pts, "memApp")), 1)} />
        <KV k="Peak swap used" v={pct(swapPeak)} />
        <KV k="Avg memory stall" v={pct(mean(vals(pts, "memStall")), 2)} />
        <KV
          k="Peak memory stall"
          v={pct(stallPeak, 1)}
          color={stallPeak != null && stallPeak >= 5 ? "var(--danger, #ff5470)" : undefined}
        />
        <KV k="Avg DRAM power" v={watts(mean(dimm))} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <GraphBox title="Memory used" ready={ready}>
          <HoverSparkline
            points={series(pts, "mem")}
            points2={series(pts, "memApp")}
            color="#ffce9c"
            color2="#f5822e"
            keys={["total", "in use"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Peak memory used" ready={ready}>
          <HoverSparkline
            points={series(pts, "mem", "max")}
            color={MEM_ORANGE}
            keys={["peak"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Memory stall (pressure)" ready={ready}>
          <HoverSparkline
            points={series(pts, "memStall")}
            points2={series(pts, "memStall", "max")}
            color={MEM_ORANGE}
            color2={MEM_ORANGE}
            keys={["peak", "avg"]}
            fmt={(v) => `${v.toFixed(1)}%`}
            max={stallMax}
            fillSecond={false}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Swap & DRAM power" ready={ready}>
          <HoverSparkline
            points={series(pts, "swap")}
            points3={series(pts, "dimmW")}
            color={MEM_ORANGE}
            color3={PSU_YELLOW}
            keys={["swap", "", "dram"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fmt3={(v) => `${v.toFixed(1)} W`}
            max={swapMax}
            max3={dimmMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
      </div>
    </SectionShell>
  );
}

function GpuHistory({ pts, range }: { pts: HistPoint[]; range: RangeKey }) {
  // no GPU logged (or none installed) → no section
  if (vals(pts, "gpu").length === 0) return null;
  const ready = pts.length >= 2;
  const fmtTime = fmtTimeFor(range);
  const temp = vals(pts, "gpuC");
  const tempPeak = peak(vals(pts, "gpuC", "max"));
  const w = vals(pts, "gpuW");
  const wMax = Math.max(10, ...series(pts, "gpuW", "max").map((p) => p.v)) * 1.1;

  return (
    <SectionShell title="gpu" className="gpu-section">
      <dl className="mb-5 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <KV k="Avg usage" v={pct(mean(vals(pts, "gpu")), 1)} />
        <KV k="Peak usage" v={pct(peak(vals(pts, "gpu", "max")))} />
        <KV k="Avg VRAM used" v={pct(mean(vals(pts, "gpuMem")), 1)} />
        <KV k="Peak VRAM used" v={pct(peak(vals(pts, "gpuMem", "max")))} />
        <KV
          k="Avg temperature"
          v={deg(mean(temp))}
          color={mean(temp) != null ? tempHeat(mean(temp)!) : undefined}
        />
        <KV
          k="Peak temperature"
          v={deg(tempPeak)}
          color={tempPeak != null ? tempHeat(tempPeak) : undefined}
        />
        <KV k="Avg power" v={watts(mean(w))} />
        <KV k="Peak power" v={watts(peak(vals(pts, "gpuW", "max")))} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <GraphBox title="Usage & temperature" ready={ready}>
          <HoverSparkline
            points={series(pts, "gpu")}
            points3={series(pts, "gpuC")}
            color={GPU_GREEN}
            color3={tempLineColor(temp[temp.length - 1] ?? 0)}
            keys={["usage", "", "temp"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fmt3={(v) => `${v.toFixed(0)}°`}
            max3={100}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="VRAM used" ready={ready}>
          <HoverSparkline
            points={series(pts, "gpuMem")}
            points2={series(pts, "gpuMem", "max")}
            color={GPU_GREEN}
            color2={GPU_GREEN}
            keys={["peak", "avg"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fillSecond={false}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        {w.length > 0 && (
          <GraphBox title="Power draw" ready={ready}>
            <HoverSparkline
              points={series(pts, "gpuW")}
              points2={series(pts, "gpuW", "max")}
              color={PSU_YELLOW}
              color2={PSU_YELLOW}
              keys={["peak", "avg"]}
              fmt={(v) => `${v.toFixed(0)} W`}
              max={wMax}
              fillSecond={false}
              fmtTime={fmtTime}
              grid
            />
          </GraphBox>
        )}
        <GraphBox title="Peak usage" ready={ready}>
          <HoverSparkline
            points={series(pts, "gpu", "max")}
            color={GPU_GREEN}
            keys={["peak"]}
            fmt={(v) => `${v.toFixed(0)}%`}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
      </div>
    </SectionShell>
  );
}

function PsuHistory({ pts, range }: { pts: HistPoint[]; range: RangeKey }) {
  const ready = pts.length >= 2;
  const fmtTime = fmtTimeFor(range);
  const lo = vals(pts, "wLo");
  const hi = vals(pts, "wHi");
  if (lo.length === 0) return null;
  const mid = pts.map((p) => ({
    t: p.t,
    ticks: p.ticks,
    w: p.avg.wLo != null && p.avg.wHi != null ? (p.avg.wLo + p.avg.wHi) / 2 : 0,
  }));
  // energy per bucket: average watts x seconds sampled → kWh
  const kwhPts = mid.map((p) => ({ t: p.t, v: (p.w * p.ticks) / 3_600_000 }));
  const kwhTotal = kwhPts.reduce((a, p) => a + p.v, 0);
  const seconds = mid.reduce((a, p) => a + p.ticks, 0);
  const avgMid = seconds ? (mid.reduce((a, p) => a + p.w * p.ticks, 0) / seconds) : null;
  const wMax = Math.max(60, ...series(pts, "wHi", "max").map((p) => p.v)) * 1.12;
  const kwhMax = Math.max(0.01, ...kwhPts.map((p) => p.v)) * 1.15;
  const perDay = seconds ? (kwhTotal / seconds) * 86_400 : null;

  return (
    <SectionShell title="psu" className="psu-section">
      <dl className="mb-5 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <KV k="Avg wall draw (est.)" v={watts(avgMid)} />
        <KV k="Peak wall draw (est.)" v={watts(peak(vals(pts, "wHi", "max")))} />
        <KV k="Lowest draw (est.)" v={watts(lo.length ? Math.min(...lo) : null)} />
        <KV k="Energy in range" v={`${kwhTotal.toFixed(kwhTotal < 10 ? 2 : 1)} kWh`} />
        <KV k="Avg energy / day" v={perDay != null ? `${perDay.toFixed(2)} kWh` : "—"} />
        <KV k="Avg range high" v={watts(mean(hi))} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <GraphBox title="Estimated wall power" ready={ready}>
          <HoverSparkline
            points={series(pts, "wHi")}
            points2={series(pts, "wLo")}
            color={PSU_YELLOW}
            color2={PSU_YELLOW}
            keys={["high", "low"]}
            fmt={(v) => `${v.toFixed(0)} W`}
            max={wMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Energy per period" ready={ready}>
          <HoverSparkline
            points={kwhPts}
            color={PSU_YELLOW}
            keys={["energy"]}
            fmt={(v) => `${v.toFixed(2)} kWh`}
            max={kwhMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
      </div>
    </SectionShell>
  );
}

function NetHistory({ pts, range }: { pts: HistPoint[]; range: RangeKey }) {
  if (vals(pts, "netRx").length === 0) return null;
  const ready = pts.length >= 2;
  const fmtTime = fmtTimeFor(range);
  // bytes moved per bucket: average rate x seconds sampled
  const bytes = (key: string) =>
    pts.map((p) => ({ t: p.t, v: (p.avg[key] ?? 0) * p.ticks }));
  const rxB = bytes("netRx");
  const txB = bytes("netTx");
  const rxTotal = rxB.reduce((a, p) => a + p.v, 0);
  const txTotal = txB.reduce((a, p) => a + p.v, 0);
  const rateMax =
    Math.max(1024, ...series(pts, "netRx", "max").map((p) => p.v), ...series(pts, "netTx", "max").map((p) => p.v)) * 1.1;
  const byteMax = Math.max(1024 ** 2, ...rxB.map((p) => p.v), ...txB.map((p) => p.v)) * 1.15;

  return (
    <SectionShell title="net" className="net-section">
      <dl className="mb-5 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <KV k="Downloaded in range" v={fmtBytes(rxTotal)} />
        <KV k="Uploaded in range" v={fmtBytes(txTotal)} />
        <KV k="Total transferred" v={fmtBytes(rxTotal + txTotal)} />
        <KV k="Avg download" v={fmtRate(mean(vals(pts, "netRx")))} />
        <KV k="Avg upload" v={fmtRate(mean(vals(pts, "netTx")))} />
        <KV
          k="Peak (down / up)"
          v={`${fmtRate(peak(vals(pts, "netRx", "max")))} / ${fmtRate(peak(vals(pts, "netTx", "max")))}`}
        />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <GraphBox title="Throughput (down / up)" ready={ready}>
          <HoverSparkline
            mirror
            points={series(pts, "netRx")}
            points2={series(pts, "netTx")}
            color={NET_PURPLE}
            color2="#e0c4ff"
            keys={["down", "up"]}
            fmt={(v) => fmtRate(v)}
            max={rateMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Data transferred per period" ready={ready}>
          <HoverSparkline
            mirror
            points={rxB}
            points2={txB}
            color={NET_PURPLE}
            color2="#e0c4ff"
            keys={["down", "up"]}
            fmt={(v) => fmtBytes(v)}
            max={byteMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
      </div>
    </SectionShell>
  );
}

function OsHistory({ pts, range }: { pts: HistPoint[]; range: RangeKey }) {
  const ready = pts.length >= 2;
  const fmtTime = fmtTimeFor(range);
  const up = vals(pts, "uptime", "max");
  // uptime that drops between buckets means the machine rebooted in between
  let reboots = 0;
  for (let i = 1; i < up.length; i++) if (up[i] < up[i - 1]) reboots++;
  const loadMax = Math.max(1, ...series(pts, "load1", "max").map((p) => p.v), ...series(pts, "load5").map((p) => p.v)) * 1.1;
  const procMax = Math.max(10, ...series(pts, "procs", "max").map((p) => p.v)) * 1.1;
  const stallPeak = Math.max(
    5,
    Math.ceil(
      Math.max(
        ...series(pts, "cpuStall", "max").map((p) => p.v),
        ...series(pts, "ioStall", "max").map((p) => p.v),
        0,
      ) * 1.2,
    ),
  );

  return (
    <SectionShell title="os" className="os-section">
      <dl className="mb-5 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <KV k="Uptime now" v={up.length ? fmtUptime(up[up.length - 1]) : "—"} />
        <KV k="Reboots in range" v={String(reboots)} />
        <KV k="Avg processes" v={mean(vals(pts, "procs"))?.toFixed(0) ?? "—"} />
        <KV k="Avg load (1 / 5 / 15 min)" v={`${mean(vals(pts, "load1"))?.toFixed(2) ?? "—"} / ${mean(vals(pts, "load5"))?.toFixed(2) ?? "—"} / ${mean(vals(pts, "load15"))?.toFixed(2) ?? "—"}`} />
        <KV k="Peak load (1 min)" v={peak(vals(pts, "load1", "max"))?.toFixed(2) ?? "—"} />
        <KV k="Peak CPU / IO stall" v={`${pct(peak(vals(pts, "cpuStall", "max")), 1)} / ${pct(peak(vals(pts, "ioStall", "max")), 1)}`} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <GraphBox title="Load average" ready={ready}>
          <HoverSparkline
            points={series(pts, "load1")}
            points3={series(pts, "load5")}
            color={CPU_BLUE}
            color3="#ffffff"
            keys={["1 min", "", "5 min"]}
            fmt={(v) => v.toFixed(2)}
            max={loadMax}
            max3={loadMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Processes" ready={ready}>
          <HoverSparkline
            points={series(pts, "procs")}
            color={CPU_BLUE}
            keys={["procs"]}
            fmt={(v) => v.toFixed(0)}
            max={procMax}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
        <GraphBox title="Pressure (CPU / IO stall)" ready={ready}>
          <HoverSparkline
            mirror
            points={series(pts, "cpuStall", "max")}
            points2={series(pts, "ioStall", "max")}
            color={CPU_BLUE}
            color2={SSD_RED}
            keys={["cpu", "io"]}
            fmt={(v) => `${v.toFixed(1)}%`}
            max={stallPeak}
            fmtTime={fmtTime}
            grid
          />
        </GraphBox>
      </div>
    </SectionShell>
  );
}

export default function PerfHistory() {
  const [range, setRange] = useCachedState<RangeKey>("perf:histRange", "7d");
  const [data, setData] = useCachedState<HistoryResponse | null>("perf:hist", null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/performance/history?range=${range}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: HistoryResponse) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [range, setData]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // don't flash the previous range's data under a new range's label
  const shown = data && data.range === range ? data : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {RANGE_LABELS.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`btn ${r.key === range ? "" : "btn-ghost"}`}
            title={`${r.hint} intervals`}
          >
            {r.label}
          </button>
        ))}
        <span className="text-xs text-ink-dim">
          {RANGE_LABELS.find((r) => r.key === range)?.hint} intervals
        </span>
      </div>

      {shown && <CpuHistory pts={shown.perf} range={range} />}
      {shown && <RamHistory pts={shown.perf} range={range} />}

      <section className="panel ssd-section p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <h2 className="sec-title">ssd</h2>
        </div>
        {failed && !shown ? (
          <p className="text-sm text-ink-dim">Couldn&apos;t load history.</p>
        ) : !shown ? (
          <p className="text-sm text-ink-dim">Loading…</p>
        ) : shown.ssd.length === 0 ? (
          <p className="text-sm text-ink-dim">
            No history yet — logging has just started. Data appears here as it
            accumulates.
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {shown.ssd.map((d) => (
              <DriveHistory key={d.dev} drive={d} range={range} />
            ))}
          </div>
        )}
      </section>

      {shown && <GpuHistory pts={shown.perf} range={range} />}
      {shown && <PsuHistory pts={shown.perf} range={range} />}
      {shown && <NetHistory pts={shown.perf} range={range} />}
      {shown && <OsHistory pts={shown.perf} range={range} />}
    </div>
  );
}

// byjohnmichael*
