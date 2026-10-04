"use client";

// useState for fetched data that survives navigating between sections.
// The cache is module-level, so it lives as long as the browser tab does
// (client-side navigation keeps it, a reload clears it). A page that
// remounts starts from the last data it saw and just refreshes behind it,
// instead of flashing an empty "Loading…" state.

import { useCallback, useState, type SetStateAction } from "react";

const cache = new Map<string, unknown>();

export function useCachedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() =>
    cache.has(key) ? (cache.get(key) as T) : initial,
  );

  const set = useCallback(
    (next: SetStateAction<T>) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        cache.set(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, set] as const;
}
