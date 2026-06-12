/** Factor 2 — travel distance + timezone burden, mitigated by acclimation days. */
import { haversineDistance } from '../../../shared/utils/geo';
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext, TeamContext } from '../types';
import { NULL_EFFECT } from '../types';

function travelPenalty(
  team: TeamContext,
  venue: MatchContext['venue'],
  coef: Coefficients
): { penalty: number; distance_km: number; tz_diff: number } {
  const c = coef.travel;
  if (team.base_lat === null || team.base_lng === null || venue.latitude === null || venue.longitude === null) {
    return { penalty: 0, distance_km: 0, tz_diff: 0 };
  }
  const distance_km = haversineDistance(team.base_lat, team.base_lng, venue.latitude, venue.longitude);

  let penalty = 0;
  if (distance_km > 8000) penalty += c.distance_8000_plus_km;
  else if (distance_km > 5000) penalty += c.distance_5000_8000_km;
  else if (distance_km > 2500) penalty += c.distance_2500_5000_km;

  const tz_diff =
    team.base_tz_offset_hours !== null && venue.tz_offset_hours !== null
      ? Math.abs(venue.tz_offset_hours - team.base_tz_offset_hours)
      : 0;
  if (tz_diff >= 6) penalty += c.timezone_6_zones;
  else if (tz_diff >= 4) penalty += c.timezone_4_zones;
  else if (tz_diff >= 2) penalty += c.timezone_2_zones;

  // Acclimation halves/quarters the burden
  if (team.days_at_venue >= 4) penalty *= c.acclimation_4_days_modifier;
  else if (team.days_at_venue >= 2) penalty *= c.acclimation_2_days_modifier;

  return { penalty, distance_km: Math.round(distance_km), tz_diff };
}

export function computeTravel(ctx: MatchContext, coef: Coefficients): FactorEffect {
  if (ctx.venue.latitude === null) {
    return NULL_EFFECT('venue_unknown');
  }
  const home = travelPenalty(ctx.home, ctx.venue, coef);
  const away = travelPenalty(ctx.away, ctx.venue, coef);

  return {
    home_effect: home.penalty,
    away_effect: away.penalty,
    metadata: {
      home_distance_km: home.distance_km,
      away_distance_km: away.distance_km,
      home_tz_diff: home.tz_diff,
      away_tz_diff: away.tz_diff,
      home_days_at_venue: ctx.home.days_at_venue,
      away_days_at_venue: ctx.away.days_at_venue
    }
  };
}
