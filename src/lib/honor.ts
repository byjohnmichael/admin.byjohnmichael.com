/**
 * Honor blends four signals:
 *
 *   level        the baseline
 *   hoursPlayed  a small, uncapped bonus whose weight fades 0.5%/level
 *                (never below 50%) — acts as a floor for players who have
 *                lost levels, and only a light boost for high levels
 *   deaths       a penalty capped at level/8, so low-level players are
 *                barely affected and nobody gets wiped out by a big count
 *   medals       a modest multiplier, no hard cap (sqrt keeps it in check)
 *
 *   honor = (level + playtimeBonus - deathPenalty) * medalMultiplier
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
  const rawPlaytime = 2 * Math.log10(1 + Math.max(0, hoursPlayed));
  const playtimeScale = Math.max(0.5, 1 - 0.005 * Math.max(0, level));
  const playtimeBonus = rawPlaytime * playtimeScale;

  const deathCeiling = Math.max(0, level) / 8;
  const deathPenalty = Math.min(Math.max(0, deaths) / 5, deathCeiling);

  const medalMultiplier = 1 + 0.07 * Math.sqrt(Math.max(0, medals));

  const honor = (level + playtimeBonus - deathPenalty) * medalMultiplier;
  return Math.round(honor * 10) / 10;
}

// byjohnmichael*
