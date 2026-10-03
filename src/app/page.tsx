"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CountUp, SegMeter } from "@/components/term";
import PackagesPanel from "@/components/PackagesPanel";

type ServiceAction = "start" | "stop" | "restart" | "enable" | "disable";

type ServiceInfo = {
  unit: string;
  label: string;
  description: string;
  activeState: string;
  subState: string;
  unitFileState: string;
  loadState: string;
  running: boolean;
  enabled: boolean;
  canStart: boolean;
  canStop: boolean;
  canEnable: boolean;
  canDisable: boolean;
  self: boolean;
};

type Specs = {
  os: { distro: string; kernel: string; hostname: string; arch: string };
  cpu: {
    model: string;
    vendor: string;
    cores: number;
    threads: number;
    baseGhz: number | null;
    maxMhz: number | null;
    minMhz: number | null;
    l1: string | null;
    l2: string | null;
    l3: string | null;
    socket: string | null;
    virtualization: string | null;
  };
  memory: {
    totalBytes: number;
    maxCapacity: string | null;
    slotsUsed: number;
    slotsTotal: number;
    type: string | null;
    speed: string | null;
    modules: {
      locator: string;
      sizeBytes: number;
      type: string;
      speed: string;
      manufacturer: string;
      partNumber: string;
    }[];
  };
  motherboard: {
    manufacturer: string;
    product: string;
    version: string | null;
  } | null;
  bios: { vendor: string; version: string; date: string } | null;
  gpus: {
    name: string;
    memory: string;
    driver: string;
    vbios: string | null;
    pcie: string | null;
  }[];
  storage: {
    name: string;
    model: string;
    sizeBytes: number;
    bus: string;
    rotational: boolean;
  }[];
  network: {
    iface: string;
    description: string;
    driver: string;
    speedMbps: number | null;
    up: boolean;
  }[];
  error: string | null;
};

type Summary = {
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

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function formatDuration(totalSec: number): string {
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function uptimeFromIso(iso: string | null): string {
  if (!iso) return "—";
  const started = new Date(iso).getTime();
  if (Number.isNaN(started)) return "—";
  return formatDuration((Date.now() - started) / 1000);
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
        ok ? "bg-accent" : "bg-danger"
      }`}
    />
  );
}

function Meter({ pct }: { pct: number }) {
  return <SegMeter pct={pct} color={pct > 85 ? "var(--danger)" : undefined} />;
}

// big headline number in a dashed box, e.g. "39.4%" over "$ memory"
function Vital({
  label,
  value,
  decimals,
  suffix,
}: {
  label: string;
  value: number;
  decimals: number;
  suffix?: string;
}) {
  return (
    <div className="min-w-0 border border-dashed border-panel-border px-2 py-2.5 sm:px-3">
      <div className="text-xl leading-none font-bold sm:text-2xl">
        <CountUp value={value} decimals={decimals} suffix={suffix} />
      </div>
      <div className="mt-1 truncate text-xs text-ink-dim">
        <span className="text-ink-dim/50">$ </span>
        {label}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-dim">{label}</dt>
      <dd className="mt-0.5 tabular-nums">{value}</dd>
    </div>
  );
}

const AMBER = "#f5a524";

function SpecGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-ink-dim lowercase">
        <span className="text-accent">&gt; </span>
        {title}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function fmtLinkSpeed(mbps: number | null): string {
  if (!mbps) return "";
  return mbps >= 1000 ? `${mbps / 1000} Gbps` : `${mbps} Mbps`;
}

function serviceStateLabel(svc: ServiceInfo): string {
  if (svc.loadState !== "loaded") return svc.loadState;
  if (svc.running) return svc.subState === "exited" ? "active (exited)" : "running";
  if (svc.activeState === "activating") return "starting…";
  if (svc.activeState === "deactivating") return "stopping…";
  return svc.activeState; // inactive | failed
}

function ServiceRow({
  svc,
  busy,
  pinned,
  onAction,
  onTogglePin,
}: {
  svc: ServiceInfo;
  busy: boolean;
  pinned: boolean;
  onAction: (unit: string, action: ServiceAction) => void;
  onTogglePin: (unit: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const dotColor =
    svc.loadState === "masked"
      ? "var(--ink-dim)"
      : svc.loadState !== "loaded" || svc.activeState === "failed"
        ? "var(--danger)"
        : svc.running
          ? "var(--accent)"
          : svc.activeState === "activating" || svc.activeState === "deactivating"
            ? AMBER
            : "var(--ink-dim)";

  const actions: { key: ServiceAction; label: string; danger?: boolean }[] = [];
  if (svc.canStart) actions.push({ key: "start", label: "Start" });
  if (svc.canStop) actions.push({ key: "stop", label: "Stop", danger: true });
  if (svc.loadState === "loaded") actions.push({ key: "restart", label: "Restart" });
  if (svc.canEnable) actions.push({ key: "enable", label: "Enable" });
  if (svc.canDisable) actions.push({ key: "disable", label: "Disable", danger: true });

  return (
    <li className="flex items-center gap-2 py-2.5 first:pt-0 last:pb-0">
      <button
        className="tap shrink-0 px-1 text-sm text-ink-dim hover:text-accent"
        title={pinned ? "Unpin" : "Pin"}
        aria-label={pinned ? "Unpin" : "Pin"}
        onClick={() => onTogglePin(svc.unit)}
      >
        <span style={pinned ? { color: "var(--accent)" } : undefined}>
          {pinned ? "★" : "☆"}
        </span>
      </button>
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: dotColor }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{svc.label}</div>
        <div className="truncate text-xs text-ink-dim">
          {serviceStateLabel(svc)} · {svc.enabled ? "enabled" : "disabled"}
          {svc.self && " · this panel"}
          {svc.description && ` — ${svc.description}`}
        </div>
      </div>
      {actions.length > 0 && (
        <div ref={ref} className="relative shrink-0">
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => setOpen((o) => !o)}
          >
            {busy ? "Working…" : "Manage"}
          </button>
          {open && (
            <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-sm border border-panel-border bg-panel py-1 shadow-lg">
              {actions.map((a) => (
                <button
                  key={a.key}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-panel-border ${
                    a.danger ? "text-danger" : "text-ink"
                  }`}
                  onClick={() => {
                    setOpen(false);
                    onAction(svc.unit, a.key);
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function GeneralPage() {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [rebootArmed, setRebootArmed] = useState(false);
  const [rebootState, setRebootState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [svcBusy, setSvcBusy] = useState<string | null>(null);
  const [svcMsg, setSvcMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );
  const [svcQuery, setSvcQuery] = useState("");
  const [svcPins, setSvcPins] = useState<string[]>([]);

  useEffect(() => {
    // Hydrate pins from localStorage after mount (not during SSR, and kept out
    // of the initial render to avoid a hydration mismatch).
    try {
      const raw = localStorage.getItem("admin.pinnedServices");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSvcPins(JSON.parse(raw));
    } catch {
      // no stored pins / storage unavailable
    }
  }, []);

  function toggleSvcPin(unit: string) {
    setSvcPins((cur) => {
      const next = cur.includes(unit)
        ? cur.filter((u) => u !== unit)
        : [...cur, unit];
      try {
        localStorage.setItem("admin.pinnedServices", JSON.stringify(next));
      } catch {
        // storage unavailable — pins just won't persist
      }
      return next;
    });
  }

  const load = useCallback(() => {
    fetch("/api/general")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d: Summary) => {
        setData(d);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!rebootArmed) return;
    const id = setTimeout(() => setRebootArmed(false), 4000);
    return () => clearTimeout(id);
  }, [rebootArmed]);

  async function doReboot() {
    setRebootState("sending");
    try {
      const r = await fetch("/api/system/reboot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "reboot" }),
      });
      setRebootState(r.ok ? "done" : "error");
    } catch {
      setRebootState("error");
    }
    setRebootArmed(false);
  }

  async function handleServiceAction(unit: string, action: ServiceAction) {
    setSvcBusy(unit);
    setSvcMsg(null);
    try {
      const r = await fetch("/api/system/service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit, action }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setSvcMsg({ kind: "err", text: j.error || `${action} failed` });
      } else if (j.deferred) {
        setSvcMsg({
          kind: "ok",
          text: `${unit}: ${action} scheduled — this panel may drop briefly.`,
        });
      } else {
        setSvcMsg({ kind: "ok", text: `${unit}: ${action} done.` });
        load();
      }
    } catch {
      setSvcMsg({ kind: "err", text: `${action} failed` });
    }
    setSvcBusy(null);
  }

  if (error && !data) {
    return (
      <div className="panel p-8 text-ink-dim">
        <h1 className="mb-2 text-lg font-semibold text-ink">Overview</h1>
        <p>Couldn&apos;t load server status.</p>
        <button className="btn btn-ghost mt-4" onClick={load}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel p-8 text-sm text-ink-dim">Loading server status…</div>
    );
  }

  const { system, minecraft, wow, sites, services, specs, todos } = data;
  const openTodos = todos.filter((t) => t.count > 0);

  const svcq = svcQuery.trim().toLowerCase();
  const svcMatch = (s: ServiceInfo) =>
    !svcq ||
    s.unit.toLowerCase().includes(svcq) ||
    s.description.toLowerCase().includes(svcq);
  const pinnedSet = new Set(svcPins);
  const byUnitName = (a: ServiceInfo, b: ServiceInfo) =>
    a.unit.localeCompare(b.unit);
  const pinnedServices = services
    .filter((s) => pinnedSet.has(s.unit) && svcMatch(s))
    .sort(byUnitName);
  const otherServices = services
    .filter((s) => !pinnedSet.has(s.unit) && svcMatch(s))
    .sort(byUnitName);
  const memUsed = system.mem.totalBytes - system.mem.availableBytes;
  const memPct = system.mem.totalBytes
    ? (memUsed / system.mem.totalBytes) * 100
    : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Below lg the two columns dissolve (display: contents) so the
          sections can be re-ordered: status first, the long lists last. */}
      <div className="contents lg:col-span-2 lg:flex lg:flex-col lg:gap-6">
      {/* ---------------------------------------------------- system overview */}
      <section className="panel p-6 max-lg:order-3">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-lg font-semibold">System</h1>
          <span className="text-xs text-ink-dim">
            {system.hostname} · up {formatDuration(system.uptimeSec)}
          </span>
        </div>

        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Vital label="memory" value={memPct} decimals={1} suffix="%" />
            {system.disk && (
              <Vital
                label={`disk ${system.disk.path}`}
                value={system.disk.usePct}
                decimals={0}
                suffix="%"
              />
            )}
            <Vital label="load 1m" value={system.load[0] ?? 0} decimals={2} />
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-ink-dim">Memory</span>
              <span className="tabular-nums">
                {formatBytes(memUsed)} / {formatBytes(system.mem.totalBytes)}
              </span>
            </div>
            <Meter pct={memPct} />
          </div>

          {system.disk && (
            <div>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-ink-dim">Disk ({system.disk.path})</span>
                <span className="tabular-nums">
                  {formatBytes(system.disk.usedBytes)} /{" "}
                  {formatBytes(system.disk.sizeBytes)} ·{" "}
                  {formatBytes(system.disk.availBytes)} free
                </span>
              </div>
              <Meter pct={system.disk.usePct} />
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
            <Stat
              label="Load (1m / 5m / 15m)"
              value={system.load.map((n) => n.toFixed(2)).join("  ")}
            />
            <Stat label="CPU cores" value={String(system.cpuCount)} />
            <Stat label="Kernel" value={system.kernel} />
          </dl>
        </div>
      </section>

      {/* ---------------------------------------------------- specifications */}
      <section className="panel p-6 max-lg:order-5">
        <h2 className="mb-4 text-base font-semibold">Specifications</h2>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <SpecGroup title="CPU">
            <div className="text-sm">{specs.cpu.model}</div>
            <div className="text-xs text-ink-dim">
              {specs.cpu.cores}C / {specs.cpu.threads}T
              {specs.cpu.baseGhz && ` · ${specs.cpu.baseGhz} GHz base`}
              {specs.cpu.maxMhz &&
                ` · ${(specs.cpu.maxMhz / 1000).toFixed(1)} GHz boost`}
            </div>
            {(specs.cpu.l1 || specs.cpu.l2 || specs.cpu.l3) && (
              <div className="text-xs text-ink-dim">
                {[
                  specs.cpu.l1 && `L1 ${specs.cpu.l1}`,
                  specs.cpu.l2 && `L2 ${specs.cpu.l2}`,
                  specs.cpu.l3 && `L3 ${specs.cpu.l3}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                {specs.cpu.virtualization && ` · ${specs.cpu.virtualization}`}
              </div>
            )}
          </SpecGroup>

          <SpecGroup title="Memory">
            <div className="text-sm">
              {formatBytes(specs.memory.totalBytes)}
              {specs.memory.type && ` ${specs.memory.type}`}
              {specs.memory.speed && ` · ${specs.memory.speed}`}
            </div>
            <div className="text-xs text-ink-dim">
              {specs.memory.slotsUsed} of {specs.memory.slotsTotal} slots filled
              {specs.memory.maxCapacity && ` · ${specs.memory.maxCapacity} max`}
            </div>
            {specs.memory.modules.map((m, i) => (
              <div key={i} className="text-xs text-ink-dim">
                {m.locator} · {formatBytes(m.sizeBytes)}
                {m.manufacturer && ` · ${m.manufacturer}`}
                {m.partNumber && ` ${m.partNumber}`}
              </div>
            ))}
          </SpecGroup>

          {specs.motherboard && (
            <SpecGroup title="Motherboard">
              <div className="text-sm">
                {specs.motherboard.manufacturer} {specs.motherboard.product}
              </div>
              {specs.motherboard.version && (
                <div className="text-xs text-ink-dim">
                  {specs.motherboard.version}
                </div>
              )}
              {specs.bios && (
                <div className="text-xs text-ink-dim">
                  BIOS {specs.bios.vendor} {specs.bios.version}
                  {specs.bios.date && ` · ${specs.bios.date}`}
                </div>
              )}
            </SpecGroup>
          )}

          {specs.gpus.map((g, i) => (
            <SpecGroup key={i} title={specs.gpus.length > 1 ? `GPU ${i}` : "GPU"}>
              <div className="text-sm">{g.name}</div>
              <div className="text-xs text-ink-dim">
                {g.memory}
                {g.driver && ` · driver ${g.driver}`}
                {g.pcie && ` · ${g.pcie}`}
              </div>
              {g.vbios && (
                <div className="text-xs text-ink-dim">VBIOS {g.vbios}</div>
              )}
            </SpecGroup>
          ))}

          {specs.storage.length > 0 && (
            <SpecGroup title="Storage">
              {specs.storage.map((d) => (
                <div key={d.name} className="text-xs text-ink-dim">
                  <span className="text-sm text-ink">{d.model}</span> —{" "}
                  {formatBytes(d.sizeBytes)}
                  {d.bus && ` · ${d.bus}`} · {d.rotational ? "HDD" : "SSD"}
                </div>
              ))}
            </SpecGroup>
          )}

          {specs.network.length > 0 && (
            <SpecGroup title="Network">
              {specs.network.map((n) => (
                <div key={n.iface} className="text-xs text-ink-dim">
                  <span className="text-ink">{n.iface}</span> —{" "}
                  {n.description || n.driver}
                  {n.speedMbps && ` · ${fmtLinkSpeed(n.speedMbps)}`} ·{" "}
                  {n.up ? "up" : "down"}
                </div>
              ))}
            </SpecGroup>
          )}

          <SpecGroup title="OS">
            <div className="text-sm">{specs.os.distro}</div>
            <div className="text-xs text-ink-dim">
              kernel {specs.os.kernel} · {specs.os.arch}
            </div>
          </SpecGroup>
        </div>
        {specs.error && (
          <p className="mt-3 text-xs text-danger">specs: {specs.error}</p>
        )}
      </section>

      {/* ---------------------------------------------------------- services */}
      <section className="panel p-6 max-lg:order-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold">
            Services{" "}
            <span className="font-normal text-ink-dim">({services.length})</span>
          </h2>
          {svcMsg && (
            <span
              className={`text-xs ${
                svcMsg.kind === "err" ? "text-danger" : "text-ink-dim"
              }`}
            >
              {svcMsg.text}
            </span>
          )}
        </div>

        <input
          value={svcQuery}
          onChange={(e) => setSvcQuery(e.target.value)}
          placeholder="Filter by name or description…"
          className="input mb-3 w-full"
        />

        {services.length === 0 ? (
          <p className="text-sm text-ink-dim">No services.</p>
        ) : (
          <div className="max-h-[32rem] overflow-y-auto">
            {pinnedServices.length > 0 && (
              <>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-dim">
                  Pinned
                </div>
                <ul className="mb-4 flex flex-col divide-y divide-panel-border/60 border-b border-panel-border pb-2">
                  {pinnedServices.map((svc) => (
                    <ServiceRow
                      key={svc.unit}
                      svc={svc}
                      pinned
                      busy={svcBusy === svc.unit}
                      onAction={handleServiceAction}
                      onTogglePin={toggleSvcPin}
                    />
                  ))}
                </ul>
              </>
            )}

            <ul className="flex flex-col divide-y divide-panel-border/60">
              {otherServices.map((svc) => (
                <ServiceRow
                  key={svc.unit}
                  svc={svc}
                  pinned={false}
                  busy={svcBusy === svc.unit}
                  onAction={handleServiceAction}
                  onTogglePin={toggleSvcPin}
                />
              ))}
            </ul>

            {otherServices.length === 0 && (
              <p className="py-2 text-sm text-ink-dim">
                {svcq ? "No matches." : "Nothing else to show."}
              </p>
            )}
          </div>
        )}
      </section>
      </div>

      {/* --------------------------------------------------------- side column */}
      <div className="contents lg:flex lg:flex-col lg:gap-6">
        {openTodos.length > 0 && (
          <section className="panel p-6 max-lg:order-1">
            <h2 className="mb-4 text-base font-semibold">To-do</h2>
            <ul className="flex flex-col gap-2">
              {openTodos.map((todo) => (
                <li key={todo.key}>
                  <Link
                    href={todo.href}
                    className="flex items-center justify-between border border-dashed border-panel-border px-3 py-2 text-sm transition-colors hover:border-panel-border hover:text-ink"
                  >
                    <span className="capitalize">{todo.label}</span>
                    <span className="term-badge border border-accent/60 px-1.5 py-0.5 text-xs font-bold tabular-nums text-accent">
                      {todo.count}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="panel p-6 max-lg:order-2">
          <h2 className="mb-4 text-base font-semibold">Quick status</h2>

          <div className="flex flex-col divide-y divide-panel-border/60">
            {/* minecraft */}
            <div className="pb-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Dot ok={minecraft.up} />
                Minecraft
                <span className="ml-auto text-xs font-normal text-ink-dim">
                  {minecraft.up ? "running" : "down"}
                  {minecraft.health ? ` · ${minecraft.health}` : ""}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Stat
                  label="Players online"
                  value={
                    minecraft.playersOnline == null
                      ? "—"
                      : `${minecraft.playersOnline} / ${minecraft.playersMax ?? "?"}`
                  }
                />
                <Stat label="Uptime" value={uptimeFromIso(minecraft.startedAt)} />
                <Stat
                  label="World size"
                  value={formatBytes(minecraft.worldBytes)}
                />
              </dl>
            </div>

            {/* wow */}
            <div className="py-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <Dot ok={wow.up} />
                WoW
                <span className="ml-auto text-xs font-normal text-ink-dim">
                  {wow.up ? "running" : "down"}
                  {wow.health ? ` · ${wow.health}` : ""}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <Stat label="Uptime" value={uptimeFromIso(wow.startedAt)} />
                <Stat
                  label="Accounts"
                  value={wow.accounts == null ? "—" : String(wow.accounts)}
                />
                <Stat
                  label="Chars online"
                  value={
                    wow.charactersOnline == null
                      ? "—"
                      : `${wow.charactersOnline} (inc. bots)`
                  }
                />
                <Stat label="DB size" value={formatBytes(wow.dbBytes)} />
              </dl>
            </div>

            {/* sites */}
            <div className="pt-4">
              <div className="mb-2 text-sm font-medium">Sites</div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {sites.map((site) => (
                  <li key={site.name} className="flex items-center gap-2">
                    <Dot ok={site.active} />
                    <span className="truncate">{site.label}</span>
                    <span className="ml-auto shrink-0 text-xs text-ink-dim">
                      {site.active ? "active" : "inactive"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* pacman: update severity, pending updates, installed packages */}
        <PackagesPanel className="max-lg:order-5" />

        <section className="panel border-danger/40 p-6 max-lg:order-6">
          <h2 className="mb-1 text-base font-semibold">Reboot server</h2>
          <p className="mb-4 text-xs text-ink-dim">
            Reboots the whole VPS. Every service — this panel included — drops for
            about a minute.
          </p>
          {rebootState === "done" ? (
            <p className="text-sm text-ink-dim">
              Reboot scheduled. This panel will be unreachable shortly.
            </p>
          ) : rebootState === "error" ? (
            <p className="text-sm text-danger">
              Failed to schedule reboot. Check the server logs.
            </p>
          ) : rebootArmed ? (
            <button
              className="btn btn-danger"
              disabled={rebootState === "sending"}
              onClick={doReboot}
            >
              {rebootState === "sending" ? "Scheduling…" : "Click again to confirm"}
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => setRebootArmed(true)}>
              Reboot server
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

// byjohnmichael*
