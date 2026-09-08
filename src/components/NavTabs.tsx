"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "General" },
  { href: "/mc", label: "Minecraft" },
  { href: "/wow", label: "WoW" },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-panel-border text-ink"
                : "text-ink-dim hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
