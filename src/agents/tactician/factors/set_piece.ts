/** Factor 8 — set-piece efficiency edge (xG + totals modifiers, small but real). */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext } from '../types';
import { NULL_EFFECT } from '../types';

export function computeSetPiece(ctx: MatchContext, coef: Coefficients): FactorEffect {
  const h_for = ctx.home.set_piece_goals_for;
  const h_against = ctx.home.set_piece_goals_against;
  const a_for = ctx.away.set_piece_goals_for;
  const a_against = ctx.away.set_piece_goals_against;

  if (h_for === null || a_for === null || h_against === null || a_against === null) {
    return NULL_EFFECT('set_piece_stats_unavailable (populates from API-Football)');
  }

  const c = coef.set_piece;
  const home_sp_edge = (h_for - a_against) / 2;
  const away_sp_edge = (a_for - h_against) / 2;

  return {
    home_effect: 0,
    away_effect: 0,
    xg_modifier_home: c.xg_modifier_multiplier * home_sp_edge,
    xg_modifier_away: c.xg_modifier_multiplier * away_sp_edge,
    totals_modifier: c.totals_modifier_multiplier * (home_sp_edge + away_sp_edge),
    metadata: { home_sp_edge, away_sp_edge }
  };
}
