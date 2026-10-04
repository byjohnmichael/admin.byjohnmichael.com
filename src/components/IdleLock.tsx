"use client";

// Screen lock for an admin panel that's left up on a second monitor. After
// IDLE_MS with no input nothing changes on screen, so you can keep watching
// the dashboards. The next time you touch the page that input is swallowed,
// the page blurs, and a password prompt for the signed-in user appears.
//
// The lock is enforced server-side too: locking tells the server
// (/api/lock), which then treats this session as read-only (proxy.ts) until
// /api/unlock accepts the password. The server is the source of truth, so a
// reload, a second tab or a copied cookie all come back locked.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";

const IDLE_MS = 10 * 60_000;
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export default function IdleLock() {
  const pathname = usePathname();
  const router = useRouter();
  const enabled = !pathname.startsWith("/login");

  const [locked, setLocked] = useState(false);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // refs so the window listeners (added once) always see current values
  const lockedRef = useRef(false);
  const armedRef = useRef(false); // idle long enough; next input locks
  const lastRef = useRef(0);

  // fromServer: the server already says it's locked, nothing to tell it
  function lock(fromServer = false) {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
    if (!fromServer) fetch("/api/lock", { method: "POST" }).catch(() => {});
    // a focused terminal would otherwise keep receiving keystrokes
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  useEffect(() => {
    if (!enabled) return;
    lastRef.current = Date.now();
    armedRef.current = false;
    // pick up a lock the server already holds (reload, another tab) and any
    // that appears later
    const sync = () =>
      fetch("/api/unlock")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.locked && lock(true))
        .catch(() => {});
    sync();
    const syncTimer = setInterval(sync, 15_000);

    function onInput(e: Event) {
      if (lockedRef.current) return; // the overlay handles it
      if (armedRef.current) {
        // the input that wakes the page is swallowed, not delivered
        e.stopPropagation();
        e.preventDefault();
        armedRef.current = false;
        lock();
        return;
      }
      lastRef.current = Date.now();
    }
    for (const t of ACTIVITY) window.addEventListener(t, onInput, { capture: true, passive: false });

    const timer = setInterval(() => {
      if (!lockedRef.current && Date.now() - lastRef.current >= IDLE_MS) {
        armedRef.current = true;
      }
    }, 5_000);

    return () => {
      for (const t of ACTIVITY) window.removeEventListener(t, onInput, { capture: true });
      clearInterval(timer);
      clearInterval(syncTimer);
    };
    // lock() only touches refs/state setters
  }, [enabled]);

  useEffect(() => {
    if (!locked) return;
    inputRef.current?.focus();
    if (!user) {
      fetch("/api/unlock")
        .then((r) => {
          if (r.status === 401) router.push("/login"); // session expired
          return r.ok ? r.json() : null;
        })
        .then((d) => d?.user && setUser(d.user))
        .catch(() => {});
    }
  }, [locked, user, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401 && (await res.clone().json().catch(() => ({}))).error === "Not authenticated.") {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not unlock.");
        setPassword("");
        inputRef.current?.focus();
        return;
      }
      lockedRef.current = false;
      lastRef.current = Date.now();
      armedRef.current = false;
      setPassword("");
      setLocked(false);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!enabled || !locked) return null;

  return (
    <div className="idle-lock" role="dialog" aria-modal="true" aria-label="Screen locked">
      <form onSubmit={submit} className="panel flex w-full max-w-sm flex-col gap-4 p-8">
        <h2 className="text-lg font-semibold">Locked</h2>
        <p className="-mt-2 text-xs text-ink-dim">
          Idle for a while. Enter the password for <b className="text-ink">{user || "…"}</b> to continue.
        </p>
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          aria-label="password"
          autoFocus
          required
          className="input"
        />
        <button type="submit" disabled={busy} className="btn btn-accent w-full">
          {busy ? "Checking..." : "Unlock"}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </div>
  );
}

// byjohnmichael*
