/** Composition engine — sum factor effects, apply the sacred ±12% cap. */
import type { Coefficients } from './config';
import type { CombinedAdjustment, FactorBreakdown } from './types';

export function combineAdjustments(factors: FactorBreakdown, coef: Coefficients): CombinedAdjustment {
  let home_total = 0;
  let away_total = 0;
  let xg_home_total = 0;
  let xg_away_total = 0;
  let totals_modifier_sum = 0;
  let btts_modifier_sum = 0;
  let ci_widening = 0;

  for (const factor of Object.values(factors)) {
    home_total += factor.home_effect;
    away_total += factor.away_effect;
    xg_home_total += factor.xg_modifier_home ?? 0;
    xg_away_total += factor.xg_modifier_away ?? 0;
    totals_modifier_sum += factor.totals_modifier ?? 0;
    btts_modifier_sum += factor.btts_modifier ?? 0;
    ci_widening = Math.max(ci_widening, factor.ci_widening ?? 0);
  }

  const MAX = coef.global.max_total_adjustment;
  const MIN = coef.global.min_total_adjustment;
  const home_capped = Math.max(MIN, Math.min(MAX, home_total));
  const away_capped = Math.max(MIN, Math.min(MAX, away_total));

  return {
    home_total: home_capped,
    away_total: away_capped,
    capped: home_capped !== home_total || away_capped !== away_total,
    net_advantage_home: home_capped - away_capped,
    xg_modifiers: { home: xg_home_total, away: xg_away_total, totals_offset: totals_modifier_sum },
    btts_modifier: btts_modifier_sum,
    ci_widening
  };
}
