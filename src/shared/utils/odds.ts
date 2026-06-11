/**
 * Odds conversion and vig-stripping utilities (07_SHARED_CONTRACTS.md).
 * Soccer is a three-way market sport — stripVigThreeWay is the primary 1X2 tool.
 */

/** Convert American odds to decimal odds. */
export function americanToDecimal(american: number): number {
  if (american === 0 || !Number.isFinite(american)) {
    throw new Error(`Invalid American odds: ${american}`);
  }
  if (american > 0) return american / 100 + 1;
  return 100 / Math.abs(american) + 1;
}

/** Convert decimal odds to American odds. */
export function decimalToAmerican(decimal: number): number {
  if (!Number.isFinite(decimal) || decimal <= 1) {
    throw new Error(`Invalid decimal odds: ${decimal}`);
  }
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

/**
 * Strip vig from a two-way market (totals, BTTS, DNB, Asian handicap).
 * Returns no-vig probabilities for each side.
 */
export function stripVigTwoWay(
  side_a_american: number,
  side_b_american: number
): { side_a_no_vig: number; side_b_no_vig: number } {
  const a_implied = 1 / americanToDecimal(side_a_american);
  const b_implied = 1 / americanToDecimal(side_b_american);
  const total = a_implied + b_implied;

  return {
    side_a_no_vig: a_implied / total,
    side_b_no_vig: b_implied / total
  };
}

/**
 * Strip vig from a three-way market (soccer match outcome 1X2).
 * The draw is a first-class outcome.
 */
export function stripVigThreeWay(
  home_american: number,
  draw_american: number,
  away_american: number
): { home_no_vig: number; draw_no_vig: number; away_no_vig: number } {
  const h_imp = 1 / americanToDecimal(home_american);
  const d_imp = 1 / americanToDecimal(draw_american);
  const a_imp = 1 / americanToDecimal(away_american);
  const total = h_imp + d_imp + a_imp;

  return {
    home_no_vig: h_imp / total,
    draw_no_vig: d_imp / total,
    away_no_vig: a_imp / total
  };
}

/**
 * Closing Line Value in cents. Positive = beat the close.
 * CLV is the truth metric (Walters principle 7).
 */
export function calculateCLV(bet_no_vig_prob: number, closing_no_vig_prob: number): number {
  return (closing_no_vig_prob - bet_no_vig_prob) * 100;
}
