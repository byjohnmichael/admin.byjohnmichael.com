"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCachedState } from "@/lib/useCachedState";
import { HtopMeter, SegMeter, Spinner } from "@/components/term";
import { HoverSparkline } from "@/components/perf/DotGraph";
import type {
  CpuLane,
  MemSlot,
  PerfResponse,
  PerfServer,
  Snapshot,
} from "@/lib/perf/types";
import {
  ACCENT,
  CPU_BLUE,
  GPU_GREEN,
  NET_PURPLE,
  PSU_FULL_W,
  PSU_YELLOW,
  SSD_RED,
  MEM_ORANGE,
  clockStr,
  fmtBytes,
  fmtCount,
  fmtMhz,
  fmtRate,
  fmtUptime,
  fmtWRange,
  healthColor,
  heatColor,
  loadColor,
  pcieStr,
  procStateColor,
  procStateLabel,
  tempHeat,
  tempLineColor,
} from "@/lib/perf/format";
import {
  ORB_CALM,
  ORB_HEAT,
  ORB_LOAD,
  ORB_THROTTLE,
  clamp01,
  type OrbState,
  deriveGpuOrb,
  deriveMemOrb,
  deriveNetOrb,
  deriveOrb,
  deriveOsOrb,
  derivePsuOrb,
  deriveSsdOrb,
  meanLast,
  mixRgb,
  rgbCss,
  robustMax,
  shade,
} from "@/lib/perf/orbs";

function Bar({ pct, color }: { pct: number; color?: string }) {
  return <SegMeter pct={pct} color={color ?? ACCENT} />;
}

function KV({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-dim">{k}</dt>
      <dd
        className="text-right tabular-nums"
        style={color ? { color } : undefined}
      >
        {v}
      </dd>
    </div>
  );
}


// faint etched textures for the CPU tiles — inline SVG, no external assets.
// cores get physical silicon circuitry (blocks, traces, vias); threads get a
// logical execution-flow motif (lanes, dots, arrows). Kept ~8-10% opacity via
// the wrapper so labels / colours / data are untouched.
const svgTexture = (svg: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const CORE_ETCH = svgTexture(
  `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='44' viewBox='0 0 44 44' fill='none' stroke='#fff' stroke-width='1'>
    <path d='M0 10H16M16 10V26M16 26H40M28 0V6M28 26V40M6 34H16'/>
    <rect x='4' y='13' width='9' height='7' rx='1'/>
    <rect x='30' y='6' width='9' height='8' rx='1'/>
    <circle cx='16' cy='10' r='1.4' fill='#fff' stroke='none'/>
    <circle cx='16' cy='26' r='1.4' fill='#fff' stroke='none'/>
    <circle cx='28' cy='26' r='1.4' fill='#fff' stroke='none'/>
  </svg>`,
);

// logical instruction flow rather than a texture: a few spaced traces of
// varying length, one branch, one direction arrow, a couple of nodes
const THREAD_ETCH = svgTexture(
  `<svg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 56 56' fill='none' stroke='#000' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'>
    <path d='M3 18H31'/>
    <path d='M27 15l4 3l-4 3'/>
    <path d='M37 18H53'/>
    <path d='M3 40H19l7 -9h12'/>
    <path d='M44 31h9'/>
    <path d='M34 40h19'/>
    <circle cx='34' cy='18' r='1.5' fill='#000' stroke='none'/>
    <circle cx='40' cy='31' r='1.5' fill='#000' stroke='none'/>
    <circle cx='30' cy='40' r='1.5' fill='#000' stroke='none'/>
  </svg>`,
);

// faint DRAM-chip row for the RAM sticks — a chip rectangle with a pin-1 mark
// and a contact-finger strip, tiled horizontally so it reads as chips in a row
const RAM_ETCH = svgTexture(
  `<svg xmlns='http://www.w3.org/2000/svg' width='44' height='40' viewBox='0 0 44 40' fill='none' stroke='#fff' stroke-width='1'>
    <rect x='7' y='6' width='30' height='22' rx='2'/>
    <circle cx='11' cy='10' r='1.3' fill='#fff' stroke='none'/>
    <path d='M5 33v5M11 33v5M17 33v5M23 33v5M29 33v5M35 33v5M41 33v5'/>
  </svg>`,
);

// core bars are a temperature gauge: fill level and colour both track the
// core's temperature (green → yellow → red), not its load
function CoreBar({ lane }: { lane: CpuLane }) {
  const [hover, setHover] = useState(false);
  const temp = lane.tempC;
  const gauge = temp == null ? 0 : clamp01((temp - 30) / 58) * 100; // 30°C→0, 88°C→100
  return (
    <div
      className="relative flex flex-1 flex-col items-center"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="relative h-28 w-full overflow-hidden rounded-sm bg-panel-border/50">
        <div
          className="absolute bottom-0 w-full"
          style={{
            height: `${gauge}%`,
            background:
              temp == null ? "var(--panel-border)" : tempLineColor(temp),
            transition: "height .5s ease, background .5s ease",
          }}
        />
        {/* etched silicon circuitry — physical-hardware feel, static */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: CORE_ETCH,
            backgroundSize: "44px 44px",
            opacity: 0.06,
          }}
        />
        <span
          className="absolute top-0.5 left-1 text-[10px] leading-none font-medium tabular-nums text-ink-dim"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
        >
          {lane.id}
        </span>
        {temp != null && (
          <span
            className="absolute top-0.5 right-1 text-[10px] leading-none font-semibold tabular-nums text-white"
            style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
          >
            {temp.toFixed(0)}°
          </span>
        )}
      </div>
      {hover && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap">
          <div className="font-medium">Core {lane.id}</div>
          <div className="text-ink-dim">
            {temp != null && `${temp.toFixed(0)}°C · `}
            {lane.pct.toFixed(0)}% load · {fmtMhz(lane.freqMhz)}
          </div>
          <div className="text-ink-dim">running: {lane.topProc || "—"}</div>
        </div>
      )}
    </div>
  );
}

function ThreadSquares({ threads }: { threads: CpuLane[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const n = threads.length;
  let cols = Math.ceil(Math.sqrt(n));
  while (cols < n && n % cols !== 0) cols++;
  if (cols >= n) cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const active = hi != null ? threads.find((t) => t.id === hi) : null;

  return (
    <div
      className="relative grid w-full gap-1.5"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        aspectRatio: `${cols} / ${rows}`,
      }}
    >
      {threads.map((t) => (
        <div
          key={t.id}
          className="relative flex items-center justify-center overflow-hidden rounded-sm text-[13px] font-bold tabular-nums"
          style={{ background: heatColor(t.pct), color: "#0a0a0d" }}
          onMouseEnter={() => setHi(t.id)}
          onMouseLeave={() => setHi(null)}
        >
          {/* etched execution lanes — logical instruction-flow feel; grows
              slightly more visible as the thread gets busier */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: THREAD_ETCH,
              backgroundSize: "56px 56px",
              opacity: 0.06 + 0.06 * clamp01(t.pct / 100),
            }}
          />
          <span className="absolute top-0.5 left-1 text-[9px] font-semibold opacity-60">
            {t.id}
          </span>
          <span className="relative">{t.pct.toFixed(0)}%</span>
        </div>
      ))}
      {active && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap">
          <div className="font-medium">CPU {active.id}</div>
          <div className="text-ink-dim">
            {active.pct.toFixed(0)}% · {fmtMhz(active.freqMhz)}
            {active.tempC != null && ` · ${active.tempC.toFixed(0)}°C`}
          </div>
          <div className="text-ink-dim">running: {active.topProc || "—"}</div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- RAM slots */

// "ChannelA-DIMM1" -> "A1", "DIMM_A2" -> "A2", else a trailing token / index
function shortSlot(locator: string, index: number): string {
  const ch = /Channel\s*([A-Z])/i.exec(locator)?.[1];
  const num =
    /DIMM\s*[_-]?\s*([A-Z]?\d+)/i.exec(locator)?.[1] ??
    /(\d+)\s*$/.exec(locator)?.[1];
  if (ch && num) return `${ch}${num}`.toUpperCase();
  if (num) return String(num).toUpperCase();
  return (
    locator.split(/[-_ ]/).pop()?.slice(0, 4).toUpperCase() || `#${index + 1}`
  );
}

function gbLabel(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

// one DIMM slot drawn as a stick: dashed outline + "empty" when unpopulated;
// populated shows an orange outline, capacity in the middle, slot id top-left,
// and — when the module has a thermal sensor — the temperature top-right, that
// number alone tinted by heat (green → yellow → red).
function RamStick({ slot, tempC }: { slot: MemSlot; tempC: number | null }) {
  const [hover, setHover] = useState(false);

  return (
    <div
      className="relative min-h-[2.25rem] flex-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[3px]"
        style={{
          border: `1.5px ${slot.present ? "solid" : "dashed"} ${
            slot.present ? MEM_ORANGE : "var(--panel-border)"
          }`,
          background: slot.present ? "rgba(255,158,87,0.04)" : "transparent",
        }}
      >
        {/* faint etched DRAM chips — only on a populated stick */}
        {slot.present && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: RAM_ETCH,
              backgroundSize: "44px 100%",
              opacity: 0.1,
            }}
          />
        )}

        {/* gold contact edge — the "pins" that make it read as a stick */}
        <div
          className="absolute inset-x-0 bottom-0 h-[3px]"
          style={{
            background: slot.present ? "#b98a3c" : "var(--panel-border)",
            opacity: slot.present ? 0.9 : 0.4,
          }}
        />

        <span
          className="absolute top-1 left-1.5 text-[9px] leading-none font-medium tabular-nums text-ink-dim"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.85)" }}
        >
          {shortSlot(slot.locator, slot.index)}
        </span>
        {slot.present && tempC != null && (
          <span
            className="absolute top-1 right-1.5 text-[10px] leading-none font-semibold tabular-nums"
            style={{
              color: tempHeat(tempC),
              textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            }}
          >
            {tempC.toFixed(0)}°
          </span>
        )}

        <span
          className={`relative text-xs font-semibold tracking-tight tabular-nums ${
            slot.present ? "text-ink" : "text-ink-dim"
          }`}
          style={
            slot.present ? { textShadow: "0 1px 3px rgba(0,0,0,0.9)" } : undefined
          }
        >
          {slot.present ? gbLabel(slot.sizeBytes) : "empty"}
        </span>
      </div>

      {hover && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap">
          <div className="font-medium">{slot.locator}</div>
          {slot.present ? (
            <>
              <div className="text-ink-dim">
                {gbLabel(slot.sizeBytes)}
                {slot.type && ` · ${slot.type}`}
                {slot.speed && ` · ${slot.speed}`}
              </div>
              {(slot.manufacturer || slot.partNumber) && (
                <div className="text-ink-dim">
                  {slot.manufacturer || "unknown"}
                  {slot.partNumber && ` ${slot.partNumber}`}
                </div>
              )}
              <div className="text-ink-dim">
                {tempC != null ? `${tempC.toFixed(0)}°C` : "no thermal sensor"}
              </div>
            </>
          ) : (
            <div className="text-ink-dim">unpopulated slot</div>
          )}
        </div>
      )}
    </div>
  );
}

function RamSlots({
  slots,
  dimmC,
}: {
  slots: MemSlot[];
  dimmC: (number | null)[];
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {slots.map((s) => (
        <RamStick key={s.index} slot={s} tempC={dimmC[s.index] ?? null} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- SSD models */

// one physical drive drawn as a module: consistent neon-red outline, capacity
// used / max centred, model name below it, temperature top-right (that number
// alone tinted by heat), and a left-to-right bar showing how full it is.
function SsdModel({ drive }: { drive: Snapshot["disks"][number] }) {
  const [hover, setHover] = useState(false);
  const cap = drive.capacityBytes;
  const used = drive.fsUsedBytes;
  const pct = cap ? Math.max(0, Math.min(100, (used / cap) * 100)) : 0;
  const gb = (b: number) => b / 1024 ** 3;
  const kind = drive.rotational
    ? "HDD"
    : drive.dev.startsWith("nvme")
      ? "NVMe SSD"
      : "SATA SSD";
  const shortModel =
    drive.model
      .replace(/\s+with heatsink/i, "")
      .replace(/\s{2,}/g, " ")
      .trim() || drive.dev;

  return (
    <div
      className="relative min-h-[5.5rem] flex-1"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        className="relative flex h-full w-full flex-col justify-center overflow-hidden rounded-[4px] px-3 py-3"
        style={{
          border: `1.5px solid ${SSD_RED}`,
          background: "rgba(255,92,114,0.04)",
        }}
      >
        {/* used space — the whole drive body fills from the left up to `pct` */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, background: heatColor(pct), opacity: 0.16 }}
        />
        {/* the fill boundary — everything left of this line is in use */}
        <div
          className="pointer-events-none absolute inset-y-0"
          style={{
            left: `${pct}%`,
            width: "1.5px",
            background: heatColor(pct),
            boxShadow: `0 0 6px ${heatColor(pct)}`,
          }}
        />

        {/* faint etched M.2 detail — mount hole, controller chip, traces and
            the gold edge-connector teeth, so the card reads as a drive */}
        <svg
          viewBox="0 0 240 90"
          preserveAspectRatio="none"
          fill="none"
          stroke="#fff"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full"
          style={{ opacity: 0.09 }}
        >
          <circle cx="15" cy="45" r="4" />
          <rect x="30" y="16" width="150" height="58" rx="5" />
          <path d="M48 45h114" />
          <path d="M182 30h26M182 40h26M182 55h26M182 65h26" />
          <path d="M214 20v18M222 20v18M230 20v18M214 52v18M222 52v18M230 52v18" />
        </svg>

        {drive.tempC != null && (
          <span
            className="absolute top-1.5 right-2 text-[11px] leading-none font-semibold tabular-nums"
            style={{
              color: tempHeat(drive.tempC),
              textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            }}
          >
            {drive.tempC.toFixed(0)}°C
          </span>
        )}

        <div className="relative text-center text-lg leading-none font-semibold tabular-nums text-ink">
          {gb(used).toFixed(0)}
          <span className="text-ink-dim"> / {gb(cap).toFixed(0)} GB</span>
        </div>
        <div className="relative mt-1 truncate text-center text-[11px] leading-none text-ink-dim">
          {shortModel}
        </div>

        {/* fill percentage — bottom-right corner */}
        <span
          className="absolute right-2 bottom-1.5 text-[11px] leading-none font-semibold tabular-nums"
          style={{
            color: heatColor(pct),
            textShadow: "0 1px 2px rgba(0,0,0,0.9)",
          }}
        >
          {pct.toFixed(0)}%
        </span>
      </div>

      {hover && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 -translate-x-1/2 rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap">
          <div className="font-medium">{drive.model}</div>
          <div className="text-ink-dim">
            {fmtBytes(used)} used / {fmtBytes(cap)} · {pct.toFixed(0)}% full
          </div>
          <div className="text-ink-dim">
            {fmtRate(drive.readBps)} read · {fmtRate(drive.writeBps)} write ·{" "}
            {drive.utilPct.toFixed(0)}% busy
          </div>
          <div className="text-ink-dim">
            {drive.dev} · {kind}
            {drive.tempC != null
              ? ` · ${drive.tempC.toFixed(0)}°C`
              : " · no thermal sensor"}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- wattage bolts */

const WATT_FULL = 65; // ≈ CPU package TDP — the bolts span 0 → this
const WATT_FULL_DRAM = 10; // one bolt, full at 10 W of DRAM draw

// htop-style [|||   ] meter in PSU yellow, full at `full` watts
function WattBolts({
  watts,
  full = WATT_FULL,
  count = 3,
}: {
  watts: number | null;
  full?: number;
  count?: number;
}) {
  const pct = watts == null ? 0 : (watts / full) * 100;
  // wattage is always PSU yellow, whichever section it appears in
  return <HtopMeter pct={pct} width={4 + count * 3} color={PSU_YELLOW} />;
}

function CpuOrb({
  orb,
  size = 44,
}: {
  orb: OrbState;
  size?: number;
}) {
  const { loadP, heatP, throttleP } = orb;

  // weighted mix drives the orb's actual body colour (not just overlay blobs).
  // heat outranks load: as heat rises it eats into load's share. Calm keeps a
  // floor so green always shows through a little.
  const heatW = Math.max(heatP, throttleP);
  const loadW = loadP * (1 - 0.55 * heatW);
  const calmW = Math.max(0.15, 1 - loadW - heatW);
  const heatCol = throttleP > 0 ? ORB_THROTTLE : ORB_HEAT;

  const base = mixRgb([
    { c: ORB_CALM, w: calmW },
    { c: ORB_LOAD, w: loadW },
    { c: heatCol, w: heatW },
  ]);
  const intensity = Math.max(loadP, heatW);
  const glow = rgbCss(shade(base, 0.06), 0.45 + 0.4 * intensity);

  // a braille spinner in the orb's colour mix — spins faster under load
  return (
    <Spinner
      load={intensity}
      color={rgbCss(shade(base, 0.15))}
      glow={glow}
      size={Math.round(size * 0.5)}
    />
  );
}

/* ------------------------------------------------------------------ page */

export default function PerformancePage() {
  const [data, setData] = useCachedState<PerfResponse | null>("perf:data", null);
  const [failed, setFailed] = useState(false);
  const [orbWord, setOrbWord] = useState("idle");
  const orbDwell = useRef({ cand: "idle", since: 0 });
  const [memWord, setMemWord] = useState("idle");
  const memDwell = useRef({ cand: "idle", since: 0 });
  const [ssdWord, setSsdWord] = useState("idle");
  const ssdDwell = useRef({ cand: "idle", since: 0 });
  const [gpuWord, setGpuWord] = useState("idle");
  const gpuDwell = useRef({ cand: "idle", since: 0 });
  const [psuWord, setPsuWord] = useState("idle");
  const psuDwell = useRef({ cand: "idle", since: 0 });
  const [netWord, setNetWord] = useState("idle");
  const netDwell = useRef({ cand: "idle", since: 0 });
  const [osWord, setOsWord] = useState("idle");
  const osDwell = useRef({ cand: "idle", since: 0 });
  const [servers, setServers] = useCachedState<PerfServer[]>("perf:servers", []);
  const [srvBusy, setSrvBusy] = useState<string | null>(null);
  const [procSort, setProcSort] = useState<{
    key: "rss" | "cpu" | "pid" | "name" | "user";
    dir: 1 | -1;
  }>({ key: "rss", dir: -1 });
  const [killBusy, setKillBusy] = useState<number | null>(null);
  const [procsExpanded, setProcsExpanded] = useState(false);
  const [procQuery, setProcQuery] = useState("");
  const [allProcs, setAllProcs] = useCachedState<Snapshot["procs"]>("perf:procs", []);

  const loadAllProcs = useCallback(() => {
    fetch("/api/system/processes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.procs && setAllProcs(d.procs))
      .catch(() => {});
  }, []);

  // pull the full list whenever the section is expanded OR a search is active
  const procsFull = procsExpanded || procQuery.trim().length > 0;
  useEffect(() => {
    if (!procsFull) return;
    loadAllProcs();
    const id = setInterval(loadAllProcs, 4000);
    return () => clearInterval(id);
  }, [procsFull, loadAllProcs]);

  const sortProc = useCallback((key: typeof procSort.key) => {
    setProcSort((cur) =>
      cur.key === key
        ? { key, dir: (cur.dir * -1) as 1 | -1 }
        : { key, dir: key === "name" || key === "user" ? 1 : -1 },
    );
  }, []);

  const killProc = useCallback(async (pid: number, name: string) => {
    if (!window.confirm(`Kill ${name} (PID ${pid})? It will be sent SIGTERM.`)) {
      return;
    }
    setKillBusy(pid);
    try {
      const r = await fetch("/api/system/kill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => null);
        window.alert(d?.error ?? "Kill failed.");
      }
    } finally {
      setTimeout(() => setKillBusy(null), 1200);
    }
  }, []);

  const loadServers = useCallback(() => {
    fetch("/api/system/servers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.servers && setServers(d.servers))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadServers();
    const id = setInterval(loadServers, 5000);
    return () => clearInterval(id);
  }, [loadServers]);

  const serverAction = useCallback(
    async (key: string, label: string, action: "start" | "stop") => {
      if (
        action === "stop" &&
        !window.confirm(
          `Stop ${label}? Any connected users will be dropped.` +
            (key === "wow" ? " Check no players are online first." : ""),
        )
      ) {
        return;
      }
      setSrvBusy(key);
      try {
        await fetch("/api/system/servers", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ key, action }),
        });
      } finally {
        setSrvBusy(null);
        loadServers();
        setTimeout(loadServers, 2500);
      }
    },
    [loadServers],
  );

  const load = useCallback(() => {
    fetch("/api/performance")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: PerfResponse) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [load]);

  // status word: candidate must hold ~4s before it commits (heat/throttle jump
  // immediately), so the label doesn't chatter between polls
  useEffect(() => {
    if (!data?.current) return;
    const cand = deriveOrb(
      data.current,
      data.history,
      data.meta?.cpuSpec ?? null,
    ).cand;
    const now = Date.now();
    const d = orbDwell.current;
    if (cand !== d.cand) {
      d.cand = cand;
      d.since = now;
    }
    const jump = cand === "throttling" || cand === "hot";
    setOrbWord((cur) =>
      cand !== cur && (jump || now - d.since >= 4000) ? cand : cur,
    );
  }, [data]);

  // same dwell treatment for the RAM orb's status word
  useEffect(() => {
    if (!data?.current) return;
    const cand = deriveMemOrb(data.current, data.history).cand;
    const now = Date.now();
    const d = memDwell.current;
    if (cand !== d.cand) {
      d.cand = cand;
      d.since = now;
    }
    const jump = cand === "thrashing" || cand === "stalling";
    setMemWord((cur) =>
      cand !== cur && (jump || now - d.since >= 4000) ? cand : cur,
    );
  }, [data]);

  // same dwell treatment for the SSD orb's status word
  useEffect(() => {
    if (!data?.current) return;
    const cand = deriveSsdOrb(data.current, data.history).cand;
    const now = Date.now();
    const d = ssdDwell.current;
    if (cand !== d.cand) {
      d.cand = cand;
      d.since = now;
    }
    const jump = cand === "saturated" || cand === "stalled" || cand === "hot";
    setSsdWord((cur) =>
      cand !== cur && (jump || now - d.since >= 4000) ? cand : cur,
    );
  }, [data]);

  // same dwell treatment for the GPU orb's status word
  useEffect(() => {
    if (!data?.current?.gpu?.[0]) return;
    const cand = deriveGpuOrb(data.current.gpu[0], data.history).cand;
    const now = Date.now();
    const d = gpuDwell.current;
    if (cand !== d.cand) {
      d.cand = cand;
      d.since = now;
    }
    const jump = cand === "throttling" || cand === "hot";
    setGpuWord((cur) =>
      cand !== cur && (jump || now - d.since >= 4000) ? cand : cur,
    );
  }, [data]);

  // same dwell treatment for the PSU orb's status word
  useEffect(() => {
    if (!data?.current?.power) return;
    const cand = derivePsuOrb(data.current.power).cand;
    const now = Date.now();
    const d = psuDwell.current;
    if (cand !== d.cand) {
      d.cand = cand;
      d.since = now;
    }
    setPsuWord((cur) =>
      cand !== cur && now - d.since >= 4000 ? cand : cur,
    );
  }, [data]);

  // same dwell treatment for the NET orb's status word
  useEffect(() => {
    if (!data?.current) return;
    const cand = deriveNetOrb(data.current.net, data.history).cand;
    const now = Date.now();
    const d = netDwell.current;
    if (cand !== d.cand) {
      d.cand = cand;
      d.since = now;
    }
    setNetWord((cur) =>
      cand !== cur && now - d.since >= 4000 ? cand : cur,
    );
  }, [data]);

  // same dwell treatment for the OS orb's status word
  useEffect(() => {
    if (!data?.current) return;
    const cores = data.meta?.logical ?? data.current.cpu.perThread.length ?? 1;
    const cand = deriveOsOrb(data.current, data.history, cores).cand;
    const now = Date.now();
    const d = osDwell.current;
    if (cand !== d.cand) {
      d.cand = cand;
      d.since = now;
    }
    const jump = cand === "stalled" || cand === "overloaded";
    setOsWord((cur) =>
      cand !== cur && (jump || now - d.since >= 4000) ? cand : cur,
    );
  }, [data]);

  if (failed && !data) {
    return (
      <div className="panel p-8 text-ink-dim">
        <p>Couldn&apos;t load performance data.</p>
        <button className="btn btn-ghost mt-4" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  if (!data || !data.current) {
    return (
      <div className="panel p-8 text-sm text-ink-dim">
        Sampler warming up…
      </div>
    );
  }

  const { current: s, history: h, meta } = data;
  const logical = meta?.logical ?? s.cpu.perThread.length ?? 1;
  const cpuSpec = meta?.cpuSpec ?? null;
  const cpuModelClean = (cpuSpec?.model || meta?.cpuModel || "CPU")
    .replace(/\s*@\s*[\d.]+\s*GHz\s*$/i, "")
    .trim();
  const u = s.cpu.util;
  const baseFreq = cpuSpec?.baseGhz
    ? `${cpuSpec.baseGhz.toFixed(2)} GHz`
    : "—";
  const l1Str =
    cpuSpec?.l1d && cpuSpec?.l1i
      ? `${cpuSpec.l1d} data + ${cpuSpec.l1i} instr`
      : cpuSpec?.l1d || "—";

  const orb = deriveOrb(s, h, cpuSpec);

  const cpuPoints = h.map((p) => ({ t: p.t, v: p.cpu }));
  const cpuTempPoints = h.map((p) => ({ t: p.t, v: p.pkg ?? 0 }));
  // colour of the temp trace tracks the latest package temp: green → yellow → red
  const cpuTempNow =
    s.temp.packageC ??
    meanLast(
      h.map((p) => p.pkg ?? 0).filter((v) => v > 0),
      5,
    ) ??
    0;
  const memPoints = h.map((p) => ({ t: p.t, v: p.mem }));
  const memAppPoints = h.map((p) => ({ t: p.t, v: p.memApp }));
  const memOrb = deriveMemOrb(s, h);
  const memSpec = meta?.memSpec ?? null;
  const memSlots = memSpec?.slots ?? [];
  const dimmC = s.temp.dimmC ?? [];
  const disks = s.disks ?? [];
  const ssdTotalMax = disks.reduce((a, d) => a + d.capacityBytes, 0);
  const ssdTotalUsed = disks.reduce((a, d) => a + d.fsUsedBytes, 0);
  const ssdPct = ssdTotalMax ? (ssdTotalUsed / ssdTotalMax) * 100 : 0;
  const ssdReadPoints = h.map((p) => ({ t: p.t, v: p.diskR }));
  const ssdWritePoints = h.map((p) => ({ t: p.t, v: p.diskW }));
  const ssdTempPoints = h.map((p) => ({ t: p.t, v: p.nvmeC ?? 0 }));
  const ssdTempNow =
    s.temp.nvmeC ??
    meanLast(
      h.map((p) => p.nvmeC ?? 0).filter((v) => v > 0),
      5,
    ) ??
    0;
  const ssdGraphMax = robustMax(
    1,
    ssdReadPoints.map((p) => p.v),
    ssdWritePoints.map((p) => p.v),
  );
  const ssdOrb = deriveSsdOrb(s, h);
  const ssdAct = s.disk?.utilPct ?? 0;
  const netDownPoints = h.map((p) => ({ t: p.t, v: p.netRx }));
  const netUpPoints = h.map((p) => ({ t: p.t, v: p.netTx }));
  const netNow = s.net ? s.net.rxBps + s.net.txBps : 0;
  const netGraphMax = robustMax(
    1024,
    netDownPoints.map((p) => p.v),
    netUpPoints.map((p) => p.v),
  );
  const netLinkBps = (meta?.net?.speedMbps ?? 0) * 125_000; // Mbps → bytes/s
  const netLinkPct = netLinkBps ? (netNow / netLinkBps) * 100 : 0;
  const netKind = /^w/i.test(meta?.net?.iface ?? "") ? "WiFi" : "Ethernet";
  const netOrb = deriveNetOrb(s.net, h);

  const osOrb = deriveOsOrb(s, h, logical);
  const osLoad1 = s.load.load[0];
  const os = meta?.os ?? null;

  const procCols: { k: typeof procSort.key; label: string; right?: boolean }[] = [
    { k: "name", label: "Process" },
    { k: "user", label: "User" },
    { k: "pid", label: "PID" },
    { k: "cpu", label: "CPU", right: true },
    { k: "rss", label: "RAM", right: true },
  ];
  const procSortVal = (p: Snapshot["procs"][number]): number | string =>
    procSort.key === "rss"
      ? p.rssBytes
      : procSort.key === "cpu"
        ? p.cpuPct
        : procSort.key === "pid"
          ? p.pid
          : procSort.key === "name"
            ? p.name.toLowerCase()
            : p.user.toLowerCase();
  const procSource =
    procsFull && allProcs.length ? allProcs : s.procs ?? [];
  const procQ = procQuery.trim().toLowerCase();
  const filteredProcs = procQ
    ? procSource.filter(
        (p) =>
          p.name.toLowerCase().includes(procQ) ||
          p.user.toLowerCase().includes(procQ) ||
          String(p.pid).includes(procQ) ||
          p.cmd.toLowerCase().includes(procQ),
      )
    : procSource;
  const sortedProcs = [...filteredProcs].sort((a, b) => {
    const av = procSortVal(a);
    const bv = procSortVal(b);
    return (av < bv ? -1 : av > bv ? 1 : 0) * procSort.dir;
  });
  const procsScroll = procsExpanded || procQ.length > 0;
  const shownProcs = procsScroll ? sortedProcs : sortedProcs.slice(0, 10);
  const gpus = s.gpu ?? [];
  const g0 = gpus[0] ?? null;
  const gpuUtilPoints = h.map((p) => ({ t: p.t, v: p.gpu }));
  const gpuTempPoints = h.map((p) => ({ t: p.t, v: p.gpuTempC ?? 0 }));
  const gpuTempNow =
    g0?.tempC ??
    meanLast(
      h.map((p) => p.gpuTempC ?? 0).filter((v) => v > 0),
      5,
    ) ??
    0;
  const gpuOrb = g0 ? deriveGpuOrb(g0, h) : null;
  const vramTotal = g0?.memTotalBytes ?? 0;
  const vramUsed = g0?.memUsedBytes ?? 0;
  const vramPct = vramTotal ? (vramUsed / vramTotal) * 100 : 0;

  const pw = s.power ?? null;
  const gpuPwr = pw?.items.find((i) => i.key === "gpu") ?? null;
  // real draw when the card reports it, otherwise the PSU model's GPU estimate
  const gpuWatts =
    g0?.powerDrawW ?? (gpuPwr ? (gpuPwr.lo + gpuPwr.hi) / 2 : null);
  const psuLoPoints = h.map((p) => ({ t: p.t, v: p.estWLo }));
  const psuHiPoints = h.map((p) => ({ t: p.t, v: p.estWHi }));
  const psuGraphMax =
    Math.max(60, ...psuHiPoints.map((p) => p.v)) * 1.12;
  const psuOrb = pw ? derivePsuOrb(pw) : null;


  return (
      <div className="grid gap-6 lg:grid-cols-2">
      {/* ------------------------------------------------------------- CPU */}
      <section className="panel cpu-section p-6 lg:col-span-2">
        <div className="group mb-4 flex items-center gap-3">
          <h2 className="sec-title">cpu</h2>
          <div className="relative ml-auto flex items-center gap-2.5">
            <span
              role="status"
              aria-live="polite"
              className="text-sm font-medium text-ink-dim"
            >
              {orbWord}
            </span>
            <CpuOrb orb={orb} />
            <div className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap tabular-nums group-hover:block">
              {orb.utilAvg.toFixed(0)}% · {orb.tempNow.toFixed(0)}°C ·{" "}
              {fmtMhz(orb.freqMax)} → {orbWord}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
          {/* big % + clock, graph (flexes), core bars — ~2/3 */}
          <div className="flex flex-col lg:w-2/3">
            <div className="mb-3 flex shrink-0 items-end justify-between gap-4">
              <div className="text-4xl leading-none font-semibold tabular-nums">
                {s.cpu.overall.toFixed(0)}
                <span className="text-xl text-ink-dim">%</span>
                {s.temp.packageC != null && (
                  <sup
                    className="ml-1 align-super text-base font-medium"
                    style={{ color: tempHeat(s.temp.packageC) }}
                  >
                    {s.temp.packageC.toFixed(0)}°
                  </sup>
                )}
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold tabular-nums">
                  {fmtMhz(s.cpu.freqMaxMhz)}
                </div>
                <div className="text-xs text-ink-dim">current clock</div>
              </div>
            </div>

            {/* graph absorbs the slack so the core bars' bottom lands exactly
                on the (square) thread grid's bottom */}
            <div className="flex min-h-[7rem] flex-1 flex-col">
              <HoverSparkline
                points={cpuPoints}
                points3={cpuTempPoints}
                color={CPU_BLUE}
                color3={tempLineColor(cpuTempNow)}
                keys={["usage", "", "temp"]}
                fmt={(v) => `${v.toFixed(0)}%`}
                fmt3={(v) => `${v.toFixed(0)}°`}
                max3={100}
                grid
              />
            </div>

            <div className="mt-4 mb-1.5 shrink-0 text-xs font-medium tracking-wide text-ink-dim uppercase">
              Core temperatures
            </div>
            <div className="flex shrink-0 items-end gap-1.5">
              {s.cpu.perCore.map((c) => (
                <CoreBar key={c.id} lane={c} />
              ))}
            </div>
          </div>

          {/* hardware threads — ~1/3; square grid drives the row height, and
              sits at the bottom so its bottom edge matches the core bars' */}
          <div className="flex flex-col lg:w-1/3">
            {/* wattage — sits beside the clock; frees the space above the graph
                so the threads label can align to the graph's top edge */}
            <div className="mb-3 flex min-h-[2.75rem] shrink-0 items-end justify-between gap-3">
              <div className="flex items-end gap-2">
                <span className="text-base font-bold text-ink">Wattage</span>
                <WattBolts watts={s.cpu.packageWatts} />
              </div>
              <span className="text-2xl leading-none font-bold tabular-nums">
                {s.cpu.packageWatts != null
                  ? `${s.cpu.packageWatts.toFixed(0)} W`
                  : "—"}
              </span>
            </div>
            {/* boxed threads — the card spans the full height, from the graph's
                top edge down to the bottom of the core bars */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-1 flex-col rounded-md border border-panel-border bg-panel-border/10 p-3">
                <div className="mb-2 text-[13px] font-bold tracking-wide text-ink uppercase">
                  Hardware threads usage
                </div>
                <ThreadSquares threads={s.cpu.perThread} />
              </div>
            </div>
          </div>
        </div>

        {/* three columns */}
        <div className="mt-6 grid gap-6 border-t border-panel-border pt-5 sm:grid-cols-3">
          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
              Utilizations
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <KV k="User" v={`${u.user.toFixed(1)}%`} />
              <KV k="System" v={`${u.system.toFixed(1)}%`} />
              <KV k="Idle" v={`${u.idle.toFixed(1)}%`} />
              <KV k="I/O wait" v={`${u.iowait.toFixed(1)}%`} />
              <KV k="IRQ" v={`${u.irq.toFixed(1)}%`} />
              <KV k="SoftIRQ" v={`${u.softirq.toFixed(1)}%`} />
              <KV k="Steal" v={`${u.steal.toFixed(1)}%`} />
            </dl>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
              Frequency
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <KV k="Minimum" v={fmtMhz(s.cpu.freqMinMhz ?? cpuSpec?.minMhz)} />
              <KV k="Base" v={baseFreq} />
              <KV k="Maximum" v={fmtMhz(cpuSpec?.maxMhz ?? s.cpu.freqMaxMhz)} />
              <KV
                k="Boost"
                v={
                  s.cpu.boost == null
                    ? "—"
                    : s.cpu.boost
                      ? "Enabled"
                      : "Disabled"
                }
              />
              <KV k="Instructions/sec" v={fmtCount(s.cpu.ipsPerSec)} />
              <KV k="CPU cycles/sec" v={fmtCount(s.cpu.cyclesPerSec)} />
              <KV
                k="IPC"
                v={s.cpu.ipc == null ? "—" : s.cpu.ipc.toFixed(2)}
              />
            </dl>
            {s.cpu.ipc == null && (
              <p className="mt-1.5 text-[11px] text-ink-dim">
                install <code className="text-ink">perf</code> for IPC / cycles
              </p>
            )}
          </div>

          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
              Hardware Specifications
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <KV k="CPU model" v={cpuModelClean} />
              <KV k="Architecture" v={cpuSpec?.arch ?? "—"} />
              <KV k="Virtualization" v={cpuSpec?.virtualization ?? "—"} />
              <KV
                k="Family / model / step"
                v={
                  cpuSpec &&
                  (cpuSpec.family != null ||
                    cpuSpec.modelId != null ||
                    cpuSpec.stepping != null)
                    ? `${cpuSpec.family ?? "—"} / ${cpuSpec.modelId ?? "—"} / ${cpuSpec.stepping ?? "—"}`
                    : "—"
                }
              />
              <KV k="L1 cache" v={l1Str} />
              <KV k="L2 cache" v={cpuSpec?.l2 ?? "—"} />
              <KV k="L3 cache" v={cpuSpec?.l3 ?? "—"} />
            </dl>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- memory */}
      <section className="panel ram-section p-6">
        <div className="group mb-4 flex items-center gap-2.5">
          <h2 className="sec-title">ram</h2>
          <div className="relative ml-auto flex items-center gap-2">
            <span
              role="status"
              aria-live="polite"
              className="text-sm font-medium text-ink-dim"
            >
              {memWord}
            </span>
            <CpuOrb orb={memOrb} size={36} />
            <div className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap tabular-nums group-hover:block">
              {s.mem.usedPct.toFixed(0)}% used · {fmtBytes(s.mem.availableBytes)}{" "}
              free · stall {s.psi.memory.some10.toFixed(1)}% → {memWord}
            </div>
          </div>
        </div>

        <div className="mb-5 flex flex-col gap-5 lg:flex-row lg:items-stretch">
          {/* big used/total line + graph */}
          <div className="flex flex-1 flex-col">
            <div className="mb-3 shrink-0 text-3xl leading-none font-semibold tabular-nums">
              {fmtBytes(s.mem.usedBytes)}
              <span className="text-lg text-ink-dim">
                {" "}
                / {fmtBytes(s.mem.totalBytes)}
              </span>
              <sup
                className="ml-1 align-super text-base font-medium"
                style={{ color: heatColor(s.mem.usedPct) }}
              >
                {s.mem.usedPct.toFixed(0)}%
              </sup>
            </div>

            {/* graph — gridded, 100% pinned to the top edge. Stacked traces:
                a solid darker band for in-use, a lighter band above it for
                cache; the upper line is the total. */}
            <div className="flex min-h-[11rem] flex-1 flex-col">
              <HoverSparkline
                points={memPoints}
                points2={memAppPoints}
                color="#ffce9c"
                color2="#f5822e"
                keys={["total", "in use"]}
                fmt={(v) => `${v.toFixed(0)}%`}
                grid
              />
            </div>
          </div>

          {/* DRAM power + the physical DIMM slots, boxed into their own card
              like the CPU hardware-threads section; the wattage row above
              lines the box up with the graph's top edge */}
          {memSlots.length > 0 && (
            <div className="flex w-full flex-col lg:w-[38%] lg:max-w-[15rem]">
              {/* DRAM power — mirrors the CPU wattage readout */}
              <div className="mb-3 flex min-h-[2.75rem] shrink-0 items-end justify-between gap-3">
                <div className="flex items-end gap-2">
                  <span className="text-base font-bold text-ink">Wattage</span>
                  <WattBolts
                    watts={s.mem.powerWatts}
                    full={WATT_FULL_DRAM}
                    count={1}
                  />
                </div>
                <span className="text-2xl leading-none font-bold tabular-nums">
                  {s.mem.powerWatts != null
                    ? `${s.mem.powerWatts.toFixed(
                        s.mem.powerWatts < 10 ? 1 : 0,
                      )} W`
                    : "—"}
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-1 flex-col rounded-md border border-panel-border bg-panel-border/10 p-3">
                  <div className="mb-2 shrink-0 text-[13px] font-bold tracking-wide text-ink uppercase">
                    Memory slots
                    {memSpec && (
                      <span className="ml-1 font-medium lowercase text-ink-dim">
                        {memSpec.slotsUsed}/{memSpec.slotsTotal} filled
                      </span>
                    )}
                  </div>
                  <RamSlots slots={memSlots} dimmC={dimmC} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 grid gap-6 border-t border-panel-border pt-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
              Details
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <KV
                k="Swap"
                v={`${fmtBytes(s.mem.swapUsedBytes)} / ${fmtBytes(
                  s.mem.swapTotalBytes,
                )}`}
              />
              <KV
                k="Committed"
                v={`${fmtBytes(s.mem.committedBytes)} / ${fmtBytes(
                  s.mem.commitLimitBytes,
                )}`}
              />
              <KV k="Available" v={fmtBytes(s.mem.availableBytes)} />
            </dl>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
              Hardware Specifications
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <KV k="Max capacity" v={memSpec?.maxCapacity ?? "—"} />
              <KV k="Type" v={memSpec?.type ?? "—"} />
              <KV k="Speed" v={memSpec?.speed ?? "—"} />
            </dl>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- SSD */}
      {disks.length > 0 && (
        <section className="panel ssd-section p-6">
          <div className="group mb-4 flex items-center gap-2.5">
            <h2 className="sec-title">ssd</h2>
            <div className="relative ml-auto flex items-center gap-2">
              <span
                role="status"
                aria-live="polite"
                className="text-sm font-medium text-ink-dim"
              >
                {ssdWord}
              </span>
              <CpuOrb orb={ssdOrb} size={36} />
              <div className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap tabular-nums group-hover:block">
                {ssdAct.toFixed(0)}% active · {fmtRate(s.disk?.readBps ?? 0)} r ·{" "}
                {fmtRate(s.disk?.writeBps ?? 0)} w → {ssdWord}
              </div>
            </div>
          </div>

          <div className="mb-5 flex flex-col gap-5 lg:flex-row lg:items-stretch">
            {/* total used / max + read-write graph */}
            <div className="flex flex-1 flex-col">
              <div className="mb-3 shrink-0 text-3xl leading-none font-semibold tabular-nums">
                {fmtBytes(ssdTotalUsed)}
                <span className="text-lg text-ink-dim">
                  {" "}
                  / {fmtBytes(ssdTotalMax)}
                </span>
                <sup
                  className="ml-1 align-super text-base font-medium"
                  style={{ color: heatColor(ssdPct) }}
                >
                  {ssdPct.toFixed(0)}%
                </sup>
              </div>

              <div className="flex min-h-[11rem] flex-1 flex-col">
                <HoverSparkline
                  mirror
                  points={ssdReadPoints}
                  points2={ssdWritePoints}
                  points3={ssdTempPoints}
                  color="#ff8a9a"
                  color2={SSD_RED}
                  color3={tempLineColor(ssdTempNow)}
                  keys={["read", "write", "temp"]}
                  fmt={(v) => fmtRate(v)}
                  fmt3={(v) => `${v.toFixed(0)}°`}
                  max={ssdGraphMax}
                  max3={100}
                  grid
                />
              </div>
            </div>

            {/* drive activity + the physical drives, boxed like the CPU /
                RAM hardware cards; the activity row above lines the box up
                with the graph's top edge */}
            <div className="flex w-full flex-col lg:w-[42%] lg:max-w-[18rem]">
              <div className="mb-3 flex min-h-[2.75rem] shrink-0 items-center gap-3">
                <span className="text-base font-bold text-ink">Activity</span>
                <div className="flex-1">
                  <Bar pct={ssdAct} color={loadColor(ssdAct)} />
                </div>
                <span className="text-2xl leading-none font-bold tabular-nums">
                  {ssdAct.toFixed(0)}%
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-1 flex-col rounded-md border border-panel-border bg-panel-border/10 p-3">
                  <div className="mb-2 shrink-0 text-[13px] font-bold tracking-wide text-ink uppercase">
                    SSDs
                    <span className="ml-1 font-medium lowercase text-ink-dim">
                      {disks.length} {disks.length === 1 ? "drive" : "drives"}
                    </span>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col gap-3">
                    {disks.map((d) => (
                      <SsdModel key={d.dev} drive={d} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* one column per drive */}
          <div
            className={`mt-6 grid gap-x-8 gap-y-5 border-t border-panel-border pt-5 ${
              disks.length >= 3
                ? "sm:grid-cols-2 lg:grid-cols-3"
                : disks.length === 2
                  ? "sm:grid-cols-2"
                  : "sm:max-w-xs"
            }`}
          >
            {disks.map((d) => {
              const model =
                d.model
                  .replace(/\s+with heatsink/i, "")
                  .replace(/\s{2,}/g, " ")
                  .trim() || d.dev;
              return (
                <div key={d.dev}>
                  <div
                    className="mb-2 truncate text-xs font-semibold tracking-wide text-ink uppercase"
                    title={d.model}
                  >
                    {model}
                  </div>
                  <dl className="flex flex-col gap-1.5 text-sm">
                    <KV
                      k="Drive health"
                      v={d.healthPct != null ? `${d.healthPct.toFixed(0)}%` : "—"}
                      color={healthColor(d.healthPct)}
                    />
                    <KV
                      k="Lifetime written"
                      v={d.tbwBytes != null ? fmtBytes(d.tbwBytes) : "—"}
                    />
                    <KV k="Total capacity" v={fmtBytes(d.capacityBytes)} />
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- GPU */}
      {g0 && gpuOrb && (
        <section className="panel gpu-section p-6 lg:col-span-2">
          <div className="group mb-4 flex items-center gap-2.5">
            <h2 className="sec-title">gpu</h2>
            <div className="relative ml-auto flex items-center gap-2">
              <span
                role="status"
                aria-live="polite"
                className="text-sm font-medium text-ink-dim"
              >
                {gpuWord}
              </span>
              <CpuOrb orb={gpuOrb} size={36} />
              <div className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap tabular-nums group-hover:block">
                {g0.utilPct.toFixed(0)}% ·{" "}
                {g0.tempC != null ? `${g0.tempC.toFixed(0)}°C` : "—"} ·{" "}
                {fmtMhz(g0.clockSmMhz)}
                {g0.throttle && ` · ${g0.throttle}`} → {gpuWord}
              </div>
            </div>
          </div>

          <div className="mb-5 flex flex-col gap-5 lg:flex-row lg:items-stretch">
            {/* usage / temp number, current clock, usage+temp graph */}
            <div className="flex flex-1 flex-col">
              <div className="mb-3 flex shrink-0 items-end justify-between gap-4">
                <div className="text-3xl leading-none font-semibold tabular-nums">
                  {g0.utilPct.toFixed(0)}
                  <span className="text-lg text-ink-dim">%</span>
                  {g0.tempC != null && (
                    <sup
                      className="ml-1 align-super text-base font-medium"
                      style={{ color: tempHeat(g0.tempC) }}
                    >
                      {g0.tempC.toFixed(0)}°
                    </sup>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold tabular-nums">
                    {fmtMhz(g0.clockSmMhz)}
                  </div>
                  <div className="text-xs text-ink-dim">current clock</div>
                </div>
              </div>

              <div className="flex min-h-[11rem] flex-1 flex-col">
                <HoverSparkline
                  points={gpuUtilPoints}
                  points3={gpuTempPoints}
                  color={GPU_GREEN}
                  color3={tempLineColor(gpuTempNow)}
                  keys={["usage", "", "temp"]}
                  fmt={(v) => `${v.toFixed(0)}%`}
                  fmt3={(v) => `${v.toFixed(0)}°`}
                  max3={100}
                  grid
                />
              </div>
            </div>

            {/* wattage row + VRAM fill box */}
            <div className="flex w-full flex-col lg:w-[40%] lg:max-w-[22rem]">
              <div className="mb-3 flex min-h-[2.75rem] shrink-0 items-end justify-between gap-3">
                <div className="flex items-end gap-2">
                  <span className="text-base font-bold text-ink">Wattage</span>
                  <WattBolts
                    watts={gpuWatts}
                    full={g0.powerLimitW ?? 75}
                    count={3}
                  />
                </div>
                <span className="text-2xl leading-none font-bold tabular-nums">
                  {g0.powerDrawW != null
                    ? `${g0.powerDrawW.toFixed(0)} W`
                    : gpuPwr
                      ? `~${Math.round(gpuPwr.lo)}–${Math.round(gpuPwr.hi)} W`
                      : g0.powerLimitW != null
                        ? `— / ${g0.powerLimitW.toFixed(0)} W`
                        : "—"}
                </span>
              </div>

              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-1 flex-col rounded-md border border-panel-border bg-panel-border/10 p-3">
                  <div className="mb-2 shrink-0 text-[13px] font-bold tracking-wide text-ink uppercase">
                    VRAM
                    <span className="ml-1 font-medium lowercase text-ink-dim">
                      {vramPct.toFixed(0)}% used
                    </span>
                  </div>

                  <div
                    className="relative flex min-h-[5rem] flex-1 flex-col justify-center overflow-hidden rounded-[4px] px-3 py-3"
                    style={{
                      border: `1.5px solid ${GPU_GREEN}`,
                      background: "rgba(94,240,138,0.04)",
                    }}
                  >
                    <div
                      className="pointer-events-none absolute inset-y-0 left-0"
                      style={{
                        width: `${vramPct}%`,
                        background: heatColor(vramPct),
                        opacity: 0.16,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute inset-y-0"
                      style={{
                        left: `${vramPct}%`,
                        width: "1.5px",
                        background: heatColor(vramPct),
                        boxShadow: `0 0 6px ${heatColor(vramPct)}`,
                      }}
                    />
                    {g0.memTempC != null && (
                      <span
                        className="absolute top-1.5 right-2 text-[11px] leading-none font-semibold tabular-nums"
                        style={{
                          color: tempHeat(g0.memTempC),
                          textShadow: "0 1px 2px rgba(0,0,0,0.9)",
                        }}
                      >
                        {g0.memTempC.toFixed(0)}°C
                      </span>
                    )}
                    <div className="relative text-center text-lg leading-none font-semibold tabular-nums text-ink">
                      {fmtBytes(vramUsed)}
                      <span className="text-ink-dim">
                        {" "}
                        / {fmtBytes(vramTotal)}
                      </span>
                    </div>
                    <div className="relative mt-1 text-center text-[11px] leading-none text-ink-dim">
                      {g0.memUtilPct != null
                        ? `${g0.memUtilPct.toFixed(0)}% bandwidth`
                        : "video memory"}
                    </div>
                    <span
                      className="absolute right-2 bottom-1.5 text-[11px] leading-none font-semibold tabular-nums"
                      style={{
                        color: heatColor(vramPct),
                        textShadow: "0 1px 2px rgba(0,0,0,0.9)",
                      }}
                    >
                      {vramPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-6 border-t border-panel-border pt-5 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
                Live
              </div>
              <dl className="flex flex-col gap-1.5 text-sm">
                <KV
                  k="Fan speed"
                  v={g0.fanPct != null ? `${g0.fanPct.toFixed(0)}%` : "—"}
                />
                <KV
                  k="Memory-controller util"
                  v={`${(g0.memUtilPct ?? 0).toFixed(0)}%`}
                />
                {/* encoder/decoder stats are NVIDIA-only; hide them for AMD */}
                {(g0.encUtilPct != null || g0.decUtilPct != null) && (
                  <>
                    <KV
                      k="NVENC (encode)"
                      v={
                        g0.encUtilPct != null
                          ? `${g0.encUtilPct.toFixed(0)}%${
                              g0.encSessions ? ` · ${g0.encSessions} sess` : ""
                            }`
                          : "—"
                      }
                    />
                    <KV
                      k="NVDEC (decode)"
                      v={g0.decUtilPct != null ? `${g0.decUtilPct.toFixed(0)}%` : "—"}
                    />
                  </>
                )}
                {/* NVIDIA reports P0–P15; amdgpu reports its DPM performance level */}
                <KV
                  k={/^P\d+$/i.test(g0.pstate) || !g0.pstate ? "P-state" : "Perf level"}
                  v={g0.pstate || "—"}
                />
                <KV k="PCIe link" v={pcieStr(g0.pcieGenCur, g0.pcieWidthCur)} />
                {g0.throttle && (
                  <KV k="Throttling" v={g0.throttle} color="#ff5a5f" />
                )}
              </dl>
            </div>

            <div>
              <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
                Hardware Specifications
              </div>
              <dl className="flex flex-col gap-1.5 text-sm">
                <KV k="Model" v={g0.name} />
                <KV
                  k="Power limit"
                  v={
                    g0.powerLimitW != null
                      ? `${g0.powerLimitW.toFixed(0)} W`
                      : "—"
                  }
                />
                <KV
                  k="Graphics clock"
                  v={clockStr(g0.clockSmMhz, g0.clockMaxSmMhz)}
                />
                <KV
                  k="Memory clock"
                  v={clockStr(g0.clockMemMhz, g0.clockMaxMemMhz)}
                />
                <KV
                  k="Video clock"
                  v={g0.clockVideoMhz != null ? `${g0.clockVideoMhz} MHz` : "—"}
                />
                <KV k="PCIe max" v={pcieStr(g0.pcieGenMax, g0.pcieWidthMax)} />
                <KV k="VBIOS" v={g0.vbios || "—"} />
                <KV k="Driver" v={g0.driver || "—"} />
              </dl>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- PSU */}
      {pw && psuOrb && (
        <section className="panel psu-section p-6">
          <div className="group mb-4 flex items-center gap-2.5">
            <h2 className="sec-title">psu</h2>
            <div className="relative ml-auto flex items-center gap-2">
              <span
                role="status"
                aria-live="polite"
                className="text-sm font-medium text-ink-dim"
              >
                {psuWord}
              </span>
              <CpuOrb orb={psuOrb} size={36} />
              <div className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap tabular-nums group-hover:block">
                wall ~{pw.wallLo.toFixed(0)}–{pw.wallHi.toFixed(0)} W · DC{" "}
                {pw.dcLo.toFixed(0)}–{pw.dcHi.toFixed(0)} W → {psuWord}
              </div>
            </div>
          </div>

          <div className="mb-5">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <div className="text-2xl leading-none font-semibold whitespace-nowrap tabular-nums sm:text-3xl">
                ~{pw.wallLo.toFixed(0)}–{pw.wallHi.toFixed(0)}
                <span className="text-lg text-ink-dim"> W</span>
              </div>
              <WattBolts
                watts={(pw.wallLo + pw.wallHi) / 2}
                full={PSU_FULL_W}
                count={5}
              />
            </div>
            <div className="h-44">
              <HoverSparkline
                points={psuHiPoints}
                points2={psuLoPoints}
                color="#ffe98c"
                color2={PSU_YELLOW}
                keys={["high", "low"]}
                fmt={(v) => `${v.toFixed(0)} W`}
                max={psuGraphMax}
                grid
              />
            </div>
          </div>

          <div className="grid gap-x-5 gap-y-4 border-t border-panel-border pt-5 sm:grid-cols-3">
            {(
              [
                ["measured", "Accurate"],
                ["estimate", "Estimate"],
                ["guess", "Guesses"],
              ] as const
            ).map(([tier, title]) => {
              const rows = pw.items.filter((i) => i.tier === tier);
              const lo = rows.reduce((a, i) => a + i.lo, 0);
              const hi = rows.reduce((a, i) => a + i.hi, 0);
              return (
                <div key={tier}>
                  <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
                    {title}
                  </div>
                  <dl className="flex flex-col gap-1.5 text-[13px]">
                    {rows.map((i) => (
                      <div
                        key={i.key}
                        className="flex justify-between gap-2"
                      >
                        <dt className="text-ink-dim">{i.label}</dt>
                        <dd className="text-right tabular-nums">
                          {fmtWRange(i.lo, i.hi)}
                        </dd>
                      </div>
                    ))}
                    <div className="mt-0.5 flex justify-between gap-2 border-t border-panel-border pt-1.5 font-semibold">
                      <dt>Subtotal</dt>
                      <dd className="tabular-nums">{fmtWRange(lo, hi)}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------- NET */}
      <section className="panel net-section p-6">
        <div className="group mb-4 flex items-center gap-2.5">
          <h2 className="sec-title">net</h2>
          <div className="relative ml-auto flex items-center gap-2">
            <span
              role="status"
              aria-live="polite"
              className="text-sm font-medium text-ink-dim"
            >
              {netWord}
            </span>
            <CpuOrb orb={netOrb} size={36} />
            <div className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap tabular-nums group-hover:block">
              ↓ {fmtRate(s.net?.rxBps ?? 0)} · ↑ {fmtRate(s.net?.txBps ?? 0)}
              {meta?.net?.iface && ` · ${meta.net.iface}`} → {netWord}
            </div>
          </div>
        </div>

        {s.net ? (
          <>
            <div className="mb-5">
              <div className="mb-3 flex items-end justify-between gap-4">
                <div className="text-3xl leading-none font-semibold tabular-nums">
                  {fmtRate(netNow)}
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">{netKind}</div>
                  <div className="text-xs text-ink-dim">connected</div>
                </div>
              </div>

              <div className="h-44">
                <HoverSparkline
                  mirror
                  points={netDownPoints}
                  points2={netUpPoints}
                  color={NET_PURPLE}
                  color2="#e0c6ff"
                  keys={["down", "up"]}
                  fmt={(v) => fmtRate(v)}
                  max={netGraphMax}
                  grid
                />
              </div>
            </div>

            <div className="grid gap-6 border-t border-panel-border pt-5 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
                  Live
                </div>
                <dl className="flex flex-col gap-1.5 text-sm">
                  <KV k="Download" v={fmtRate(s.net.rxBps)} />
                  <KV k="Upload" v={fmtRate(s.net.txBps)} />
                  <KV
                    k="Link use"
                    v={
                      netLinkBps > 0
                        ? `${netLinkPct < 1 ? netLinkPct.toFixed(1) : netLinkPct.toFixed(0)}%`
                        : "—"
                    }
                  />
                </dl>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
                  Session
                </div>
                <dl className="flex flex-col gap-1.5 text-sm">
                  <KV k="Received" v={fmtBytes(s.net.rxTotalBytes)} />
                  <KV k="Sent" v={fmtBytes(s.net.txTotalBytes)} />
                  <KV k="Interface" v={meta?.net?.iface ?? "—"} />
                  <KV
                    k="Link speed"
                    v={
                      meta?.net?.speedMbps != null
                        ? `${meta.net.speedMbps} Mbps`
                        : "—"
                    }
                  />
                </dl>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-ink-dim">No network stats.</p>
        )}
      </section>

      {/* -------------------------------------------------------------- OS */}
      <section className="panel os-section p-6 lg:col-span-2">
        <div className="group mb-4 flex items-center gap-2.5">
          <h2 className="sec-title">os</h2>
          <div className="relative ml-auto flex items-center gap-2">
            <span
              role="status"
              aria-live="polite"
              className="text-sm font-medium text-ink-dim"
            >
              {osWord}
            </span>
            <CpuOrb orb={osOrb} size={36} />
            <div className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 hidden rounded-sm border border-panel-border bg-panel px-2 py-1.5 text-xs whitespace-nowrap tabular-nums group-hover:block">
              load {osLoad1.toFixed(2)} · {s.sys.procCount} procs · stall{" "}
              {s.psi.cpu.some10.toFixed(1)}% → {osWord}
            </div>
          </div>
        </div>

        <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
              Servers
            </div>
            <ul className="flex flex-col gap-1.5">
              {servers.map((sv) => (
                <li
                  key={sv.key}
                  className="flex items-center gap-2.5 text-sm tabular-nums"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: sv.running ? "#22c55e" : "#ff5470",
                      boxShadow: `0 0 6px ${sv.running ? "#22c55e" : "#ff5470"}`,
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{sv.label}</span>
                  <span className="shrink-0 text-ink-dim">
                    {sv.memBytes != null ? fmtBytes(sv.memBytes) : "—"}
                  </span>
                  <button
                    type="button"
                    disabled={srvBusy != null}
                    onClick={() =>
                      serverAction(
                        sv.key,
                        sv.label,
                        sv.running ? "stop" : "start",
                      )
                    }
                    className="tap shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-black disabled:opacity-40"
                    style={{
                      background: sv.running ? "#ff5470" : "#22c55e",
                    }}
                  >
                    {srvBusy === sv.key ? "…" : sv.running ? "Stop" : "Start"}
                  </button>
                </li>
              ))}
              {servers.length === 0 && (
                <li className="text-sm text-ink-dim">loading…</li>
              )}
            </ul>
          </div>

          <div>
            <div className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
              System
            </div>
            <dl className="flex flex-col gap-1.5 text-sm">
              <KV k="Distro" v={os?.distro ?? "—"} />
              <KV k="Kernel" v={os?.kernel ?? "—"} />
              <KV k="Hostname" v={os?.hostname ?? "—"} />
              <KV k="Architecture" v={os?.arch ?? "—"} />
              <KV
                k="Booted"
                v={new Date(Date.now() - s.uptimeSec * 1000).toLocaleString()}
              />
              <KV k="Uptime" v={fmtUptime(s.uptimeSec)} />
              <KV
                k="Processes"
                v={`${s.sys.procCount}${
                  s.sys.running ? ` · ${s.sys.running} running` : ""
                }`}
              />
              <KV k="Threads" v={`${s.sys.threadCount}`} />
            </dl>
          </div>
        </div>

        <div className="mt-6 border-t border-panel-border pt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-medium tracking-wide text-ink-dim uppercase">
              Processes
            </div>
            <input
              type="text"
              value={procQuery}
              onChange={(e) => setProcQuery(e.target.value)}
              placeholder="search name, user, pid…"
              className="w-52 max-w-[55%] rounded-sm border border-panel-border bg-panel px-2 py-1 text-xs text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </div>
          <div
            className={
              procsScroll
                ? "max-h-[36rem] overflow-x-auto overflow-y-auto"
                : "overflow-x-auto"
            }
          >
            <table className="w-full text-left text-sm">
              <thead
                className={
                  procsScroll ? "sticky top-0 z-10 bg-panel" : undefined
                }
              >
                <tr className="border-b border-panel-border text-ink-dim">
                  {procCols.map((c) => (
                    <th
                      key={c.k}
                      onClick={() => sortProc(c.k)}
                      className={`cursor-pointer py-2 pr-4 font-medium select-none hover:text-ink ${
                        c.right ? "text-right" : ""
                      } ${procSort.key === c.k ? "text-ink" : ""} ${
                        c.k === "user" || c.k === "pid" ? "hidden sm:table-cell" : ""
                      }`}
                    >
                      {c.label}
                      {procSort.key === c.k
                        ? procSort.dir === -1
                          ? " ↓"
                          : " ↑"
                        : ""}
                    </th>
                  ))}
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {shownProcs.map((p) => (
                  <tr
                    key={p.pid}
                    className="border-b border-panel-border/60"
                    title={p.cmd}
                  >
                    <td className="py-2 pr-4">
                      <span className="flex items-center gap-2">
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: procStateColor(p.state) }}
                          title={procStateLabel(p.state)}
                        />
                        <span className="max-w-[10rem] truncate sm:max-w-none">{p.name}</span>
                      </span>
                    </td>
                    <td className="hidden py-2 pr-4 text-ink-dim sm:table-cell">{p.user}</td>
                    <td className="hidden py-2 pr-4 tabular-nums text-ink-dim sm:table-cell">
                      {p.pid}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {p.cpuPct.toFixed(0)}%
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtBytes(p.rssBytes)}
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        disabled={killBusy != null}
                        onClick={() => killProc(p.pid, p.name)}
                        className="tap rounded px-2 py-0.5 text-xs font-semibold text-black disabled:opacity-40"
                        style={{ background: "#ff5470" }}
                      >
                        {killBusy === p.pid ? "…" : "Kill"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {procQ ? (
            <div className="mt-3 text-xs text-ink-dim">
              {shownProcs.length} match{shownProcs.length === 1 ? "" : "es"}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setProcsExpanded((v) => !v)}
              className="mt-3 text-xs font-medium text-accent hover:underline"
            >
              {procsExpanded
                ? "View less"
                : `View more (${s.sys.procCount} processes)`}
            </button>
          )}
        </div>
      </section>

      {data.error && (
        <p className="text-xs text-danger lg:col-span-2">
          sampler: {data.error}
        </p>
      )}
    </div>
  );
}

// byjohnmichael*
