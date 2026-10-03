// Per-component status derivation ("orb" states): load / heat / throttle
// pressure plus a status word, computed from a snapshot and recent history.

import type { FaceMood, OrbCategory, OrbReading } from "bob-the-orb";
import type { CpuSpec, GpuInfo, HistPoint, PerfResponse, PowerEstimate, Snapshot } from "./types";

/* ----------------------------------------------------------- CPU status orb */

export type RGB = [number, number, number];

// pastel palette — soft, glows on the near-black panel
export const ORB_CALM: RGB = [142, 230, 189]; // mint
export const ORB_LOAD: RGB = [247, 199, 130]; // peach / amber
export const ORB_HEAT: RGB = [245, 148, 125]; // coral
export const ORB_THROTTLE: RGB = [240, 118, 150]; // rose

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function rgbCss([r, g, b]: RGB, a = 1): string {
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}
export function mixRgb(parts: { c: RGB; w: number }[]): RGB {
  const tot = parts.reduce((s, p) => s + p.w, 0) || 1;
  const acc: RGB = [0, 0, 0];
  for (const p of parts) {
    const k = p.w / tot;
    acc[0] += p.c[0] * k;
    acc[1] += p.c[1] * k;
    acc[2] += p.c[2] * k;
  }
  return [Math.round(acc[0]), Math.round(acc[1]), Math.round(acc[2])];
}
export function shade([r, g, b]: RGB, amt: number): RGB {
  const t = Math.min(1, Math.abs(amt));
  const to = amt >= 0 ? 255 : 0;
  return [
    Math.round(r + (to - r) * t),
    Math.round(g + (to - g) * t),
    Math.round(b + (to - b) * t),
  ];
}

export function meanLast(nums: number[], n: number): number | null {
  const s = nums.slice(-n);
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null;
}

/** Ceiling for a sparkline's Y-axis, robust to a single outlier sample: a
 * plain Math.max over the window lets one bad instantaneous-rate reading
 * dominate the scale and squash every other point to the baseline until
 * that sample ages out of the window. Using the 98th percentile instead
 * means one spike can't do that, while sustained highs still scale up. */
export function robustMax(floor: number, ...series: number[][]): number {
  const values = series
    .flat()
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  if (values.length === 0) return floor;
  const idx = Math.min(values.length - 1, Math.floor(values.length * 0.98));
  return Math.max(floor, values[idx]);
}

export type OrbState = {
  loadP: number;
  heatP: number;
  throttleP: number;
  intensity: number;
  utilAvg: number;
  tempNow: number;
  freqMax: number;
  cand: string; // candidate status word
};

export function deriveOrb(
  s: Snapshot,
  hist: HistPoint[],
  cpuSpec: CpuSpec | null,
): OrbState {
  const utilAvg = meanLast(hist.map((p) => p.cpu), 8) ?? s.cpu.overall;
  const pkgAvg =
    meanLast(
      hist.map((p) => p.pkg ?? 0).filter((v) => v > 0),
      8,
    ) ??
    s.temp.packageC ??
    0;
  const hotspot = Math.max(
    0,
    ...s.cpu.perCore.map((c) => c.tempC ?? 0),
  );
  const tempNow = Math.max(pkgAvg, hotspot);

  const critC = s.temp.critC ?? 100;
  const warmT = Math.max(55, critC - 40); // ~60°C
  const fullT = critC - 8; // ~92°C
  const heatP = clamp01((tempNow - warmT) / (fullT - warmT));
  const loadP = clamp01(utilAvg / 100);

  const baseMhz = (cpuSpec?.baseGhz ?? 0) * 1000;
  const throttling =
    baseMhz > 0 &&
    tempNow >= warmT + 10 &&
    s.cpu.freqMaxMhz > 0 &&
    s.cpu.freqMaxMhz < baseMhz * 0.97;
  const throttleP = throttling ? 1 : 0;

  const contended =
    s.psi.cpu.some10 > 8 || s.cpu.runQueue > s.cpu.perThread.length + 1;
  const intensity = Math.max(loadP, heatP, throttleP);

  let cand: string;
  if (throttling) cand = "throttling";
  else if (tempNow >= fullT - 4 || heatP >= 0.9) cand = "hot";
  else if (contended && loadP > 0.5) cand = "contended";
  else if (utilAvg < 7) cand = "idle";
  else if (utilAvg < 35) cand = "light";
  else if (utilAvg < 70) cand = "working";
  else if (utilAvg < 92) cand = "busy";
  else cand = "maxed";

  return {
    loadP,
    heatP,
    throttleP,
    intensity,
    utilAvg,
    tempNow,
    freqMax: s.cpu.freqMaxMhz,
    cand,
  };
}

// RAM orb — reuses the CPU orb's body renderer / palette, but the three
// drivers map to memory stress:
//   loadP    fill pressure   (used, excluding reclaimable cache)
//   heatP    swap / stall    (swap in use, or the kernel stalling on memory)
//   throttleP thrash         (PSI "full" — everything waiting on memory)
export function deriveMemOrb(s: Snapshot, hist: HistPoint[]): OrbState {
  const fillAvg = meanLast(hist.map((p) => p.mem), 8) ?? s.mem.usedPct;
  const loadP = clamp01(fillAvg / 100);

  const swapFrac =
    s.mem.swapTotalBytes > 0 ? s.mem.swapUsedBytes / s.mem.swapTotalBytes : 0;
  const swapHeat = s.mem.swapUsedBytes > 0 ? 0.35 + 0.6 * clamp01(swapFrac) : 0;
  const stallHeat = clamp01(s.psi.memory.some10 / 10);
  const heatP = clamp01(Math.max(swapHeat, stallHeat));

  const thrash = s.psi.memory.full10 > 1;
  const throttleP = thrash ? 1 : 0;
  const intensity = Math.max(loadP, heatP, throttleP);

  let cand: string;
  if (thrash) cand = "thrashing";
  else if (s.psi.memory.some10 >= 5) cand = "stalling";
  else if (s.mem.swapUsedBytes > 0 && swapFrac > 0.05) cand = "swapping";
  else if (fillAvg >= 97) cand = "full";
  else if (fillAvg >= 90) cand = "critical";
  else if (fillAvg >= 75) cand = "heavy";
  else if (fillAvg >= 50) cand = "filling";
  else if (fillAvg >= 25) cand = "light";
  else cand = "idle";

  return {
    loadP,
    heatP,
    throttleP,
    intensity,
    utilAvg: fillAvg,
    tempNow: s.psi.memory.some10,
    freqMax: 0,
    cand,
  };
}

// SSD orb — same renderer, drivers mapped to storage stress:
//   loadP    drive activity (busy time)
//   heatP    drive temperature, or the kernel stalling on I/O
//   throttleP I/O saturation (PSI "full" — everything waiting on I/O)
export function deriveSsdOrb(s: Snapshot, hist: HistPoint[]): OrbState {
  const actAvg =
    meanLast(hist.map((p) => p.diskAct), 8) ?? s.disk?.utilPct ?? 0;
  const loadP = clamp01(actAvg / 100);

  const tempMax = Math.max(0, ...(s.disks ?? []).map((d) => d.tempC ?? 0));
  const tempHeatP = clamp01((tempMax - 50) / 30); // 50°C→0, 80°C→1
  const ioStall = clamp01(s.psi.io.some10 / 10);
  const heatP = clamp01(Math.max(tempHeatP, ioStall));

  const throttleP = s.psi.io.full10 > 1 ? 1 : 0;
  const intensity = Math.max(loadP, heatP, throttleP);

  let cand: string;
  if (throttleP) cand = "saturated";
  else if (ioStall >= 0.5) cand = "stalled";
  else if (tempMax >= 75) cand = "hot";
  else if (actAvg >= 80) cand = "busy";
  else if (actAvg >= 40) cand = "active";
  else if (actAvg >= 8) cand = "light";
  else cand = "idle";

  return {
    loadP,
    heatP,
    throttleP,
    intensity,
    utilAvg: actAvg,
    tempNow: tempMax,
    freqMax: 0,
    cand,
  };
}

// GPU orb — load = GPU utilisation, heat = core temp, throttle = the driver's
// clock-event reasons (thermal / power)
export function deriveGpuOrb(g: GpuInfo, hist: HistPoint[]): OrbState {
  const utilAvg = meanLast(hist.map((p) => p.gpu), 8) ?? g.utilPct;
  const loadP = clamp01(utilAvg / 100);

  const temp = g.tempC ?? 0;
  const heatP = clamp01((temp - 50) / 35); // 50°C→0, 85°C→1
  const throttleP = g.throttle ? 1 : 0;
  const intensity = Math.max(loadP, heatP, throttleP);

  let cand: string;
  if (g.throttle) cand = "throttling";
  else if (temp >= 84) cand = "hot";
  else if (utilAvg >= 92) cand = "maxed";
  else if (utilAvg >= 60) cand = "busy";
  else if (utilAvg >= 25) cand = "working";
  else if (utilAvg >= 4) cand = "light";
  else cand = "idle";

  return {
    loadP,
    heatP,
    throttleP,
    intensity,
    utilAvg,
    tempNow: temp,
    freqMax: g.clockSmMhz ?? 0,
    cand,
  };
}

// OS orb — load = 1-min load average per logical CPU; heat = scheduler /
// memory pressure stall (PSI)
export function deriveOsOrb(s: Snapshot, hist: HistPoint[], cores: number): OrbState {
  const l1Avg = meanLast(hist.map((p) => p.load1), 8) ?? s.load.load[0];
  const perCore = cores > 0 ? l1Avg / cores : l1Avg;
  const loadP = clamp01(perCore);

  const stall = Math.max(s.psi.cpu.some10, s.psi.memory.some10);
  const heatP = clamp01(stall / 20);
  const throttleP = s.psi.memory.full10 > 5 || s.sys.zombies > 8 ? 1 : 0;
  const intensity = Math.max(loadP, heatP, throttleP);

  let cand: string;
  if (stall >= 25) cand = "stalled";
  else if (perCore >= 1.5) cand = "overloaded";
  else if (perCore >= 1.0) cand = "loaded";
  else if (perCore >= 0.6) cand = "busy";
  else if (perCore >= 0.25) cand = "active";
  else cand = "idle";

  return {
    loadP,
    heatP,
    throttleP,
    intensity,
    utilAvg: perCore * 100,
    tempNow: stall,
    freqMax: 0,
    cand,
  };
}

// NET orb — load tracks combined throughput on a practical (non-link) scale
export function deriveNetOrb(net: Snapshot["net"], hist: HistPoint[]): OrbState {
  const cur = net ? net.rxBps + net.txBps : 0;
  const avg = meanLast(hist.map((p) => p.netRx + p.netTx), 8) ?? cur;
  const loadP = clamp01(avg / 20e6); // 20 MB/s → full colour
  let cand: string;
  if (avg < 40e3) cand = "idle";
  else if (avg < 1e6) cand = "light";
  else if (avg < 12e6) cand = "moderate";
  else if (avg < 60e6) cand = "busy";
  else cand = "saturated";
  return {
    loadP,
    heatP: 0,
    throttleP: 0,
    intensity: loadP,
    utilAvg: avg,
    tempNow: 0,
    freqMax: 0,
    cand,
  };
}

// PSU orb — load tracks the mid-point of the estimated wall-power range
export function derivePsuOrb(pw: PowerEstimate): OrbState {
  const mid = (pw.wallLo + pw.wallHi) / 2;
  const loadP = clamp01(mid / 300);
  const heatP = clamp01((mid - 200) / 200);
  let cand: string;
  if (mid < 55) cand = "idle";
  else if (mid < 110) cand = "light";
  else if (mid < 180) cand = "moderate";
  else if (mid < 280) cand = "busy";
  else cand = "heavy";
  return {
    loadP,
    heatP,
    throttleP: 0,
    intensity: Math.max(loadP, heatP),
    utilAvg: mid,
    tempNow: 0,
    freqMax: 0,
    cand,
  };
}

/**
 * Bob's reading: one glanceable summary built from the per-part orb states
 * above. Category colours match bob-the-orb's own example PC data source.
 */
export function bobReading(data: PerfResponse): OrbReading | null {
  const s = data.current;
  if (!s) return null;
  const h = data.history;
  const cpu = deriveOrb(s, h, data.meta?.cpuSpec ?? null);
  const mem = deriveMemOrb(s, h);
  const ssd = deriveSsdOrb(s, h);
  const net = deriveNetOrb(s.net, h);
  const gpu = s.gpu[0] ? deriveGpuOrb(s.gpu[0], h) : null;

  const categories: OrbCategory[] = [
    { id: "cpu", label: "CPU", color: [74, 200, 255], intensity: cpu.intensity, word: cpu.cand },
    { id: "ram", label: "RAM", color: [255, 149, 0], intensity: mem.intensity, word: mem.cand },
    { id: "ssd", label: "SSD", color: [255, 45, 85], intensity: ssd.intensity, word: ssd.cand },
    { id: "net", label: "Network", color: [191, 90, 242], intensity: net.intensity, word: net.cand },
  ];
  if (gpu) {
    categories.push({ id: "gpu", label: "GPU", color: [57, 255, 90], intensity: gpu.intensity, word: gpu.cand });
  }
  const heat = Math.max(cpu.heatP, mem.heatP, ssd.heatP, gpu?.heatP ?? 0);
  const throttle = Math.max(cpu.throttleP, mem.throttleP, ssd.throttleP, gpu?.throttleP ?? 0);
  const util = Math.max(cpu.loadP, mem.loadP, ssd.loadP, net.loadP, gpu?.loadP ?? 0);
  const mood: FaceMood =
    heat >= 0.88 || throttle >= 1
      ? "critical"
      : heat >= 0.62
        ? "hot"
        : throttle > 0 || util >= 0.93
          ? "struggling"
          : util >= 0.6
            ? "strained"
            : util < 0.07 && heat < 0.25
              ? "asleep"
              : util < 0.22
                ? "content"
                : "working";
  return { categories, mood };
}

// byjohnmichael*
