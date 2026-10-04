"use client";

// Keeps the terminal workspace alive across client-side navigation. It lives
// in the root layout, which stays mounted when you move between sections, so
// the shells keep running while ./terminal is hidden. Nothing starts until the
// terminal tab is first opened; a page reload (or signing out) drops the
// sockets, which kills the shells server-side.

import { useState } from "react";
import { usePathname } from "next/navigation";
import TerminalWorkspace from "./TerminalWorkspace";

export default function TerminalHost() {
  const pathname = usePathname();
  const onTerminal = pathname.startsWith("/terminal");
  const [started, setStarted] = useState(onTerminal);

  if (onTerminal && !started) setStarted(true);
  // signed out: tear everything down
  if (pathname.startsWith("/login")) {
    if (started) setStarted(false);
    return null;
  }
  if (!started) return null;

  return (
    <div hidden={!onTerminal}>
      <TerminalWorkspace />
    </div>
  );
}
