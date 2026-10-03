"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";

const TABS = [
  { href: "/", label: "overview" },
  { href: "/performance", label: "performance" },
  { href: "/monitor", label: "monitor" },
  { href: "/mc", label: "minecraft" },
  { href: "/wow", label: "wow" },
];

export default function NavTabs() {
  const pathname = usePathname();

  return (
    <nav className="-mx-2 flex gap-0.5 overflow-x-auto whitespace-nowrap sm:gap-1">
      {TABS.map((tab) => {
        const active =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`term-tab relative shrink-0 px-2 py-2 text-[13px] transition-colors sm:px-3 sm:text-sm ${
              active ? "text-ink" : "text-ink-dim hover:text-ink"
            }`}
            data-active={active || undefined}
          >
            {tab.label}
            {active && (
              // shared layoutId: the underline slides between tabs
              <motion.span
                layoutId="nav-underline"
                className="absolute inset-x-0 bottom-0 h-0.5 bg-accent"
                style={{ boxShadow: "0 0 10px var(--accent)" }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// byjohnmichael*
