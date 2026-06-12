/** Factor 9 — referee crew tendencies (assigned ~48h pre-match). */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext } from '../types';
import { NULL_EFFECT } from '../types';

export function computeReferee(ctx: MatchContext, coef: Coefficients): FactorEffect {
  const ref = ctx.referee;
  if (!ref) return NULL_EFFECT('referee_unknown');

  const c = coef.referee;
  let home_effect = 0;
  let away_effect = 0;
  let btts_modifier = 0;
  const notes: string[] = [];

  // High-card crew punishes low-discipline teams
  if (ref.cards_per_match !== null && ref.cards_per_match > c.high_card_crew_threshold) {
    if ((ctx.home.cards_per_match ?? 0) > c.low_discipline_team_threshold) {
      home_effect += c.high_card_low_discipline_penalty;
      notes.push('high-card ref vs low-discipline home side');
    }
    if ((ctx.away.cards_per_match ?? 0) > c.low_discipline_team_threshold) {
      away_effect += c.high_card_low_discipline_penalty;
      notes.push('high-card ref vs low-discipline away side');
    }
  }

  // Home-biased crews (low share of cards to the home team)
  if (ref.home_team_card_rate !== null && ref.home_team_card_rate < c.home_bias_threshold) {
    home_effect += c.home_bias_bonus;
    notes.push('home-biased card distribution');
  }

  // Penalty-happy refs lift BTTS
  if (ref.penalties_per_match !== null && ref.penalties_per_match > c.high_penalty_threshold) {
    btts_modifier += c.high_penalty_btts_boost / 10;  // 0.10 spec value is per-10 scale
    notes.push('high penalty rate');
  }

  if (home_effect === 0 && away_effect === 0 && btts_modifier === 0) {
    return NULL_EFFECT(`referee_neutral (${ref.full_name})`);
  }

  return {
    home_effect,
    away_effect,
    btts_modifier: btts_modifier || undefined,
    metadata: { referee: ref.full_name, notes, cards_per_match: ref.cards_per_match }
  };
}
