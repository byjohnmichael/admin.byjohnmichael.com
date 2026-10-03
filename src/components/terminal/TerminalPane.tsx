"use client";

// One xterm.js terminal wired to a shell on the server (scripts/terminal-server.mjs).
// It refits itself whenever its tile changes size, and calls onExit when the
// shell exits (`exit`, Ctrl-D) so the page can close the tile.

import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

/** Same-origin /term (nginx proxies it to the backend); NEXT_PUBLIC_TERMINAL_URL overrides. */
function socketUrl(cols: number, rows: number): string {
  const base =
    process.env.NEXT_PUBLIC_TERMINAL_URL ??
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/term`;
  return `${base}?cols=${cols}&rows=${rows}`;
}

// site palette, as xterm colours
const THEME = {
  background: "#0a080c",
  foreground: "#ece7ec",
  cursor: "#e01e37",
  cursorAccent: "#0a080c",
  selectionBackground: "#e01e3766",
  black: "#1a1418",
  red: "#ff5470",
  green: "#5ef08a",
  yellow: "#ffe14d",
  blue: "#4ac8ff",
  magenta: "#c08cff",
  cyan: "#5fe0d8",
  white: "#ece7ec",
  brightBlack: "#5d5260",
  brightRed: "#ff8095",
  brightGreen: "#8af5ab",
  brightYellow: "#ffeb85",
  brightBlue: "#84dbff",
  brightMagenta: "#d6b3ff",
  brightCyan: "#93ece6",
  brightWhite: "#ffffff",
};

export default function TerminalPane({
  focused,
  onFocus,
  onExit,
}: {
  focused: boolean;
  onFocus: () => void;
  onExit: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ focus: () => void } | null>(null);
  const focusedRef = useRef(focused);
  // callbacks change every render; the effect below must not re-run for them
  const onFocusRef = useRef(onFocus);
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onFocusRef.current = onFocus;
    onExitRef.current = onExit;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};

    // xterm touches window on import, so load it client-side only
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed) return;

      const term = new Terminal({
        fontFamily: getComputedStyle(document.body).fontFamily,
        fontSize: 13,
        lineHeight: 1.15,
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 5000,
        theme: THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(host);
      fit.fit();
      termRef.current = term;

      const ws = new WebSocket(socketUrl(term.cols, term.rows));
      let opened = false;
      const send = (msg: object) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      };

      ws.onopen = () => {
        opened = true;
      };
      ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : "");
      ws.onclose = (e) => {
        if (disposed) return;
        if (e.code === 4000) return onExitRef.current(); // the shell exited
        term.write(
          opened
            ? "\r\n\x1b[31m[connection lost]\x1b[0m close this pane and open a new one.\r\n"
            : "\r\n\x1b[31m[could not connect]\x1b[0m is the terminal backend running? (README → Terminal)\r\n",
        );
      };

      const input = term.onData((data) => send({ type: "input", data }));
      const resize = term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));
      term.textarea?.addEventListener("focus", () => onFocusRef.current());

      // refit on any tile size change (splits, window resize, fullscreen)
      let frame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
        });
      });
      observer.observe(host);

      if (focusedRef.current) term.focus();

      cleanup = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        input.dispose();
        resize.dispose();
        ws.onclose = null;
        ws.close();
        term.dispose();
        termRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    focusedRef.current = focused;
    if (focused) termRef.current?.focus();
  }, [focused]);

  return <div ref={hostRef} className="term-host" />;
}

// byjohnmichael*
