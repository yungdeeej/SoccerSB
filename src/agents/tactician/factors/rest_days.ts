/** Factor 1 — rest days + extra-time/shootout hangover. Pure function. */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext } from '../types';
import { NULL_EFFECT } from '../types';

export function computeRestDays(ctx: MatchContext, coef: Coefficients): FactorEffect {
  const home = ctx.home.rest_days;
  const away = ctx.away.rest_days;
  if (home === null || away === null) {
    return NULL_EFFECT('rest_days_unknown (no prior match in window)');
  }

  const c = coef.rest_days;
  const diff = Math.min(3, Math.max(-3, home - away));
  const perDay = [0, c.plus_1_day, c.plus_2_days, c.plus_3_days];
  const advantage = perDay[Math.abs(diff)] ?? 0;

  let home_effect = diff > 0 ? advantage : diff < 0 ? -advantage : 0;
  let away_effect = -home_effect;

  // Marathon-match hangover from previous round
  if (ctx.home.prev_match_extra_time) home_effect += c.extra_time_fatigue_penalty;
  if (ctx.home.prev_match_penalties) home_effect += c.penalty_shootout_mental_penalty;
  if (ctx.away.prev_match_extra_time) away_effect += c.extra_time_fatigue_penalty;
  if (ctx.away.prev_match_penalties) away_effect += c.penalty_shootout_mental_penalty;

  return {
    home_effect,
    away_effect,
    metadata: {
      home_rest_days: home,
      away_rest_days: away,
      home_prev_extra_time: ctx.home.prev_match_extra_time,
      away_prev_extra_time: ctx.away.prev_match_extra_time,
      home_prev_penalties: ctx.home.prev_match_penalties,
      away_prev_penalties: ctx.away.prev_match_penalties
    }
  };
}
