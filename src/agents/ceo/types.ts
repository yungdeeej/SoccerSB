/** CEO types — gate context and verdict shapes (05_AGENT_CEO.md / 07 contracts). */
import type { MarketAnalysis } from '../wolfman/index';
import type { TacticianOutput } from '../tactician/types';
import type { TreasurerSnapshot } from '../treasurer/snapshot';

export type Decision = 'STRIKE' | 'WATCH' | 'PASS';

export interface GateResult {
  passed: boolean;
  gate: string;
  explanation?: string;
  watch_eligible?: boolean;
}

export interface CEOContext {
  match_id: string;
  market: string;             // e.g. 'match_outcome_home', 'total_over_2.5'
  side: string;
  tournament_stage: string;
  is_opener: boolean;
  hours_to_kickoff: number;
  run_phase: 'T-12h' | 'T-2h' | 'T-30min' | 'manual';

  // Probabilities
  adjusted_prob: number;      // Tactician-adjusted probability for this market+side
  low_confidence: boolean;    // Quant bootstrap CI flag
  quant_ci_max_width: number;

  // Market
  best_book: string;
  best_book_american: number;
  best_book_decimal: number;
  pinnacle_no_vig_prob: number | null;
  movement_last_30min_cents: number;
  movement_direction_adverse: boolean;
  line_freeze: boolean;
  asian_western: MarketAnalysis['asian_western'];
  sbobet_no_vig_prob: number | null;

  // Tactician
  tactician: TacticianOutput;

  // Treasurer
  treasurer: TreasurerSnapshot;
  already_bet_this_match_today: boolean;
}

export function adjustedEdge(ctx: CEOContext): number {
  return ctx.adjusted_prob * ctx.best_book_decimal - 1;
}

export function isKnockout(stage: string): boolean {
  return ['r32', 'r16', 'qf', 'sf', 'third', 'final'].includes(stage);
}

export const XI_DEPENDENT_MARKETS = (market: string): boolean =>
  market.startsWith('total_') || market.startsWith('asian_handicap_') || market.startsWith('btts_');

export const ALT_MARKETS = (market: string): boolean =>
  market.startsWith('ht_ft_') || market.startsWith('halftime_total_');
