import { execFile, spawn } from "child_process";
import { promisify } from "util";

// Log in with a real account on this machine.
//
// 1. The username must be in ADMIN_LOGIN_GROUP (default "wheel") — or listed
//    in ADMIN_LOGIN_USERS, which replaces the group check when set.
// 2. The password is checked by unix_chkpwd, the helper pam_unix itself uses.
//    It only checks *other* users' passwords when run as root, so unless this
//    app runs as root it is called through `sudo -n` — that needs one sudoers
//    rule (see README → Logging in).
//
// unix_chkpwd reads the password from stdin (NUL-terminated) and exits 0 for
// a match. Locked ("!") and empty passwords never match ("nonull").

const execFileAsync = promisify(execFile);

const LOGIN_GROUP = process.env.ADMIN_LOGIN_GROUP ?? "wheel";
const LOGIN_USERS = (process.env.ADMIN_LOGIN_USERS ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const UNIX_CHKPWD = process.env.UNIX_CHKPWD ?? "/usr/bin/unix_chkpwd";
const CHECK_TIMEOUT_MS = 8000;

// POSIX-ish login names; also keeps anything odd away from the helper's argv
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

export type LoginResult =
  | { ok: true; user: string }
  | { ok: false; reason: "invalid" | "unavailable"; detail?: string };

async function isAllowedUser(user: string): Promise<boolean> {
  if (LOGIN_USERS.length > 0) return LOGIN_USERS.includes(user);
  try {
    const { stdout } = await execFileAsync("id", ["-nG", user], { timeout: 4000 });
    return stdout.trim().split(/\s+/).includes(LOGIN_GROUP);
  } catch {
    return false; // no such user
  }
}

function checkPassword(user: string, password: string): Promise<"match" | "nomatch" | "error"> {
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  const [cmd, args] = asRoot
    ? [UNIX_CHKPWD, [user, "nonull"]]
    : ["sudo", ["-n", UNIX_CHKPWD, user, "nonull"]];

  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), CHECK_TIMEOUT_MS);
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", () => {
      clearTimeout(timer);
      resolve("error");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve("match");
      // sudo refusing (no rule / needs a password) is a setup problem, not a
      // wrong password — surface it so the admin can fix the server
      if (/sudo:/.test(stderr)) {
        console.error(`[login] password check unavailable: ${stderr.trim()}`);
        return resolve("error");
      }
      resolve("nomatch");
    });
    child.stdin.end(Buffer.concat([Buffer.from(password), Buffer.from([0])]));
  });
}

export async function verifySystemLogin(user: string, password: string): Promise<LoginResult> {
  if (!USERNAME_RE.test(user) || password.length === 0 || password.length > 512) {
    return { ok: false, reason: "invalid" };
  }
  // Check group membership first so the password helper is only ever asked
  // about accounts that are allowed in anyway.
  if (!(await isAllowedUser(user))) return { ok: false, reason: "invalid" };

  const result = await checkPassword(user, password);
  if (result === "match") return { ok: true, user };
  if (result === "error") {
    return { ok: false, reason: "unavailable", detail: "Password check is not set up on the server." };
  }
  return { ok: false, reason: "invalid" };
}

// byjohnmichael*
