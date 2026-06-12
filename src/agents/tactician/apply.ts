/**
 * Apply combined adjustments to the Quant's output — adjusted three-way
 * outcome plus recomputed totals/AH/BTTS from adjusted lambdas via the
 * TS Poisson port (parity-tested against Python).
 */
import type { QuantPrediction } from '../orchestrator/quant_client';
import {
  buildJointDistribution,
  deriveAsianHandicap,
  deriveBtts,
  deriveTotals
} from './poisson';
import type { AdjustedPredictions, CombinedAdjustment } from './types';

const EXTREME_HIGH = 0.95;
const EXTREME_LOW = 0.02;

export function applyToQuant(quant: QuantPrediction, adj: CombinedAdjustment): AdjustedPredictions {
  const raw = quant.predictions.match_outcome;

  // Three-way outcome — additive shift on win prob differential, draw held, renormalize
  let adj_home = raw.home_win_prob + adj.net_advantage_home;
  let adj_away = raw.away_win_prob - adj.net_advantage_home;
  let adj_draw = raw.draw_prob;

  adj_home = Math.max(0.01, Math.min(0.98, adj_home));
  adj_away = Math.max(0.01, Math.min(0.98, adj_away));

  const sum = adj_home + adj_draw + adj_away;
  adj_home /= sum;
  adj_draw /= sum;
  adj_away /= sum;

  // Sanity: the Tactician must never produce probabilities the Quant wouldn't.
  const extreme_clip_flag =
    adj_home > EXTREME_HIGH || adj_away > EXTREME_HIGH ||
    (adj_home < EXTREME_LOW && raw.home_win_prob >= EXTREME_LOW) ||
    (adj_away < EXTREME_LOW && raw.away_win_prob >= EXTREME_LOW);

  // Totals / AH / BTTS from adjusted lambdas via the ported joint pipeline
  const adjusted_xg_home = Math.max(0.3, Math.min(4.5, quant.expected_goals.home + adj.xg_modifiers.home));
  const adjusted_xg_away = Math.max(0.3, Math.min(4.5, quant.expected_goals.away + adj.xg_modifiers.away));

  const joint = buildJointDistribution(adjusted_xg_home, adjusted_xg_away);
  const adjusted_totals = deriveTotals(joint);

  // Direct totals offset (tactical effects beyond xG, e.g. wind)
  if (adj.xg_modifiers.totals_offset !== 0) {
    for (const line of Object.values(adjusted_totals)) {
      line.over = Math.max(0.01, Math.min(0.99, line.over + adj.xg_modifiers.totals_offset));
      line.under = 1 - line.over;
    }
  }

  const adjusted_ah = deriveAsianHandicap(joint);

  const baseBtts = deriveBtts(joint);
  const adj_btts_yes = Math.max(0.01, Math.min(0.99, baseBtts.yes_prob + adj.btts_modifier));

  return {
    adjusted_match_outcome: { home_win_prob: adj_home, draw_prob: adj_draw, away_win_prob: adj_away },
    adjusted_totals,
    adjusted_asian_handicap: adjusted_ah,
    adjusted_btts: { yes_prob: adj_btts_yes, no_prob: 1 - adj_btts_yes },
    adjusted_double_chance: {
      home_or_draw: adj_home + adj_draw,
      away_or_draw: adj_away + adj_draw,
      home_or_away: adj_home + adj_away
    },
    adjusted_draw_no_bet: {
      home_dnb_prob: adj_home / (adj_home + adj_away),
      away_dnb_prob: adj_away / (adj_home + adj_away)
    },
    adjusted_xg: { home: adjusted_xg_home, away: adjusted_xg_away },
    extreme_clip_flag
  };
}
