"use client";

// Minecraft server health: TPS / tick time graphs, Spark profiler reports,
// and the backup snapshot list. Moved here from the Performance page.

import { useCallback, useEffect, useState } from "react";
import { HoverSparkline } from "@/components/perf/DotGraph";
import type {
  BackupSnapshot,
  BackupsResponse,
  McPerfResponse,
  SparkAction,
} from "@/lib/perf/types";
import { fmtBytes, msptColor, tpsColor } from "@/lib/perf/format";

function BackupTable({
  title,
  snapshots,
}: {
  title: string;
  snapshots: BackupSnapshot[] | undefined;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-ink-dim uppercase">
        {title}
      </h3>
      {!snapshots ? (
        <p className="text-sm text-ink-dim">Loading...</p>
      ) : snapshots.length === 0 ? (
        <p className="text-sm text-ink-dim">No backups yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-panel-border text-ink-dim">
              <th className="py-2 pr-4 font-medium">Backed up</th>
              <th className="py-2 pr-4 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            {snapshots.map((s) => (
              <tr key={s.id} className="border-b border-panel-border/60">
                <td className="py-2 pr-4">{new Date(s.time).toLocaleString()}</td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {fmtBytes(s.sizeBytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}


export default function McServerPanel() {
  const [mcPerf, setMcPerf] = useState<McPerfResponse | null>(null);
  const [sparkBusy, setSparkBusy] = useState<SparkAction | null>(null);
  const [sparkResult, setSparkResult] = useState<
    Record<SparkAction, { url?: string; error?: string }>
  >({ health: {}, flamegraph: {} });
  const [backups, setBackups] = useState<BackupsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/mc/performance")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setMcPerf(d);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/mc/backups")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setBackups(d);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const runSparkAction = useCallback(async (action: SparkAction) => {
    setSparkBusy(action);
    setSparkResult((prev) => ({ ...prev, [action]: {} }));
    try {
      const response = await fetch("/api/mc/spark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json();
      setSparkResult((prev) => ({
        ...prev,
        [action]: response.ok
          ? { url: data.url }
          : { error: data.error ?? "Failed." },
      }));
    } catch {
      setSparkResult((prev) => ({
        ...prev,
        [action]: { error: "Request failed." },
      }));
    }
    setSparkBusy(null);
  }, []);


  return (
    <>
        <section className="panel p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2>server health</h2>
            {mcPerf?.error && <p className="text-xs text-danger">{mcPerf.error}</p>}
          </div>
          {!mcPerf?.current ? (
            !mcPerf?.error && <p className="text-sm text-ink-dim">Loading...</p>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-xs font-medium tracking-wide text-ink-dim uppercase">
                      TPS
                    </span>
                    <span className="text-xs tabular-nums text-ink-dim">
                      5m {mcPerf.current.tps5m?.toFixed(1) ?? "—"} · 15m{" "}
                      {mcPerf.current.tps15m?.toFixed(1) ?? "—"}
                    </span>
                  </div>
                  <div
                    className="mb-2 text-4xl leading-none font-semibold tabular-nums"
                    style={{ color: tpsColor(mcPerf.current.tps1m) }}
                  >
                    {mcPerf.current.tps1m?.toFixed(1) ?? "—"}
                  </div>
                  <div className="h-28">
                    <HoverSparkline
                      points={mcPerf.history.map((h) => ({
                        t: h.t,
                        v: h.tps1m ?? 0,
                      }))}
                      color={tpsColor(mcPerf.current.tps1m)}
                      fmt={(v) => v.toFixed(1)}
                      max={20}
                      grid
                    />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="text-xs font-medium tracking-wide text-ink-dim uppercase">
                      Tick time (ms, avg 5s)
                    </span>
                    <span className="text-xs tabular-nums text-ink-dim">
                      min {mcPerf.current.msptMin5s?.toFixed(1) ?? "—"} · max{" "}
                      {mcPerf.current.msptMax5s?.toFixed(1) ?? "—"}
                    </span>
                  </div>
                  <div
                    className="mb-2 text-4xl leading-none font-semibold tabular-nums"
                    style={{ color: msptColor(mcPerf.current.msptAvg5s) }}
                  >
                    {mcPerf.current.msptAvg5s?.toFixed(1) ?? "—"}
                  </div>
                  <div className="h-28">
                    <HoverSparkline
                      points={mcPerf.history.map((h) => ({
                        t: h.t,
                        v: h.msptAvg5s ?? 0,
                      }))}
                      color={msptColor(mcPerf.current.msptAvg5s)}
                      fmt={(v) => `${v.toFixed(1)} ms`}
                      max={60}
                      grid
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-panel-border/60 pt-6">
                <button
                  className="btn btn-ghost"
                  disabled={sparkBusy !== null}
                  onClick={() => runSparkAction("health")}
                >
                  {sparkBusy === "health" ? "Generating..." : "spark: health report"}
                </button>
                <button
                  className="btn btn-ghost"
                  disabled={sparkBusy !== null}
                  onClick={() => runSparkAction("flamegraph")}
                >
                  {sparkBusy === "flamegraph" ? "Generating..." : "spark: flame graph"}
                </button>
                {(["health", "flamegraph"] as SparkAction[]).map((action) =>
                  sparkResult[action].url ? (
                    <a
                      key={action}
                      href={sparkResult[action].url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-accent underline"
                    >
                      {sparkResult[action].url}
                    </a>
                  ) : sparkResult[action].error ? (
                    <p key={action} className="text-xs text-danger">
                      {sparkResult[action].error}
                    </p>
                  ) : null,
                )}
              </div>
            </>
          )}
        </section>

        <section className="panel p-6">
          <h2 className="mb-4">backups</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <BackupTable title="Monthly (1st of month · kept 6 months)" snapshots={backups?.monthly} />
            <BackupTable title="Hourly (every hour · kept 24 hours)" snapshots={backups?.hourly} />
          </div>
        </section>
    </>
  );
}

// byjohnmichael*
