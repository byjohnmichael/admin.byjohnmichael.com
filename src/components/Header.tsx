"use client";

import { usePathname } from "next/navigation";
import NavTabs from "./NavTabs";
import LogoutButton from "./LogoutButton";

// The command "typed" into the header prompt for each section.
const PROMPT_CMD: { prefix: string; cmd: string }[] = [
  { prefix: "/performance", cmd: "btop" },
  { prefix: "/monitor", cmd: "watch -n2 status" },
  { prefix: "/mc", cmd: "rcon-cli list" },
  { prefix: "/wow", cmd: "docker ps --filter name=wow" },
  { prefix: "/", cmd: "systemctl status --all" },
];

export default function Header() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  const cmd =
    PROMPT_CMD.find((p) =>
      p.prefix === "/" ? pathname === "/" : pathname.startsWith(p.prefix),
    )?.cmd ?? "";

  return (
    <header className="site-header flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-panel-border px-4 pt-3 sm:px-6 sm:pt-4">
      <span className="term-prompt order-1 min-w-0 flex-1 overflow-hidden text-sm text-ellipsis whitespace-nowrap">
        [<b>jm</b>@<em>byjohnmichael</em> ~]${" "}
        {/* keyed by route so the typing animation replays on navigation */}
        <span
          key={pathname}
          className="term-typed"
          style={{ "--n": cmd.length } as React.CSSProperties}
        >
          {cmd}
        </span>
        <span className="term-cursor" aria-hidden />
      </span>
      {/* nav sits on its own row under the prompt */}
      <div className="order-3 w-full">
        <NavTabs />
      </div>
      <div className="order-2 ml-auto">
        <LogoutButton />
      </div>
    </header>
  );
}

// byjohnmichael*
