"use client";

// One shared poller for /api/performance. Every component that calls
// usePerf() (the floating Bob, the monitor page) reads the same response, so
// mounting several of them doesn't multiply requests.

import { useSyncExternalStore } from "react";
import type { PerfResponse } from "./types";

const POLL_MS = 4000;

let latest: PerfResponse | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll() {
  try {
    const r = await fetch("/api/performance");
    if (!r.ok) return;
    latest = (await r.json()) as PerfResponse;
    listeners.forEach((l) => l());
  } catch {
    // keep the last good reading; the next poll may succeed
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    void poll();
    timer = setInterval(poll, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function usePerf(): PerfResponse | null {
  return useSyncExternalStore(
    subscribe,
    () => latest,
    () => null,
  );
}

// byjohnmichael*
