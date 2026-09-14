import { promises as fs } from "fs";
import path from "path";
import * as nbt from "prismarine-nbt";

const MC_DATA_DIR = process.env.MC_DATA_DIR ?? "/opt/minecraft/server/data";

type UsercacheEntry = { uuid: string; name: string };

type BannedPlayerEntry = { uuid: string; name: string };

export type McPlayer = {
  uuid: string;
  name: string;
  level: number;
  hoursPlayed: number;
  deaths: number;
  banned: boolean;
};

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function getUsercache(): Promise<Map<string, string>> {
  const entries = await readJsonFile<UsercacheEntry[]>(
    path.join(MC_DATA_DIR, "usercache.json"),
    [],
  );
  return new Map(entries.map((entry) => [entry.uuid, entry.name]));
}

async function getBannedUuids(): Promise<Set<string>> {
  const entries = await readJsonFile<BannedPlayerEntry[]>(
    path.join(MC_DATA_DIR, "banned-players.json"),
    [],
  );
  return new Set(entries.map((entry) => entry.uuid));
}

async function getCustomStats(
  uuid: string,
): Promise<{ hoursPlayed: number; deaths: number }> {
  const statsPath = path.join(
    MC_DATA_DIR,
    "world/players/stats",
    `${uuid}.json`,
  );
  const stats = await readJsonFile<{
    stats?: { "minecraft:custom"?: Record<string, number> };
  }>(statsPath, {});
  const custom = stats.stats?.["minecraft:custom"] ?? {};
  return {
    hoursPlayed: (custom["minecraft:play_time"] ?? 0) / 20 / 3600,
    deaths: custom["minecraft:deaths"] ?? 0,
  };
}

async function getXpLevel(uuid: string): Promise<number> {
  const datPath = path.join(MC_DATA_DIR, "world/players/data", `${uuid}.dat`);
  try {
    const buffer = await fs.readFile(datPath);
    const { parsed } = await nbt.parse(buffer);
    const simplified = nbt.simplify(parsed) as { XpLevel?: number };
    return simplified.XpLevel ?? 0;
  } catch {
    return 0;
  }
}

/** Everyone who has ever played, with level, playtime, deaths, and ban status. */
export async function listPlayers(): Promise<McPlayer[]> {
  const statsDir = path.join(MC_DATA_DIR, "world/players/stats");
  let files: string[];
  try {
    files = await fs.readdir(statsDir);
  } catch {
    return [];
  }

  const uuids = files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length));

  const [usercache, bannedUuids] = await Promise.all([
    getUsercache(),
    getBannedUuids(),
  ]);

  return Promise.all(
    uuids.map(async (uuid) => {
      const [{ hoursPlayed, deaths }, level] = await Promise.all([
        getCustomStats(uuid),
        getXpLevel(uuid),
      ]);
      return {
        uuid,
        name: usercache.get(uuid) ?? uuid,
        level,
        hoursPlayed,
        deaths,
        banned: bannedUuids.has(uuid),
      };
    }),
  );
}

// byjohnmichael*
