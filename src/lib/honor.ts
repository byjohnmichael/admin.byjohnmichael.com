/**
 * Honor blends four signals:
 *
 *   level        the baseline, but grindable — sqrt-scaled so a huge level
 *                gap (e.g. 300 vs 30) only becomes a ~3x baseline gap,
 *                leaving room for medals to overturn it
 *   hoursPlayed  a log-scaled safety net: matters most at low level, fades
 *                toward a floor as level climbs, so it mainly protects
 *                someone whose level dropped (lost XP on death) despite
 *                having clearly put in the time
 *   medals       rare, hand-awarded, and meant to be the dominant lever —
 *                a linear multiplier strong enough that a handful of
 *                medals can put a low-level player ahead of a pure grinder
 *   deaths       a percentage penalty (not a flat subtraction) whose rate
 *                grows with level — near-zero at low level (everyone dies
 *                learning the game), meaningful for a high-level veteran
 *
 *   honor = (levelBaseline + hoursBonus) * medalMultiplier * deathFactor
 */
export function computeHonor({
  level,
  medals,
  deaths,
  hoursPlayed,
}: {
  level: number;
  medals: number;
  deaths: number;
  hoursPlayed: number;
}): number {
  const lvl = Math.max(0, level);
  const med = Math.max(0, medals);
  const dth = Math.max(0, deaths);
  const hrs = Math.max(0, hoursPlayed);

  const levelBaseline = 5 * Math.sqrt(lvl);

  const hoursFade = Math.max(0.3, 1 - 0.005 * lvl);
  const hoursBonus = 4 * Math.log10(1 + hrs) * hoursFade;

  const medalMultiplier = 1 + 0.6 * med;

  const deathFactor = Math.max(0.3, 1 - dth * 0.006 * (lvl / 100));

  const honor = (levelBaseline + hoursBonus) * medalMultiplier * deathFactor;
  return Math.round(honor * 10) / 10;
}

// byjohnmichael*
