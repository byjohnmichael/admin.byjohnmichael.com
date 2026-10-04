"use client";

import { useCallback, useEffect, useState } from "react";
import { useCachedState } from "@/lib/useCachedState";

type AccountRequest = {
  id: string;
  username: string;
  requestedAt: string;
};

type WowCharacter = {
  name: string;
  level: number;
  race: string;
  class: string;
  hoursPlayed: number;
  account: string;
  online: boolean;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function WowPage() {
  const [requests, setRequests] = useCachedState<AccountRequest[]>("wow:requests", []);
  const [characters, setCharacters] = useCachedState<WowCharacter[]>("wow:characters", []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useCachedState("wow:loading", true);

  const loadRequests = useCallback(async () => {
    const res = await fetch("/api/wow/accounts");
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests ?? []);
    }
  }, []);

  const loadCharacters = useCallback(async () => {
    const res = await fetch("/api/wow/characters");
    if (res.ok) {
      const data = await res.json();
      setCharacters(data.characters ?? []);
    }
  }, []);

  useEffect(() => {
    Promise.all([loadRequests(), loadCharacters()]).finally(() =>
      setLoading(false),
    );
    const interval = setInterval(() => {
      loadRequests();
      loadCharacters();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadRequests, loadCharacters]);

  async function respond(id: string, action: "accept" | "deny") {
    setBusyId(id);
    setMessage("");
    try {
      const res = await fetch("/api/wow/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Failed to update request.");
      } else {
        await loadRequests();
        if (action === "accept") await loadCharacters();
      }
    } catch {
      setMessage("Failed to reach the server.");
    } finally {
      setBusyId(null);
    }
  }

  const onlineCount = characters.filter((c) => c.online).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="panel p-6">
        <h1 className="text-lg font-semibold text-ink">WoW</h1>
        <p className="mt-1 text-sm text-ink-dim">
          cmangos-wotlk · {characters.length} characters ·{" "}
          {onlineCount} online
        </p>
      </div>

      {message && (
        <div className="panel p-4 text-sm text-danger">{message}</div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">
            Characters
          </h2>
          {loading ? (
            <p className="text-sm text-ink-dim">Loading...</p>
          ) : characters.length === 0 ? (
            <p className="text-sm text-ink-dim">No characters yet.</p>
          ) : (
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="text-ink-dim">
                    <th className="pb-2 pr-2 font-medium">Name</th>
                    <th className="pb-2 pr-2 font-medium">Lvl</th>
                    <th className="pb-2 pr-2 font-medium">Race / Class</th>
                    <th className="pb-2 pr-2 font-medium">Hours</th>
                    <th className="pb-2 pr-2 font-medium">Account</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {characters.map((c) => (
                    <tr key={c.name} className="border-t border-panel-border/60">
                      <td className="py-2 pr-2 text-ink">{c.name}</td>
                      <td className="py-2 pr-2 tabular-nums text-ink-dim">
                        {c.level}
                      </td>
                      <td className="py-2 pr-2 text-ink-dim">
                        {c.race} {c.class}
                      </td>
                      <td className="py-2 pr-2 tabular-nums text-ink-dim">
                        {c.hoursPlayed.toFixed(1)}
                      </td>
                      <td className="py-2 pr-2 text-ink-dim">{c.account}</td>
                      <td className="py-2">
                        {c.online ? (
                          <span className="text-accent">Online</span>
                        ) : (
                          <span className="text-ink-dim">Offline</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">
            Pending account requests
          </h2>
          {loading ? (
            <p className="text-sm text-ink-dim">Loading...</p>
          ) : requests.length === 0 ? (
            <p className="text-sm text-ink-dim">No pending requests.</p>
          ) : (
            <ul className="flex max-h-[32rem] flex-col gap-3 overflow-y-auto">
              {requests.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-sm border border-panel-border/60 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {r.username}
                    </p>
                    <p className="text-xs text-ink-dim">
                      requested {formatDate(r.requestedAt)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => respond(r.id, "accept")}
                      disabled={busyId === r.id}
                      className="btn btn-accent px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => respond(r.id, "deny")}
                      disabled={busyId === r.id}
                      className="btn btn-danger px-3 py-1.5 text-xs disabled:opacity-50"
                    >
                      Deny
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// byjohnmichael*
