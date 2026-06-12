/**
 * Factor 3 — partial-acclimation altitude effects layered on the Quant's
 * venue baseline. Full acclimation (capital >= 1500m) is already priced by
 * the Quant; this module only credits PARTIAL acclimation. Most matches: 0.
 */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext, TeamContext } from '../types';
import { NULL_EFFECT } from '../types';

function partialBonus(team: TeamContext, coef: Coefficients): number {
  // Fully acclimated (high-altitude home base) — Quant already handles
  if (team.capital_altitude_m >= 1500) return 0;
  // Partial: arrived at the high-altitude venue 5-10 days ahead
  if (team.days_at_venue >= 5 && team.days_at_venue <= 10) {
    return coef.altitude.partial_acclimation_bonus_1500m * coef.altitude.akron_partial_acclimation_5_to_10_days;
  }
  return 0;
}

export function computeAltitude(ctx: MatchContext, coef: Coefficients): FactorEffect {
  if (ctx.venue.altitude_meters < 1500) {
    return NULL_EFFECT('venue_below_1500m');
  }
  const home = partialBonus(ctx.home, coef);
  const away = partialBonus(ctx.away, coef);
  if (home === 0 && away === 0) {
    return NULL_EFFECT('no_partial_acclimation_cases (full acclimation handled by Quant)');
  }
  return {
    home_effect: home,
    away_effect: away,
    metadata: {
      venue_altitude_m: ctx.venue.altitude_meters,
      home_days_at_venue: ctx.home.days_at_venue,
      away_days_at_venue: ctx.away.days_at_venue
    }
  };
}
