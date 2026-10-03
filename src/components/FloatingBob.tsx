"use client";

// Bob the Orb, docked bottom-right on every page. The orb shows the server's
// live status; clicking it opens a small chat with Bob.
//
// The chat talks to Bob's backend (bob-the-orb-server) over a WebSocket at
// /ws on this same origin — nginx proxies it to the backend and only lets it
// through for a logged-in admin (see README → Bob the Orb).

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { ChatPanel, Orb, createClaudeCodeAdapter } from "bob-the-orb";
import { bobReading } from "@/lib/perf/orbs";
import { usePerf } from "@/lib/perf/usePerf";

// phones keep the smaller orb so he doesn't cover content
const PHONE_QUERY = "(max-width: 639px)";
function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

export default function FloatingBob() {
  const pathname = usePathname();
  const perf = usePerf();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  // the chat mounts on first open and then stays mounted (just hidden), so
  // closing and reopening keeps the connection and the conversation
  const [opened, setOpened] = useState(false);

  // one adapter for the life of the page; pinned to this origin because the
  // site is served over https and nginx proxies /ws to the backend
  const adapter = useMemo(
    () =>
      createClaudeCodeAdapter({
        backendUrl: typeof window !== "undefined" ? window.location.origin : undefined,
      }),
    [],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (pathname === "/login") return null;

  const reading = perf ? bobReading(perf) : null;
  const status = reading?.mood ?? "connecting";

  return (
    // hidden (not unmounted) on ./terminal, where he'd cover a shell — the
    // chat keeps its conversation for when you come back
    <div className="bob-dock" hidden={pathname === "/terminal"}>
      {opened && (
        <motion.div
          className="bob-pop panel"
          role="dialog"
          aria-label="Chat with Bob"
          aria-hidden={!open}
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={
            open
              ? { opacity: 1, y: 0, scale: 1, visibility: "visible" }
              : { opacity: 0, y: 12, scale: 0.96, transitionEnd: { visibility: "hidden" } }
          }
          transition={{ type: "spring", stiffness: 420, damping: 32 }}
        >
          <div className="bob-pop-head">
            <h2>bob</h2>
            <span className="text-xs text-ink-dim">{status}</span>
            <button
              className="tap ml-auto px-2 text-ink-dim hover:text-ink"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>
          <div className="bob-pop-body">
            <ChatPanel adapter={adapter} />
          </div>
        </motion.div>
      )}

      <motion.button
        className="bob-orb-btn"
        onClick={() => {
          setOpened(true);
          setOpen((o) => !o);
        }}
        aria-label={open ? "Close chat with Bob" : `Chat with Bob — status: ${status}`}
        aria-expanded={open}
        title={`Bob · ${status}`}
        whileHover={{ scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
      >
        {reading ? (
          <Orb reading={reading} size={isPhone ? 64 : 84} />
        ) : (
          <span className="bob-orb-placeholder" aria-hidden />
        )}
      </motion.button>
    </div>
  );
}

// byjohnmichael*
