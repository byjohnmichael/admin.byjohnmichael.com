import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MC_CONTAINER = process.env.MC_CONTAINER ?? "minecraft";

/** Runs an rcon-cli command inside the Minecraft container. Args are passed
 * as an array (never a shell string) so no user input can inject commands. */
export async function runRcon(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("docker", [
    "exec",
    MC_CONTAINER,
    "rcon-cli",
    ...args,
  ]);
  return stdout.trim();
}

/** rcon-cli exits 0 even when the command's result is a failure (e.g. "That
 * player does not exist") — the outcome is only visible in the response
 * text, so `whitelist add` callers need to check it themselves. Being
 * already whitelisted counts as success: the desired end state is met. */
export function whitelistAddSucceeded(rconResponse: string): boolean {
  const lower = rconResponse.toLowerCase();
  return lower.startsWith("added") || lower.includes("already whitelisted");
}
