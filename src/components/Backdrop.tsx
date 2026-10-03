// Animated page backdrop, fixed behind all content: drifting glows, a red
// grid floor scrolling toward a pulsing horizon, embers rising off it, a CRT
// scan beam, then a dot grid, vignette and film grain. Pure CSS — see the
// "backdrop" section of globals.css.

// Fixed (not random) so server and client render the same markup.
const EMBERS = [
  { x: 6, d: 13, delay: -2, s: 2, drift: 18 },
  { x: 13, d: 17, delay: -9, s: 1, drift: -12 },
  { x: 21, d: 11, delay: -5, s: 2, drift: 10 },
  { x: 28, d: 15, delay: -12, s: 1, drift: -20 },
  { x: 35, d: 19, delay: -3, s: 3, drift: 14 },
  { x: 42, d: 12, delay: -7, s: 1, drift: -8 },
  { x: 49, d: 16, delay: -14, s: 2, drift: 22 },
  { x: 55, d: 14, delay: -1, s: 1, drift: -16 },
  { x: 62, d: 18, delay: -10, s: 2, drift: 12 },
  { x: 69, d: 12, delay: -6, s: 3, drift: -10 },
  { x: 76, d: 15, delay: -13, s: 1, drift: 18 },
  { x: 83, d: 17, delay: -4, s: 2, drift: -14 },
  { x: 90, d: 13, delay: -8, s: 1, drift: 8 },
  { x: 96, d: 16, delay: -11, s: 2, drift: -18 },
];

export default function Backdrop() {
  return (
    <div className="backdrop" aria-hidden>
      <div className="bd-glow" />
      <div className="bd-horizon" />
      <div className="bd-floor" />
      <div className="bd-embers">
        {EMBERS.map((e, i) => (
          <i
            key={i}
            style={
              {
                left: `${e.x}%`,
                width: e.s,
                height: e.s,
                animationDuration: `${e.d}s`,
                animationDelay: `${e.delay}s`,
                "--drift": `${e.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>
      <div className="bd-beam" />
      <div className="bd-dots" />
      <div className="bd-grain" />
    </div>
  );
}

// byjohnmichael*
