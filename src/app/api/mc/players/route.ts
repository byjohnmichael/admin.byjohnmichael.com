import { NextResponse } from "next/server";
import { listPlayers } from "@/lib/mcData";
import { getMedals } from "@/lib/store";
import { computeHonor } from "@/lib/honor";
import { runRcon } from "@/lib/rcon";

/** Names currently online, from RCON `list` ("There are 2 of a max of 20
 * players online: alice, bob"). Empty when the server is down or unreachable. */
async function onlineNames(): Promise<Set<string>> {
  try {
    const response = await runRcon(["list"]);
    const after = response.split(":").slice(1).join(":");
    return new Set(
      after
        .split(",")
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

export async function GET() {
  const [players, medals, online] = await Promise.all([
    listPlayers(),
    getMedals(),
    onlineNames(),
  ]);

  const entries = players
    .map((player) => {
      const playerMedals = medals[player.name.toLowerCase()]?.medals ?? 0;
      return {
        ...player,
        online: online.has(player.name.toLowerCase()),
        medals: playerMedals,
        honor: computeHonor({
          level: player.level,
          medals: playerMedals,
          deaths: player.deaths,
          hoursPlayed: player.hoursPlayed,
        }),
      };
    })
    .sort((a, b) => b.honor - a.honor || b.level - a.level);

  return NextResponse.json({ entries });
}

// byjohnmichael*
