"use client";

// ./terminal — up to four shells on the server, tiled like Hyprland's dwindle
// layout. The + button splits: 1 fills the section, 2 sit side by side, the
// 3rd splits the right column, the 4th splits the left. When a shell exits
// (`exit`, Ctrl-D) its tile closes and the rest re-tile to fill the space.

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import TerminalPane from "@/components/terminal/TerminalPane";

const MAX_PANES = 4;

// grid-area (row-start / col-start / row-end / col-end) for each tile, by
// tile count, in the order the tiles were opened
const LAYOUTS: Record<number, string[]> = {
  1: ["1 / 1 / 3 / 3"],
  2: ["1 / 1 / 3 / 2", "1 / 2 / 3 / 3"],
  3: ["1 / 1 / 3 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3"],
  4: ["1 / 1 / 2 / 2", "1 / 2 / 2 / 3", "2 / 2 / 3 / 3", "2 / 1 / 3 / 2"],
};

export default function TerminalPage() {
  const nextId = useRef(2);
  const [panes, setPanes] = useState<number[]>([1]);
  const [focused, setFocused] = useState(1);

  function addPane() {
    if (panes.length >= MAX_PANES) return;
    const id = nextId.current++;
    setPanes([...panes, id]);
    setFocused(id);
  }

  function closePane(id: number) {
    const rest = panes.filter((x) => x !== id);
    setPanes(rest);
    // focus moves to the most recently opened tile that's left
    if (focused === id) setFocused(rest[rest.length - 1] ?? 0);
  }

  const layout = LAYOUTS[panes.length] ?? [];

  return (
    <section className="term-workspace panel">
      <div className="term-bar">
        <h2>terminal</h2>
        <span className="text-xs text-ink-dim tabular-nums">
          <span className="term-badge">
            {panes.length}/{MAX_PANES}
          </span>
        </span>
        <button
          type="button"
          onClick={addPane}
          disabled={panes.length >= MAX_PANES}
          className="btn btn-ghost btn-icon tap ml-auto"
          aria-label="Open another terminal"
          title={panes.length >= MAX_PANES ? "4 terminals is the max" : "Split: open another terminal"}
        >
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
            <path d="M8 2.5v11M2.5 8h11" />
          </svg>
        </button>
      </div>

      {panes.length === 0 ? (
        <div className="term-empty">
          <p className="text-sm text-ink-dim">All terminals are closed.</p>
          <button type="button" onClick={addPane} className="btn btn-accent">
            open a terminal
          </button>
        </div>
      ) : (
        <div className="term-tiles">
          <AnimatePresence initial={false}>
            {panes.map((id, i) => (
              <motion.div
                key={id}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: "spring", stiffness: 520, damping: 40 }}
                className="term-tile"
                data-focused={focused === id || undefined}
                style={{ gridArea: layout[i] }}
                onMouseDown={() => setFocused(id)}
              >
                <div className="term-tile-head">
                  <span>
                    <span className="text-accent">●</span> shell {id}
                  </span>
                  <button
                    type="button"
                    className="tap ml-auto px-1 text-ink-dim hover:text-ink"
                    onClick={() => closePane(id)}
                    aria-label={`Close shell ${id}`}
                  >
                    ×
                  </button>
                </div>
                <TerminalPane
                  focused={focused === id}
                  onFocus={() => setFocused(id)}
                  onExit={() => closePane(id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

// byjohnmichael*
