// Colours and formatting shared by the performance, monitor and Bob views.

/* ------------------------------------------------------------- formatting */

export const ACCENT = "#e01e37";
export const CPU_BLUE = "#4ac8ff"; // CPU section's scoped neon-blue accent
export const MEM_ORANGE = "#ff9e57"; // RAM section's scoped neon-orange accent
export const SSD_RED = "#ff5c72"; // SSD section's scoped lighter-neon-red accent
export const GPU_GREEN = "#5ef08a"; // GPU section's scoped lighter-neon-green accent
export const PSU_YELLOW = "#ffe14d"; // PSU section's scoped lighter-neon-yellow accent
export const PSU_FULL_W = 500; // 5 bolts span 0 → this (a typical desktop PSU size)
export const NET_PURPLE = "#c08cff"; // NET section's scoped lighter-neon-purple accent
export const AMBER = "#f5a524";
export const DANGER = "#ff5470";

export function loadColor(pct: number) {
  return pct >= 90 ? DANGER : pct >= 70 ? AMBER : ACCENT;
}

export function fmtBytes(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? digits : 0)} ${units[i]}`;
}
export function fmtRate(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps)) return "—";
  return `${fmtBytes(bps)}/s`;
}

/* ------------------------------------------------------------- primitives */

/* ----------------------------------------------------- CPU-panel helpers */

// green -> amber -> lighter red (distinct from the site's #e01e37 accent)
export function heatColor(pct: number): string {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  const stops: [number, number, number][] = [
    [34, 197, 94],
    [234, 179, 8],
    [255, 90, 95],
  ];
  const seg = p < 0.5 ? 0 : 1;
  const t = p < 0.5 ? p / 0.5 : (p - 0.5) / 0.5;
  const a = stops[seg];
  const b = stops[seg + 1];
  return `rgb(${a
    .map((v, i) => Math.round(v + (b[i] - v) * t))
    .join(", ")})`;
}

export function tempHeat(c: number | null): string {
  if (c == null) return "var(--ink-dim)";
  if (c < 60) return "#22c55e";
  if (c < 80) return "#eab308";
  return "#ff5a5f";
}

// smooth green→yellow→red ramp for a temperature history trace: 20°C reads
// cool/green, 60°C yellow, 100°C (the danger ceiling) full red
export function tempLineColor(c: number): string {
  const p = Math.max(0, Math.min(1, (c - 20) / 80));
  return heatColor(p * 100);
}

export function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function fmtMhz(mhz: number | null | undefined): string {
  if (mhz == null || !Number.isFinite(mhz) || mhz <= 0) return "—";
  return mhz >= 1000 ? `${(mhz / 1000).toFixed(2)} GHz` : `${Math.round(mhz)} MHz`;
}

export function pcieStr(gen: number | null, width: number | null): string {
  if (gen == null && width == null) return "—";
  return `Gen${gen ?? "?"} ×${width ?? "?"}`;
}

export function clockStr(cur: number | null, max: number | null): string {
  if (cur == null && max == null) return "—";
  if (max == null) return `${cur} MHz`;
  return `${cur ?? "?"} / ${max} MHz`;
}

// "12 W" when the band is tight, "12–28 W" when it's wide; sub-10 W keeps a
// decimal so small rails don't all collapse to "1 W"
export function fmtWRange(lo: number, hi: number): string {
  const r = (n: number) => (n < 10 ? n.toFixed(1) : `${Math.round(n)}`);
  return Math.abs(hi - lo) < 0.3
    ? `${r((lo + hi) / 2)} W`
    : `${r(lo)}–${r(hi)} W`;
}

export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// drive-health tint: healthy stays green, degrades through amber to red
export function healthColor(pct: number | null): string {
  if (pct == null) return "var(--ink-dim)";
  if (pct >= 90) return "#22c55e";
  if (pct >= 60) return "#eab308";
  return "#ff5a5f";
}

// 20 TPS is one tick per 50ms — that budget is the health baseline for both
// the tick-rate and tick-duration readings.
export function tpsColor(tps: number | null): string {
  if (tps == null) return "var(--ink-dim)";
  if (tps >= 19.5) return "#22c55e";
  if (tps >= 18) return "#eab308";
  return "#ff5a5f";
}
export function msptColor(ms: number | null): string {
  if (ms == null) return "var(--ink-dim)";
  if (ms <= 45) return "#22c55e";
  if (ms <= 50) return "#eab308";
  return "#ff5a5f";
}

// process state dot: R running, D uninterruptible I/O, Z zombie, T stopped
export function procStateColor(st: string): string {
  switch (st[0]) {
    case "R":
      return "#22c55e";
    case "D":
      return "#eab308";
    case "Z":
      return "#ff5470";
    case "T":
    case "t":
      return "#c08cff";
    default:
      return "var(--ink-dim)";
  }
}
export function procStateLabel(st: string): string {
  return (
    {
      R: "running",
      S: "sleeping",
      D: "disk wait",
      Z: "zombie",
      T: "stopped",
      t: "traced",
      I: "idle",
    }[st[0]] ?? st
  );
}

// byjohnmichael*
