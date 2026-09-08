import { NextResponse } from "next/server";
import { listPlayers } from "@/lib/mcData";
import { getMedals } from "@/lib/store";
import { computeHonor } from "@/lib/honor";

export async function GET() {
  const [players, medals] = await Promise.all([listPlayers(), getMedals()]);

  const entries = players
    .map((player) => {
      const playerMedals = medals[player.name.toLowerCase()]?.medals ?? 0;
      return {
        ...player,
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
