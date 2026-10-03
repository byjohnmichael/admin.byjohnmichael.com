import { execFile } from "child_process";
import { promises as fs } from "fs";
import { promisify } from "util";

// Read-only pacman status for the Overview: pending updates, installed
// packages, last full upgrade. Nothing here changes the system — updates are
// counted with `checkupdates` (pacman-contrib), which syncs into a temporary
// database instead of /var/lib/pacman. Without it we fall back to
// `pacman -Qu`, which reads the existing (possibly stale) sync database.

const execFileAsync = promisify(execFile);

const PACMAN_LOG = process.env.PACMAN_LOG ?? "/var/log/pacman.log";
const PACMAN_LOCK = process.env.PACMAN_LOCK ?? "/var/lib/pacman/db.lck";
/** checkupdates hits the mirrors, so its answer is cached this long */
const UPDATES_TTL_MS = 15 * 60_000;
/** a manual "check again" can't hit the mirrors more often than this */
const MIN_REFRESH_MS = 60_000;

export type PackageUpdate = { name: string; from: string; to: string };

/** How pressing the pending updates are, from "nothing to do" to "do it soon". */
export type UpdateSeverity = "up to date" | "not needed" | "suggested" | "needed";

// Thresholds for the severity levels (pending update count / days since the
// last full `pacman -Syu`). Kept here so they're easy to tune.
const SUGGESTED_AT = 20;
const NEEDED_AT = 80;
const SUGGESTED_AFTER_DAYS = 7;
const NEEDED_AFTER_DAYS = 30;

// Packages where a pending update matters more than its count suggests:
// the kernel, the C library, init, crypto/remote access, privilege, pacman.
const CORE_PACKAGES = /^(linux(-lts|-zen|-hardened)?|glibc|systemd|openssl|openssh|sudo|pacman|gnutls)$/;

export function updateSeverity(
  updates: PackageUpdate[],
  lastUpgrade: string | null,
): { level: UpdateSeverity; reasons: string[] } {
  const n = updates.length;
  if (n === 0) return { level: "up to date", reasons: [] };

  const days = lastUpgrade ? (Date.now() - new Date(lastUpgrade).getTime()) / 86_400_000 : null;
  const core = updates.filter((u) => CORE_PACKAGES.test(u.name)).map((u) => u.name);
  const reasons: string[] = [];
  let level: UpdateSeverity = "not needed";
  const raise = (to: UpdateSeverity, why: string) => {
    const rank = { "up to date": 0, "not needed": 1, suggested: 2, needed: 3 };
    if (rank[to] > rank[level]) level = to;
    reasons.push(why);
  };

  if (n >= NEEDED_AT) raise("needed", `${n} packages behind`);
  else if (n >= SUGGESTED_AT) raise("suggested", `${n} packages behind`);
  if (core.length) raise("suggested", `core: ${core.join(", ")}`);
  if (days != null && days >= NEEDED_AFTER_DAYS) raise("needed", `last upgrade ${Math.floor(days)} days ago`);
  else if (days != null && days >= SUGGESTED_AFTER_DAYS) raise("suggested", `last upgrade ${Math.floor(days)} days ago`);
  return { level, reasons };
}

export type PackagesStatus =
  | { available: false; error: string }
  | {
      available: true;
      installed: { name: string; version: string; explicit: boolean }[];
      updates: PackageUpdate[];
      /** "checkupdates" = fresh from the mirrors; "local" = from the existing sync db */
      updatesSource: "checkupdates" | "local";
      updatesCheckedAt: number;
      updatesError: string | null;
      lastUpgrade: string | null;
      severity: { level: UpdateSeverity; reasons: string[] };
      /** pacman's database lock is held (an install/upgrade is running) */
      busy: boolean;
    };

let updatesCache: {
  at: number;
  updates: PackageUpdate[];
  source: "checkupdates" | "local";
  error: string | null;
} | null = null;

function parseUpdates(stdout: string): PackageUpdate[] {
  // "linux 6.11.4.arch1-1 -> 6.11.5.arch1-1"
  return stdout
    .split("\n")
    .map((l) => /^(\S+)\s+(\S+)\s+->\s+(\S+)/.exec(l.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ name: m[1], from: m[2], to: m[3] }));
}

async function checkUpdates(): Promise<NonNullable<typeof updatesCache>> {
  try {
    const { stdout } = await execFileAsync("checkupdates", [], { timeout: 120_000 });
    return { at: Date.now(), updates: parseUpdates(stdout), source: "checkupdates", error: null };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string };
    // checkupdates exits 2 when there's nothing to update
    if (e.code === 2) return { at: Date.now(), updates: [], source: "checkupdates", error: null };
    if (e.code !== "ENOENT") {
      return {
        at: Date.now(),
        updates: parseUpdates(e.stdout ?? ""),
        source: "checkupdates",
        error: "checkupdates failed (mirrors unreachable?)",
      };
    }
  }
  // no pacman-contrib: list what the current sync database already knows
  try {
    const { stdout } = await execFileAsync("pacman", ["-Qu"], { timeout: 20_000 });
    return { at: Date.now(), updates: parseUpdates(stdout), source: "local", error: null };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    // pacman -Qu exits 1 when nothing is out of date
    return {
      at: Date.now(),
      updates: parseUpdates(e.stdout ?? ""),
      source: "local",
      error: e.code === 1 ? null : "pacman -Qu failed",
    };
  }
}

/** Timestamp of the last "starting full system upgrade" in pacman.log. */
async function lastFullUpgrade(): Promise<string | null> {
  try {
    const log = await fs.readFile(PACMAN_LOG, "utf8");
    const i = log.lastIndexOf("starting full system upgrade");
    if (i === -1) return null;
    const lineStart = log.lastIndexOf("\n", i) + 1;
    const m = /^\[([^\]]+)\]/.exec(log.slice(lineStart, i));
    return m ? new Date(m[1]).toISOString() : null;
  } catch {
    return null;
  }
}

export async function getPackagesStatus(refresh = false): Promise<PackagesStatus> {
  let installedRaw: string;
  let explicitRaw: string;
  try {
    [installedRaw, explicitRaw] = await Promise.all([
      execFileAsync("pacman", ["-Q"], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout),
      execFileAsync("pacman", ["-Qqe"], { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout),
    ]);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return {
      available: false,
      error: e.code === "ENOENT" ? "pacman not found — this panel needs an Arch-based system." : "pacman -Q failed.",
    };
  }

  const explicit = new Set(explicitRaw.split("\n").filter(Boolean));
  const installed = installedRaw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, version = ""] = line.split(" ");
      return { name, version, explicit: explicit.has(name) };
    });

  const stale = !updatesCache || Date.now() - updatesCache.at > UPDATES_TTL_MS;
  const canRefresh = !updatesCache || Date.now() - updatesCache.at > MIN_REFRESH_MS;
  if (stale || (refresh && canRefresh)) updatesCache = await checkUpdates();
  const u = updatesCache!;

  const [lastUpgrade, busy] = await Promise.all([
    lastFullUpgrade(),
    fs.stat(PACMAN_LOCK).then(() => true, () => false),
  ]);

  return {
    available: true,
    installed,
    updates: u.updates,
    updatesSource: u.source,
    updatesCheckedAt: u.at,
    updatesError: u.error,
    lastUpgrade,
    severity: updateSeverity(u.updates, lastUpgrade),
    busy,
  };
}

// byjohnmichael*
