"use client";

// Small building blocks for the terminal look, shared by the pages.

import { useEffect, useRef, useState } from "react";
import { animate } from "motion";

/** Segmented block meter. `color` overrides the panel accent (e.g. danger). */
export function SegMeter({ pct, color }: { pct: number; color?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="seg-meter"
      style={color ? ({ "--meter": color } as React.CSSProperties) : undefined}
    >
      <i style={{ width: `${clamped}%` }} />
    </div>
  );
}

/** htop-style bracket meter: [|||||       ]. `width` is in characters. */
export function HtopMeter({ pct, width = 14 }: { pct: number; width?: number }) {
  const n = Math.round((Math.max(0, Math.min(100, pct)) / 100) * width);
  return (
    <span className="htop-bar" aria-hidden>
      [<em>{"|".repeat(n)}</em>
      {" ".repeat(width - n)}]
    </span>
  );
}

const SPIN = "⣾⣽⣻⢿⡿⣟⣯⣷";

/** Braille spinner whose speed follows `load` (0–1). Stills under reduced motion. */
export function Spinner({
  load,
  color,
  glow,
  size,
}: {
  load: number;
  color?: string;
  glow?: string;
  size?: number;
}) {
  const [i, setI] = useState(0);
  const ms = load > 0.7 ? 90 : load > 0.35 ? 160 : 280;
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((x) => (x + 1) % SPIN.length), ms);
    return () => clearInterval(id);
  }, [ms]);
  return (
    <span
      className="term-spin"
      aria-hidden
      style={{
        color,
        textShadow: glow ? `0 0 8px ${glow}` : undefined,
        fontSize: size,
        lineHeight: 1,
        transition: "color 0.8s ease, text-shadow 0.8s ease",
      }}
    >
      {SPIN[i]}
    </span>
  );
}

/** Number that counts up to `value` on mount and eases to each new value. */
export function CountUp({
  value,
  decimals = 0,
  suffix = "",
}: {
  value: number;
  decimals?: number;
  suffix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = (v: number) => {
      el.textContent = v.toFixed(decimals) + suffix;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      set(value);
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: 1,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: set,
    });
    from.current = value;
    return () => controls.stop();
  }, [value, decimals, suffix]);
  return (
    <span ref={ref} className="tabular-nums">
      {value.toFixed(decimals) + suffix}
    </span>
  );
}

// byjohnmichael*
