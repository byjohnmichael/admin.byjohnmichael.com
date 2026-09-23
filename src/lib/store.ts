import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const SITE_DATA_DIR = process.env.SITE_DATA_DIR ?? "/var/www/mc-site-data";

// SITE_DATA_DIR lives outside the app dir, so these ignore comments stop
// Next.js from tracing (and bundling) the whole filesystem around it.
async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(
      path.join(/* turbopackIgnore: true */ SITE_DATA_DIR, fileName),
      "utf8",
    );
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(fileName: string, value: T): Promise<void> {
  await fs.mkdir(SITE_DATA_DIR, { recursive: true });
  const filePath = path.join(/* turbopackIgnore: true */ SITE_DATA_DIR, fileName);
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2));
  await fs.rename(tempPath, filePath);
}

export type WhitelistRequest = {
  id: string;
  username: string;
  requestedAt: string;
};

const WHITELIST_REQUESTS_FILE = "whitelist-requests.json";

export async function getPendingWhitelistRequests(): Promise<
  WhitelistRequest[]
> {
  return readJson<WhitelistRequest[]>(WHITELIST_REQUESTS_FILE, []);
}

/** Returns "added" for a new request, or "duplicate" if already pending. */
export async function addWhitelistRequest(
  username: string,
): Promise<"added" | "duplicate"> {
  const requests = await getPendingWhitelistRequests();
  const alreadyPending = requests.some(
    (request) => request.username.toLowerCase() === username.toLowerCase(),
  );
  if (alreadyPending) return "duplicate";

  requests.push({
    id: randomUUID(),
    username,
    requestedAt: new Date().toISOString(),
  });
  await writeJson(WHITELIST_REQUESTS_FILE, requests);
  return "added";
}

export async function removeWhitelistRequest(id: string): Promise<void> {
  const requests = await getPendingWhitelistRequests();
  await writeJson(
    WHITELIST_REQUESTS_FILE,
    requests.filter((request) => request.id !== id),
  );
}

export const LOCATION_TYPES = [
  "landmark",
  "home",
  "town",
  "kingdom",
  "mountain",
  "river",
  "sea",
  "ruins",
] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export type LocationRequest = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  type: LocationType;
  submittedBy: string;
  requestedAt: string;
};

const LOCATION_REQUESTS_FILE = "location-requests.json";

export async function getLocationRequests(): Promise<LocationRequest[]> {
  return readJson<LocationRequest[]>(LOCATION_REQUESTS_FILE, []);
}

export async function removeLocationRequest(id: string): Promise<void> {
  const requests = await getLocationRequests();
  await writeJson(
    LOCATION_REQUESTS_FILE,
    requests.filter((r) => r.id !== id),
  );
}

export type MedalsMap = Record<string, { username: string; medals: number }>;

const MEDALS_FILE = "medals.json";

export async function getMedals(): Promise<MedalsMap> {
  return readJson<MedalsMap>(MEDALS_FILE, {});
}

export async function adjustMedals(
  username: string,
  delta: number,
): Promise<number> {
  const medals = await getMedals();
  const key = username.toLowerCase();
  const current = medals[key]?.medals ?? 0;
  const next = Math.max(0, current + delta);
  medals[key] = { username, medals: next };
  await writeJson(MEDALS_FILE, medals);
  return next;
}

// byjohnmichael*
