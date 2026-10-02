import { promises as fs } from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const SITE_DATA_DIR =
  process.env.WOW_SITE_DATA_DIR ?? "/var/www/wow.byjohnmichael.com/wow-site-data";
const DB_CONTAINER = process.env.WOW_DB_CONTAINER ?? "wow-wotlk-database-1";
const DB_USER = process.env.WOW_DB_USER ?? "mangos";
const DB_PASSWORD = process.env.WOW_DB_PASSWORD ?? "mangos";

export type AccountRequest = {
  id: string;
  username: string;
  salt: string;
  verifier: string;
  requestedAt: string;
};

const ACCOUNT_REQUESTS_FILE = "account-requests.json";

export async function getPendingAccountRequests(): Promise<AccountRequest[]> {
  try {
    const raw = await fs.readFile(
      path.join(/* turbopackIgnore: true */ SITE_DATA_DIR, ACCOUNT_REQUESTS_FILE),
      "utf8",
    );
    return JSON.parse(raw) as AccountRequest[];
  } catch {
    return [];
  }
}

export async function removeAccountRequest(id: string): Promise<void> {
  const requests = await getPendingAccountRequests();
  const filePath = path.join(
    /* turbopackIgnore: true */ SITE_DATA_DIR,
    ACCOUNT_REQUESTS_FILE,
  );
  const next = requests.filter((r) => r.id !== id);
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(next, null, 2));
  await fs.rename(tempPath, filePath);
}

const HEX_PATTERN = /^[0-9A-Fa-f]+$/;
const USERNAME_PATTERN = /^[A-Za-z0-9]{3,16}$/;

/** Directly inserts a pre-computed SRP6 verifier into realmd.account. */
export async function createAccount(
  username: string,
  salt: string,
  verifier: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "Invalid username." };
  }
  if (!HEX_PATTERN.test(salt) || !HEX_PATTERN.test(verifier)) {
    return { ok: false, error: "Invalid verifier data." };
  }

  const sql = `INSERT INTO wotlkrealmd.account (username, v, s) VALUES ('${username}', '${verifier}', '${salt}');`;

  try {
    await execFileAsync("docker", [
      "exec",
      DB_CONTAINER,
      "mariadb",
      `-u${DB_USER}`,
      `-p${DB_PASSWORD}`,
      "-e",
      sql,
    ]);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
