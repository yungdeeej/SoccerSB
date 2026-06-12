/** Factor 11 — momentum vs Elo expectation, deliberately small (Elo owns most of this). */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext, RecentMatchInfo } from '../types';
import { NULL_EFFECT } from '../types';

function formDelta(recent: RecentMatchInfo[]): number | null {
  const usable = recent.filter((m) => m.points !== null && m.expected_points !== null).slice(0, 5);
  if (usable.length < 3) return null;
  const actual = usable.reduce((s, m) => s + (m.points ?? 0), 0);
  const expected = usable.reduce((s, m) => s + (m.expected_points ?? 0), 0);
  return actual - expected;
}

function formAdjustment(delta: number, coef: Coefficients): number {
  const c = coef.recent_form;
  if (delta > 4) return c.delta_plus_4;
  if (delta > 2) return c.delta_plus_2;
  if (delta < -4) return c.delta_minus_4;
  if (delta < -2) return c.delta_minus_2;
  return 0;
}

export function computeRecentForm(ctx: MatchContext, coef: Coefficients): FactorEffect {
  const homeDelta = formDelta(ctx.home.recent_matches);
  const awayDelta = formDelta(ctx.away.recent_matches);

  if (homeDelta === null && awayDelta === null) {
    return NULL_EFFECT('insufficient_recent_data (needs 3+ matches with expectations)');
  }

  return {
    home_effect: homeDelta !== null ? formAdjustment(homeDelta, coef) : 0,
    away_effect: awayDelta !== null ? formAdjustment(awayDelta, coef) : 0,
    metadata: { home_form_delta: homeDelta, away_form_delta: awayDelta }
  };
}
