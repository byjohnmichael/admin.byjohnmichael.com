"use client";

// ./monitor — every component's vitals on one screen (sized for 1920×1080):
// a bklit ring summary + game-server status on the left, and one compact
// tile per component (CPU, RAM, SSD, GPU, PSU, NET) on the right. Data comes
// from the same /api/performance poll the floating Bob uses.

import { useEffect, useState } from "react";
import { useCachedState } from "@/lib/useCachedState";
import { HoverSparkline } from "@/components/perf/DotGraph";
import { HtopMeter, Spinner } from "@/components/term";
import { Ring } from "@/components/charts/ring";
import { RingCenter } from "@/components/charts/ring-center";
import { RingChart } from "@/components/charts/ring-chart";
import { usePerf } from "@/lib/perf/usePerf";
import {
  CPU_BLUE,
  GPU_GREEN,
  MEM_ORANGE,
  NET_PURPLE,
  PSU_FULL_W,
  PSU_YELLOW,
  SSD_RED,
  fmtBytes,
  fmtMhz,
  fmtRate,
  fmtUptime,
  tempHeat,
} from "@/lib/perf/format";
import {
  deriveGpuOrb,
  deriveMemOrb,
  deriveNetOrb,
  deriveOrb,
  derivePsuOrb,
  deriveSsdOrb,
  robustMax,
  type OrbState,
} from "@/lib/perf/orbs";

type ServerStatus = {
  minecraft: {
    up: boolean;
    health: string | null;
    playersOnline: number | null;
    playersMax: number | null;
    startedAt: string | null;
  };
  wow: {
    up: boolean;
    health: string | null;
    charactersOnline: number | null;
    accounts: number | null;
    startedAt: string | null;
  };
  sites: { name: string; label: string; active: boolean }[];
};

const SERVER_POLL_MS = 15_000;

function sinceIso(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? "—" : fmtUptime((Date.now() - t) / 1000);
}

/* ------------------------------------------------------------ building blocks */

function Tile({
  name,
  section,
  orb,
  children,
}: {
  name: string;
  section: string;
  orb: OrbState | null;
  children: React.ReactNode;
}) {
  return (
    <section className={`panel ${section}-section flex min-h-0 flex-col gap-3 p-4`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="sec-title">{name}</h2>
        {orb && (
          <span className="flex items-center gap-2 text-xs text-ink-dim">
            {orb.cand}
            <Spinner load={orb.intensity} />
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Big({ value, unit, temp }: { value: string; unit?: string; temp?: number | null }) {
  return (
    <div className="text-3xl leading-none font-bold tabular-nums">
      {value}
      {unit && <span className="text-base font-medium text-ink-dim">{unit}</span>}
      {temp != null && (
        <sup className="ml-1 text-sm font-semibold" style={{ color: tempHeat(temp) }}>
          {temp.toFixed(0)}°
        </sup>
      )}
    </div>
  );
}

function Rows({ rows, cols = 2 }: { rows: [string, string][]; cols?: 1 | 2 }) {
  return (
    <dl className={`grid gap-x-4 gap-y-1 text-xs ${cols === 2 ? "grid-cols-2" : ""}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="flex min-w-0 justify-between gap-2">
          <dt className="truncate text-ink-dim">{k}</dt>
          <dd className="truncate tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Watts({ watts, full }: { watts: number | null; full: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-ink-dim">watts</span>
      <HtopMeter pct={watts == null ? 0 : (watts / full) * 100} width={16} color={PSU_YELLOW} />
      <span className="ml-auto font-semibold tabular-nums">
        {watts == null ? "—" : `${watts.toFixed(0)} W`}
      </span>
    </div>
  );
}

function ServerRow({
  name,
  up,
  detail,
  stats,
}: {
  name: string;
  up: boolean;
  detail: string;
  stats: [string, string][];
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-dashed border-panel-border pt-3">
      <div className="flex items-center gap-2 text-sm font-bold">
        <span className={`live-dot ${up ? "" : "live-dot-off"}`} aria-hidden />
        {name}
        <span className="ml-auto text-xs font-normal text-ink-dim">{detail}</span>
      </div>
      <Rows rows={stats} />
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function MonitorPage() {
  const perf = usePerf();
  const [servers, setServers] = useCachedState<ServerStatus | null>("monitor:servers", null);
  const [ringHover, setRingHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/general")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && d && setServers(d))
        .catch(() => {});
    load();
    const id = setInterval(load, SERVER_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const s = perf?.current;
  if (!perf || !s) {
    return <div className="panel p-6 text-sm text-ink-dim">Waiting for the first sample…</div>;
  }
  const h = perf.history;
  const pts = (pick: (p: (typeof h)[number]) => number) => h.map((p) => ({ t: p.t, v: pick(p) }));

  const cpuOrb = deriveOrb(s, h, perf.meta?.cpuSpec ?? null);
  const memOrb = deriveMemOrb(s, h);
  const ssdOrb = deriveSsdOrb(s, h);
  const netOrb = deriveNetOrb(s.net, h);
  const g = s.gpu[0] ?? null;
  const gpuOrb = g ? deriveGpuOrb(g, h) : null;
  const pw = s.power ?? null;
  const psuOrb = pw ? derivePsuOrb(pw) : null;

  const diskCap = s.disks.reduce((a, d) => a + d.capacityBytes, 0);
  const diskUsed = s.disks.reduce((a, d) => a + d.fsUsedBytes, 0);
  const diskMax = robustMax(1, h.map((p) => p.diskR), h.map((p) => p.diskW));
  const netMax = robustMax(1024, h.map((p) => p.netRx), h.map((p) => p.netTx));
  const vramPct = g && g.memTotalBytes ? (g.memUsedBytes / g.memTotalBytes) * 100 : 0;
  const psuMax = Math.max(60, ...h.map((p) => p.estWHi)) * 1.12;

  // ring summary: one ring per component's utilisation
  const rings = [
    { label: "cpu", value: Math.round(s.cpu.overall), maxValue: 100, color: CPU_BLUE },
    { label: "ram", value: Math.round(s.mem.usedPct), maxValue: 100, color: MEM_ORANGE },
    { label: "ssd", value: Math.round(s.disk?.utilPct ?? 0), maxValue: 100, color: SSD_RED },
    ...(g ? [{ label: "gpu", value: Math.round(g.utilPct), maxValue: 100, color: GPU_GREEN }] : []),
    ...(pw
      ? [{ label: "psu", value: Math.round(((pw.wallLo + pw.wallHi) / 2 / PSU_FULL_W) * 100), maxValue: 100, color: PSU_YELLOW }]
      : []),
  ];

  const busiest = rings.reduce((best, r, i) => (r.value > rings[best].value ? i : best), 0);

  return (
    <div className="monitor-grid">
      {/* -------------------------------------------------------- left rail */}
      <section className="panel monitor-rail flex min-h-0 flex-col gap-4 p-4">
        <div className="flex items-center justify-between">
          <h2>system</h2>
          <span className="text-xs text-ink-dim">up {fmtUptime(s.uptimeSec)}</span>
        </div>
        <div className="monitor-rings">
          {/* controlled hover: with nothing hovered the busiest ring is
              "selected", so the centre always names a real component */}
          <RingChart
            data={rings}
            strokeWidth={10}
            ringGap={5}
            baseInnerRadius={52}
            hoveredIndex={ringHover ?? busiest}
            onHoverChange={setRingHover}
          >
            {rings.map((r, i) => (
              <Ring index={i} key={r.label} />
            ))}
            <RingCenter>
              {({ data }) => (
                <div className="flex flex-col items-center leading-none">
                  <span className="text-2xl font-bold tabular-nums">{data.value}%</span>
                  <span className="mt-1 text-xs text-ink-dim">{data.label}</span>
                </div>
              )}
            </RingCenter>
          </RingChart>
        </div>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {rings.map((r) => (
            <li key={r.label} className="flex items-center gap-2">
              <span className="inline-block h-2 w-2" style={{ background: r.color }} />
              <span className="text-ink-dim">{r.label}</span>
              <span className="ml-auto tabular-nums">{r.value}%</span>
            </li>
          ))}
        </ul>
        <Rows
          cols={1}
          rows={[
            ["load 1/5/15", s.load.load.map((n) => n.toFixed(2)).join(" ")],
            ["procs", `${s.sys.procCount} · ${s.sys.running} run`],
          ]}
        />

        <h2 className="mt-2">servers</h2>
        {servers ? (
          <>
            <ServerRow
              name="Minecraft"
              up={servers.minecraft.up}
              detail={servers.minecraft.up ? (servers.minecraft.health ?? "running") : "down"}
              stats={[
                [
                  "players",
                  servers.minecraft.playersOnline == null
                    ? "—"
                    : `${servers.minecraft.playersOnline}/${servers.minecraft.playersMax ?? "?"}`,
                ],
                ["uptime", sinceIso(servers.minecraft.startedAt)],
              ]}
            />
            <ServerRow
              name="WoW"
              up={servers.wow.up}
              detail={servers.wow.up ? (servers.wow.health ?? "running") : "down"}
              stats={[
                ["online", servers.wow.charactersOnline == null ? "—" : String(servers.wow.charactersOnline)],
                ["accounts", servers.wow.accounts == null ? "—" : String(servers.wow.accounts)],
                ["uptime", sinceIso(servers.wow.startedAt)],
              ]}
            />
            <div className="flex flex-col gap-1 border-t border-dashed border-panel-border pt-3 text-xs">
              {servers.sites.map((site) => (
                <div key={site.name} className="flex items-center gap-2">
                  <span className={`live-dot ${site.active ? "" : "live-dot-off"}`} aria-hidden />
                  <span className="truncate">{site.label}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-xs text-ink-dim">Checking servers…</p>
        )}
      </section>

      {/* ------------------------------------------------------------ tiles */}
      <Tile name="cpu" section="cpu" orb={cpuOrb}>
        <div className="flex items-end justify-between">
          <Big value={s.cpu.overall.toFixed(0)} unit="%" temp={s.temp.packageC} />
          <span className="text-sm tabular-nums">{fmtMhz(s.cpu.freqMaxMhz)}</span>
        </div>
        <div className="monitor-graph">
          <HoverSparkline points={pts((p) => p.cpu)} points3={pts((p) => p.pkg ?? 0)} color={CPU_BLUE} color3={tempHeat(s.temp.packageC)} keys={["usage", "", "temp"]} fmt={(v) => `${v.toFixed(0)}%`} fmt3={(v) => `${v.toFixed(0)}°`} max3={100} grid />
        </div>
        <Watts watts={s.cpu.packageWatts} full={65} />
        <Rows
          rows={[
            ["threads", String(s.cpu.perThread.length)],
            ["iowait", `${s.cpu.util.iowait.toFixed(1)}%`],
          ]}
        />
      </Tile>

      <Tile name="ram" section="ram" orb={memOrb}>
        <Big value={fmtBytes(s.mem.usedBytes)} unit={` / ${fmtBytes(s.mem.totalBytes)}`} />
        <div className="monitor-graph">
          <HoverSparkline points={pts((p) => p.mem)} points2={pts((p) => p.memApp)} color="#ffce9c" color2="#f5822e" keys={["total", "in use"]} fmt={(v) => `${v.toFixed(0)}%`} grid />
        </div>
        <Watts watts={s.mem.powerWatts} full={10} />
        <Rows
          rows={[
            ["free", fmtBytes(s.mem.availableBytes)],
            ["swap", fmtBytes(s.mem.swapUsedBytes)],
          ]}
        />
      </Tile>

      <Tile name="ssd" section="ssd" orb={ssdOrb}>
        <Big value={fmtBytes(diskUsed)} unit={` / ${fmtBytes(diskCap)}`} temp={s.temp.nvmeC} />
        <div className="monitor-graph">
          <HoverSparkline mirror points={pts((p) => p.diskR)} points2={pts((p) => p.diskW)} color="#ff8a9a" color2={SSD_RED} keys={["read", "write"]} fmt={(v) => fmtRate(v)} max={diskMax} grid />
        </div>
        <Rows
          rows={[
            ["read", fmtRate(s.disk?.readBps ?? 0)],
            ["write", fmtRate(s.disk?.writeBps ?? 0)],
            ["busy", `${(s.disk?.utilPct ?? 0).toFixed(0)}%`],
            ["drives", String(s.disks.length)],
          ]}
        />
      </Tile>

      <Tile name="gpu" section="gpu" orb={gpuOrb}>
        {g ? (
          <>
            <div className="flex items-end justify-between">
              <Big value={g.utilPct.toFixed(0)} unit="%" temp={g.tempC} />
              <span className="text-sm tabular-nums">{fmtMhz(g.clockSmMhz)}</span>
            </div>
            <div className="monitor-graph">
              <HoverSparkline points={pts((p) => p.gpu)} points3={pts((p) => p.gpuTempC ?? 0)} color={GPU_GREEN} color3={tempHeat(g.tempC)} keys={["usage", "", "temp"]} fmt={(v) => `${v.toFixed(0)}%`} fmt3={(v) => `${v.toFixed(0)}°`} max3={100} grid />
            </div>
            <Watts watts={g.powerDrawW} full={g.powerLimitW ?? 75} />
            <Rows
              rows={[
                ["vram", `${vramPct.toFixed(0)}%`],
                ["fan", g.fanPct == null ? "—" : `${g.fanPct.toFixed(0)}%`],
              ]}
            />
          </>
        ) : (
          <p className="text-xs text-ink-dim">No GPU detected.</p>
        )}
      </Tile>

      <Tile name="psu" section="psu" orb={psuOrb}>
        {pw ? (
          <>
            <Big value={`~${pw.wallLo.toFixed(0)}–${pw.wallHi.toFixed(0)}`} unit=" W" />
            <div className="monitor-graph">
              <HoverSparkline points={pts((p) => p.estWHi)} points2={pts((p) => p.estWLo)} color="#ffe98c" color2={PSU_YELLOW} keys={["high", "low"]} fmt={(v) => `${v.toFixed(0)} W`} max={psuMax} grid />
            </div>
            <Watts watts={(pw.wallLo + pw.wallHi) / 2} full={PSU_FULL_W} />
            <Rows rows={[["dc", `${pw.dcLo.toFixed(0)}–${pw.dcHi.toFixed(0)} W`]]} />
          </>
        ) : (
          <p className="text-xs text-ink-dim">No power estimate.</p>
        )}
      </Tile>

      <Tile name="net" section="net" orb={netOrb}>
        <Big value={fmtRate(s.net ? s.net.rxBps + s.net.txBps : 0)} />
        <div className="monitor-graph">
          <HoverSparkline mirror points={pts((p) => p.netRx)} points2={pts((p) => p.netTx)} color={NET_PURPLE} color2="#e0c6ff" keys={["down", "up"]} fmt={(v) => fmtRate(v)} max={netMax} grid />
        </div>
        <Rows
          rows={[
            ["down", fmtRate(s.net?.rxBps ?? 0)],
            ["up", fmtRate(s.net?.txBps ?? 0)],
            ["received", fmtBytes(s.net?.rxTotalBytes ?? 0)],
            ["sent", fmtBytes(s.net?.txTotalBytes ?? 0)],
          ]}
        />
      </Tile>
    </div>
  );
}

// byjohnmichael*
