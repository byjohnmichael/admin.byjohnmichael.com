"use client";

// Overview side panel: pacman status. Read-only — shows how pressing pending
// updates are, what they are, and every installed package. Upgrading is left
// to a terminal on purpose.

import { useCallback, useEffect, useState } from "react";
import { useCachedState } from "@/lib/useCachedState";
import type { PackagesStatus, UpdateSeverity } from "@/lib/packages";

const POLL_MS = 5 * 60_000;

const SEVERITY_COLOR: Record<UpdateSeverity, string> = {
  "up to date": "#4ade80",
  "not needed": "var(--ink-dim)",
  suggested: "#f5a524",
  needed: "var(--danger)",
};

function ago(iso: string | number | null): string {
  if (iso == null) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default function PackagesPanel({ className = "" }: { className?: string }) {
  const [data, setData] = useCachedState<PackagesStatus | null>("packages:data", null);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(
    (refresh = false) =>
      fetch(`/api/system/packages${refresh ? "?refresh=1" : ""}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d))
        .catch(() => {}),
    [],
  );

  function checkAgain() {
    setChecking(true);
    load(true).finally(() => setChecking(false));
  }

  useEffect(() => {
    load();
    const id = setInterval(() => load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!data) {
    return (
      <section className={`panel p-6 ${className}`}>
        <h2 className="mb-2">packages</h2>
        <p className="text-sm text-ink-dim">Checking pacman…</p>
      </section>
    );
  }
  if (!data.available) {
    return (
      <section className={`panel p-6 ${className}`}>
        <h2 className="mb-2">packages</h2>
        <p className="text-sm text-ink-dim">{data.error}</p>
      </section>
    );
  }

  const { level, reasons } = data.severity;
  const q = query.trim().toLowerCase();
  const shown = q ? data.installed.filter((p) => p.name.includes(q)) : data.installed;
  const explicitCount = data.installed.filter((p) => p.explicit).length;

  return (
    <section className={`panel p-6 ${className}`}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2>packages</h2>
        <span className="text-xs text-ink-dim">pacman{data.busy ? " · busy" : ""}</span>
      </div>

      {/* severity */}
      <div className="mb-3 flex items-center gap-3">
        <span
          className="term-badge border px-1.5 py-0.5 text-sm font-bold"
          style={{ color: SEVERITY_COLOR[level], borderColor: SEVERITY_COLOR[level] }}
        >
          {level}
        </span>
        <span className="text-sm tabular-nums">
          {data.updates.length === 0
            ? "no updates pending"
            : `${data.updates.length} update${data.updates.length === 1 ? "" : "s"} available`}
        </span>
      </div>
      {reasons.length > 0 && (
        <ul className="mb-3 flex flex-col gap-0.5 text-xs text-ink-dim">
          {reasons.map((r) => (
            <li key={r}>
              <span className="text-accent">&gt; </span>
              {r}
            </li>
          ))}
        </ul>
      )}
      <dl className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-ink-dim">last full upgrade</dt>
        <dd className="text-right tabular-nums">{ago(data.lastUpgrade)}</dd>
        <dt className="text-ink-dim">checked</dt>
        <dd className="text-right tabular-nums">
          {ago(data.updatesCheckedAt)}
          {data.updatesSource === "local" && " (local db)"}
        </dd>
      </dl>
      {data.updatesError && <p className="mb-3 text-xs text-danger">{data.updatesError}</p>}
      {data.updatesSource === "local" && (
        <p className="mb-3 text-xs text-ink-dim">
          Install <code className="text-ink">pacman-contrib</code> for live update checks.
        </p>
      )}
      <button className="btn btn-ghost mb-4" disabled={checking} onClick={checkAgain}>
        {checking ? "checking…" : "check again"}
      </button>

      {/* pending updates */}
      {data.updates.length > 0 && (
        <>
          <div className="mb-1 text-xs font-semibold text-ink-dim">pending</div>
          <ul className="mb-4 max-h-40 overflow-y-auto border border-dashed border-panel-border text-xs">
            {data.updates.map((u) => (
              <li key={u.name} className="flex gap-2 border-b border-panel-border/50 px-2 py-1 last:border-b-0">
                <span className="min-w-0 truncate">{u.name}</span>
                <span className="ml-auto shrink-0 text-ink-dim tabular-nums">
                  {u.from} → <span className="text-ink">{u.to}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* installed */}
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-ink-dim">installed</span>
        <span className="text-ink-dim tabular-nums">
          {data.installed.length} · {explicitCount} explicit
        </span>
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="filter packages…"
        aria-label="Filter installed packages"
        className="input mb-2 w-full text-xs"
      />
      <ul className="max-h-64 overflow-y-auto border border-dashed border-panel-border text-xs">
        {shown.map((p) => (
          <li key={p.name} className="flex gap-2 border-b border-panel-border/50 px-2 py-1 last:border-b-0">
            <span className={`min-w-0 truncate ${p.explicit ? "text-ink" : "text-ink-dim"}`}>{p.name}</span>
            <span className="ml-auto shrink-0 text-ink-dim tabular-nums">{p.version}</span>
          </li>
        ))}
        {shown.length === 0 && <li className="px-2 py-1 text-ink-dim">No matches.</li>}
      </ul>
    </section>
  );
}

// byjohnmichael*
