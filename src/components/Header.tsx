"use client";

import { usePathname } from "next/navigation";
import NavTabs from "./NavTabs";
import LogoutButton from "./LogoutButton";

export default function Header() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <header className="flex items-center justify-between border-b border-panel-border px-6 py-4">
      <div className="flex items-center gap-6">
        <span className="text-sm font-semibold tracking-wide text-ink-dim">
          byjohnmichael admin
        </span>
        <NavTabs />
      </div>
      <LogoutButton />
    </header>
  );
}

// byjohnmichael*
