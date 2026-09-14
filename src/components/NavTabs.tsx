"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "General" },
  { href: "/performance", label: "Performance" },
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
            className={`rounded-sm px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "bg-accent/15 text-ink ring-1 ring-inset ring-accent/40"
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

// byjohnmichael*
