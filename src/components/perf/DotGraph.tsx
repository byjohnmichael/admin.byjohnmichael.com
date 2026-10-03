"use client";

import { useEffect, useRef, useState } from "react";
import { ACCENT } from "@/lib/perf/format";

// Resolve "var(--x)" to its computed value so canvas can paint it.
function resolveColor(el: Element, c: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
  if (!m) return c;
  return getComputedStyle(el).getPropertyValue(m[1]).trim() || "#888";
}

// btop-style dot-matrix graph. Series 1 lights up columns of dots (brighter
// toward the top); series 2 is either a brighter subset drawn inside series 1
// (e.g. RAM in-use within total) or, with `mirror`, its own graph hanging
// below a centre line (read/write, down/up). Series 3 is a plain line on its
// own scale (temperatures). Hover shows a readout for that moment.
export function HoverSparkline({
  points,
  points2,
  points3,
  color = ACCENT,
  color2,
  color3,
  keys,
  fmt,
  fmt2,
  fmt3,
  grid = false,
  max: maxProp,
  max2: max2Prop,
  max3: max3Prop,
  fillSecond = true,
  mirror = false,
}: {
  points: { t: number; v: number }[];
  /** optional second series: a subset inside series 1, or mirrored below it */
  points2?: { t: number; v: number }[];
  /** optional third series — always line-only, may use its own scale (max3) */
  points3?: { t: number; v: number }[];
  color?: string;
  color2?: string;
  color3?: string;
  /** labels per series [1, 2, 3] — shows an inline key + richer tooltip */
  keys?: string[];
  fmt: (v: number) => string;
  fmt2?: (v: number) => string;
  fmt3?: (v: number) => string;
  /** draws a faint frame around the graph */
  grid?: boolean;
  /** full-scale value for series 1; defaults to 100 (percentage graphs) */
  max?: number;
  /** independent full-scale for series 2 / 3; default to `max` */
  max2?: number;
  max3?: number;
  /** whether series 2 lights its dots (default true) or only its top dot */
  fillSecond?: boolean;
  /** draw series 2 downward from a centre line instead of inside series 1 */
  mirror?: boolean;
}) {
  const [hi, setHi] = useState<number | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const n = points.length;
  const max = maxProp ?? 100;
  const max2 = max2Prop ?? max;
  const max3 = max3Prop ?? max;
  const f2 = fmt2 ?? fmt;
  const f3 = fmt3 ?? fmt;
  const c2 = color2 ?? color;
  const c3 = color3 ?? color;
  const has2 = !!points2 && points2.length === n;
  const has3 = !!points3 && points3.length === n;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setBox({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap || box.w < 8 || box.h < 8) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(box.w * dpr);
    cv.height = Math.round(box.h * dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    const PITCH = 4;
    const R = 1.1;
    const cols = Math.floor(box.w / PITCH);
    const rows = Math.floor(box.h / PITCH);
    const mid = mirror && has2 ? Math.floor(rows / 2) : rows;
    const col1 = resolveColor(wrap, color);
    const col2 = resolveColor(wrap, c2);
    const at = (c: number) =>
      n < 2 ? 0 : Math.round((c / Math.max(1, cols - 1)) * (n - 1));
    const frac = (v: number, m: number) => Math.max(0, Math.min(1, v / m));
    const hiCol =
      hi != null && n > 1 ? Math.round((hi / (n - 1)) * (cols - 1)) : null;

    for (let c = 0; c < cols && n > 0; c++) {
      const i = at(c);
      const h1 = Math.round(frac(points[i].v, max) * mid);
      const h2 = has2
        ? Math.round(frac(points2![i].v, max2) * (mirror ? rows - mid : mid))
        : 0;
      const x = c * PITCH + PITCH / 2;
      for (let r = 0; r < rows; r++) {
        let fill = c === hiCol ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.045)";
        let alpha = 1;
        if (r < mid) {
          const lvl = mid - r; // 1 at the baseline, up to `mid`
          const t = lvl / mid;
          if (has2 && !mirror && (fillSecond ? lvl <= h2 : lvl === h2)) {
            fill = col2;
            alpha = 0.45 + 0.55 * t;
          } else if (lvl <= h1) {
            fill = col1;
            alpha = has2 && !mirror ? 0.3 + 0.3 * t : 0.35 + 0.65 * t;
          }
        } else {
          const lvl = r - mid + 1; // 1 just under the centre line
          if (lvl <= h2) {
            fill = col2;
            alpha = 0.35 + (0.65 * lvl) / (rows - mid);
          }
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x, r * PITCH + PITCH / 2, R, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    if (mirror && has2) {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, mid * PITCH - 0.5, box.w, 1);
    }
    if (has3 && n > 1) {
      ctx.strokeStyle = resolveColor(wrap, c3);
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 3;
      ctx.beginPath();
      points3!.forEach((p, i) => {
        const x = (i / (n - 1)) * box.w;
        const y = box.h - frac(p.v, max3) * box.h;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (hiCol != null) {
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(hiCol * PITCH + PITCH / 2 - 0.5, 0, 1, box.h);
    }
  }, [box, points, points2, points3, color, c2, c3, max, max2, max3, hi, n, has2, has3, mirror, fillSecond]);

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (n < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    setHi(Math.max(0, Math.min(n - 1, Math.round(f * (n - 1)))));
  };
  const hp = hi != null ? points[hi] : null;
  const hp2 = hi != null && has2 ? points2![hi] : null;
  const hp3 = hi != null && has3 ? points3![hi] : null;
  const hpct = hi != null && n > 1 ? (hi / (n - 1)) * 100 : 0;
  const last = points[n - 1];

  const legend = [
    { label: keys?.[0], color, v: points[n - 1]?.v, fmt },
    has2 && { label: keys?.[1], color: c2, v: points2![n - 1]?.v, fmt: f2 },
    has3 && { label: keys?.[2], color: c3, v: points3![n - 1]?.v, fmt: f3 },
  ].filter(Boolean) as {
    label?: string;
    color: string;
    v: number;
    fmt: (v: number) => string;
  }[];

  return (
    <div
      ref={wrapRef}
      className={`relative h-full min-h-[3rem] flex-1 cursor-crosshair ${grid ? "border border-panel-border/70" : ""}`}
      onMouseMove={onMove}
      onMouseLeave={() => setHi(null)}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {keys && last && legend.length > 0 && (
        <div className="pointer-events-none absolute top-1.5 left-2 flex flex-col gap-0.5 bg-panel/70 px-1 py-0.5 text-[10px] leading-none tabular-nums">
          {legend.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5 text-ink-dim">
              <span
                className="inline-block h-2 w-2"
                style={{ background: s.color }}
              />
              {s.label} {s.fmt(s.v)}
            </span>
          ))}
        </div>
      )}

      {hp && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 border border-panel-border bg-panel px-2 py-1 text-xs tabular-nums whitespace-nowrap"
          style={{ left: `${Math.max(6, Math.min(94, hpct))}%` }}
        >
          {keys && (hp2 || hp3) ? (
            <>
              {keys[0]} {fmt(hp.v)}
              {hp2 && ` · ${keys[1]} ${f2(hp2.v)}`}
              {hp3 && ` · ${keys[2]} ${f3(hp3.v)}`}
              <br />
            </>
          ) : (
            <>{fmt(hp.v)} · </>
          )}
          {new Date(hp.t).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}

// byjohnmichael*
