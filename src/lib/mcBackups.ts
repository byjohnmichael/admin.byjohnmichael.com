import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type BackupTier = "hourly" | "monthly";

export type BackupSnapshot = {
  id: string;
  time: string; // ISO
  sizeBytes: number;
  fileCount: number;
};

const CONTAINER: Record<BackupTier, string> = {
  hourly: process.env.MC_BACKUP_HOURLY_CONTAINER ?? "mc-backup-hourly",
  monthly: process.env.MC_BACKUP_MONTHLY_CONTAINER ?? "mc-backup-monthly",
};

type ResticSnapshot = {
  id: string;
  time: string;
  summary?: {
    total_bytes_processed?: number;
    total_files_processed?: number;
  };
};

async function listSnapshots(tier: BackupTier): Promise<BackupSnapshot[]> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["exec", CONTAINER[tier], "restic", "snapshots", "--json"],
      { timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
    );
    const raw = JSON.parse(stdout) as ResticSnapshot[];
    return raw
      .map((s) => ({
        id: s.id.slice(0, 8),
        time: s.time,
        sizeBytes: s.summary?.total_bytes_processed ?? 0,
        fileCount: s.summary?.total_files_processed ?? 0,
      }))
      .sort((a, b) => b.time.localeCompare(a.time));
  } catch {
    // container not up yet, repo not initialized, or restic error — an empty
    // list reads as "no backups yet" rather than surfacing plumbing errors
    return [];
  }
}

// a plain 20s cache: this is queried by anyone with the Minecraft tab open,
// and each call spawns `docker exec ... restic snapshots` in two containers
// — cheap individually, but no reason to repeat it for concurrent viewers.
const CACHE_MS = 20_000;
let cache: { at: number; data: BackupsResponse } | null = null;

export type BackupsResponse = {
  hourly: BackupSnapshot[];
  monthly: BackupSnapshot[];
};

export async function getBackups(): Promise<BackupsResponse> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [hourly, monthly] = await Promise.all([
    listSnapshots("hourly"),
    listSnapshots("monthly"),
  ]);
  const data = { hourly, monthly };
  cache = { at: Date.now(), data };
  return data;
}

// byjohnmichael*
