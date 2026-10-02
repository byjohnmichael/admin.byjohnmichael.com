import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const DB_CONTAINER = process.env.WOW_DB_CONTAINER ?? "wow-wotlk-database-1";
const DB_USER = process.env.WOW_DB_USER ?? "mangos";
const DB_PASSWORD = process.env.WOW_DB_PASSWORD ?? "mangos";

const RACES: Record<number, string> = {
  1: "Human",
  2: "Orc",
  3: "Dwarf",
  4: "Night Elf",
  5: "Undead",
  6: "Tauren",
  7: "Gnome",
  8: "Troll",
  10: "Blood Elf",
  11: "Draenei",
};

const CLASSES: Record<number, string> = {
  1: "Warrior",
  2: "Paladin",
  3: "Hunter",
  4: "Rogue",
  5: "Priest",
  6: "Death Knight",
  7: "Shaman",
  8: "Mage",
  9: "Warlock",
  11: "Druid",
};

export type WowCharacter = {
  name: string;
  level: number;
  race: string;
  class: string;
  hoursPlayed: number;
  account: string;
  online: boolean;
};

const QUERY = `
  SELECT c.name, c.level, c.race, c.class, c.totaltime, a.username, c.online
  FROM wotlkcharacters.characters c
  JOIN wotlkrealmd.account a ON a.id = c.account
  WHERE c.deleteDate IS NULL AND a.username NOT LIKE 'RNDBOT%'
  ORDER BY c.level DESC, c.totaltime DESC
`;

export async function listCharacters(): Promise<WowCharacter[]> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync("docker", [
      "exec",
      DB_CONTAINER,
      "mariadb",
      `-u${DB_USER}`,
      `-p${DB_PASSWORD}`,
      "-N",
      "-B",
      "-e",
      QUERY,
    ]));
  } catch {
    return [];
  }

  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, level, race, cls, totaltime, account, online] =
        line.split("\t");
      return {
        name,
        level: Number(level),
        race: RACES[Number(race)] ?? `Race ${race}`,
        class: CLASSES[Number(cls)] ?? `Class ${cls}`,
        hoursPlayed: Number(totaltime) / 3600,
        account,
        online: online === "1",
      };
    });
}
