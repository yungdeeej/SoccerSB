/** CEO discipline gate tests — every gate: pass, fail, edge case. */
import { describe, it, expect } from 'vitest';
import {
  checkEdgeGate, checkConfirmationGate, checkMarketGate, checkModelConfidenceGate,
  checkCapitalGate, checkTacticianSanityGate, checkWaltersDisciplineGate,
  checkTournamentStageGate, checkAsianWesternGate, runAllGates, edgeThreshold
} from '../src/agents/ceo/gates';
import { computeStarRating } from '../src/agents/ceo/star_rating';
import type { CEOContext } from '../src/agents/ceo/types';
import type { TacticianOutput } from '../src/agents/tactician/types';

function tacticianFixture(overrides: Partial<TacticianOutput> = {}): TacticianOutput {
  return {
    match_id: 'm1', computed_at: new Date().toISOString(), coefficient_version: '1.0.0',
    run_phase: 'T-2h', home_xi_status: 'confirmed', away_xi_status: 'confirmed',
    home_xi_confidence_score: 85, away_xi_confidence_score: 85,
    home_cluster_score: 0, away_cluster_score: 0, flagged_lineup_concerns: [],
    raw_quant_probs: { home_win_prob: 0.5, draw_prob: 0.27, away_win_prob: 0.23 },
    adjusted_probs: { home_win_prob: 0.5, draw_prob: 0.27, away_win_prob: 0.23 },
    adjusted_predictions: {} as TacticianOutput['adjusted_predictions'],
    xg_modifiers: { home: 0, away: 0, totals_offset: 0 },
    factor_breakdown: {} as TacticianOutput['factor_breakdown'],
    flags: [], total_adjustment_capped: false, combined_advantage_home: 0,
    inputs_quality_score: 90,
    ...overrides
  };
}

/** Default: a clean 3%-edge STRIKE candidate that passes every gate. */
function ctx(overrides: Partial<CEOContext> = {}): CEOContext {
  return {
    match_id: 'm1', market: 'match_outcome_home', side: 'home',
    tournament_stage: 'group_md2', is_opener: false, hours_to_kickoff: 5,
    run_phase: 'T-2h',
    adjusted_prob: 0.515,             // × 2.0 decimal = 3.0% edge
    low_confidence: false, quant_ci_max_width: 0.06,
    best_book: 'draftkings', best_book_american: 100, best_book_decimal: 2.0,
    pinnacle_no_vig_prob: 0.50,
    movement_last_30min_cents: 0, movement_direction_adverse: false,
    line_freeze: false,
    asian_western: { detected: false, magnitude_cents: 0, asian_implied_pct: null, western_implied_pct: null, actionable_side: null, explanation: null },
    sbobet_no_vig_prob: null,
    tactician: tacticianFixture(),
    treasurer: {
      active_bankroll_cents: 500_000n, available_capital_cents: 500_000n,
      stop_loss_active: 'none', todays_bet_count: 0, daily_bet_cap: 5,
      current_kelly_fraction: 0.25,
      total_capital_cents: 500_000n, pending_wagers_cents: 0n,
      peak_bankroll_cents: 500_000n, peak_reached_at: null, drawdown_pct_from_peak: 0,
      stop_loss_reason: null, stop_loss_resumes_at: null,
      todays_bets_by_match: new Map(), daily_bet_cap_effective: 5,
      this_week_clv_cents: 0, rolling_30d_clv_cents: 0, clv_classification: 'marginal'
    },
    already_bet_this_match_today: false,
    ...overrides
  };
}

describe('Gate A — edge', () => {
  it('passes a 3.0% edge at base threshold', () => {
    expect(checkEdgeGate(ctx()).passed).toBe(true);
  });
  it('fails below 2.0% without watch when far off', () => {
    const r = checkEdgeGate(ctx({ adjusted_prob: 0.50 }));  // 0% edge
    expect(r.passed).toBe(false);
    expect(r.watch_eligible).toBe(false);
  });
  it('2.0-2.5% borderline → WATCH-eligible', () => {
    const r = checkEdgeGate(ctx({ adjusted_prob: 0.511 }));  // 2.2% edge
    expect(r.passed).toBe(false);
    expect(r.gate).toBe('edge_borderline');
    expect(r.watch_eligible).toBe(true);
  });
  it('low confidence doubles threshold to 4%', () => {
    const r = checkEdgeGate(ctx({ low_confidence: true }));  // 3% < 4%
    expect(r.passed).toBe(false);
    expect(checkEdgeGate(ctx({ low_confidence: true, adjusted_prob: 0.525 })).passed).toBe(true);  // 5%
  });
  it('threshold matrix: r32 3.5, opener 3.0, final 2.5, alt markets 3.0', () => {
    expect(edgeThreshold(ctx({ tournament_stage: 'r32' }))).toBe(3.5);
    expect(edgeThreshold(ctx({ is_opener: true }))).toBe(3.0);
    expect(edgeThreshold(ctx({ tournament_stage: 'final' }))).toBe(2.5);
    expect(edgeThreshold(ctx({ market: 'ht_ft_home_home' }))).toBe(3.0);
  });
});

describe('Gate B — confirmation', () => {
  it('passes XI-dependent market with confirmed XIs', () => {
    expect(checkConfirmationGate(ctx({ market: 'total_over_2.5' })).passed).toBe(true);
  });
  it('fails XI-dependent market unconfirmed at T-2h', () => {
    const r = checkConfirmationGate(ctx({
      market: 'total_over_2.5', hours_to_kickoff: 1.5,
      tactician: tacticianFixture({ away_xi_status: 'projected' })
    }));
    expect(r.passed).toBe(false);
    expect(r.gate).toBe('xi_unconfirmed');
  });
  it('unconfirmed at T-12h → WATCH-eligible instead', () => {
    const r = checkConfirmationGate(ctx({
      market: 'total_over_2.5', hours_to_kickoff: 12, run_phase: 'T-12h',
      tactician: tacticianFixture({ away_xi_status: 'projected' })
    }));
    expect(r.passed).toBe(false);
    expect(r.watch_eligible).toBe(true);
  });
  it('1X2 is not XI-dependent — passes unconfirmed', () => {
    const r = checkConfirmationGate(ctx({
      hours_to_kickoff: 1, tactician: tacticianFixture({ away_xi_status: 'projected' })
    }));
    expect(r.passed).toBe(true);
  });
  it('fails any market when XI confidence < 70', () => {
    const r = checkConfirmationGate(ctx({ tactician: tacticianFixture({ home_xi_confidence_score: 60 }) }));
    expect(r.passed).toBe(false);
    expect(r.gate).toBe('lineup_confidence_low');
  });
});

describe('Gate C — market', () => {
  it('passes calm market within Pinnacle tolerance', () => {
    expect(checkMarketGate(ctx()).passed).toBe(true);
  });
  it('fails on adverse movement > 4¢ in 30min', () => {
    const r = checkMarketGate(ctx({ movement_last_30min_cents: 8, movement_direction_adverse: true }));
    expect(r.passed).toBe(false);
    expect(r.gate).toBe('adverse_steam');
  });
  it('fails when Pinnacle disagrees by > 4%', () => {
    const r = checkMarketGate(ctx({ adjusted_prob: 0.56, pinnacle_no_vig_prob: 0.50 }));
    expect(r.passed).toBe(false);
    expect(r.gate).toBe('pinnacle_disagrees');
  });
  it('exactly 4% delta passes (threshold is strict >)', () => {
    expect(checkMarketGate(ctx({ adjusted_prob: 0.54, pinnacle_no_vig_prob: 0.50 })).passed).toBe(true);
  });
  it('fails on line freeze', () => {
    expect(checkMarketGate(ctx({ line_freeze: true })).gate).toBe('line_frozen');
  });
});

describe('Gate D — model confidence', () => {
  it('passes wide CI with big edge', () => {
    expect(checkModelConfidenceGate(ctx({ quant_ci_max_width: 0.12, adjusted_prob: 0.525 })).passed).toBe(true);  // 5%
  });
  it('fails wide CI with small edge', () => {
    const r = checkModelConfidenceGate(ctx({ quant_ci_max_width: 0.12 }));  // 3% edge
    expect(r.passed).toBe(false);
  });
  it('passes narrow CI with small edge', () => {
    expect(checkModelConfidenceGate(ctx({ quant_ci_max_width: 0.08 })).passed).toBe(true);
  });
});

describe('Gate E — capital', () => {
  it('passes with funds and open cap', () => {
    expect(checkCapitalGate(ctx()).passed).toBe(true);
  });
  it('fails on stop-loss halt', () => {
    const r = checkCapitalGate(ctx({ treasurer: { ...ctx().treasurer, stop_loss_active: 'halt' } }));
    expect(r.gate).toBe('stop_loss_halt');
  });
  it('fails below the $20 floor', () => {
    const r = checkCapitalGate(ctx({ treasurer: { ...ctx().treasurer, available_capital_cents: 1500n } }));
    expect(r.gate).toBe('insufficient_capital');
  });
  it('fails at daily cap', () => {
    const r = checkCapitalGate(ctx({ treasurer: { ...ctx().treasurer, todays_bet_count: 5 } }));
    expect(r.gate).toBe('daily_cap_reached');
  });
});

describe('Gate F — tactician sanity', () => {
  it('passes normal adjustments', () => {
    expect(checkTacticianSanityGate(ctx()).passed).toBe(true);
  });
  it('capped + critical flags → WATCH-eligible', () => {
    const r = checkTacticianSanityGate(ctx({
      tactician: tacticianFixture({
        total_adjustment_capped: true,
        flags: ['EXTREME SITUATIONAL STACK — total adjustment capped at ±12%, manual review recommended']
      })
    }));
    expect(r.passed).toBe(false);
    expect(r.watch_eligible).toBe(true);
  });
  it('severe weather + totals market → PASS', () => {
    const r = checkTacticianSanityGate(ctx({
      market: 'total_over_2.5',
      tactician: tacticianFixture({ flags: ['Weather: 35°C clear'] })
    }));
    expect(r.passed).toBe(false);
    expect(r.gate).toBe('severe_weather_totals');
  });
  it('severe weather + 1X2 passes (outcome unaffected per spec)', () => {
    const r = checkTacticianSanityGate(ctx({
      tactician: tacticianFixture({ flags: ['Weather: 35°C clear'] })
    }));
    expect(r.passed).toBe(true);
  });
});

describe('Gate G — Walters discipline', () => {
  it('passes first bet of the day on a match', () => {
    expect(checkWaltersDisciplineGate(ctx()).passed).toBe(true);
  });
  it('fails when a bet already exists on this match today', () => {
    const r = checkWaltersDisciplineGate(ctx({ already_bet_this_match_today: true }));
    expect(r.gate).toBe('already_bet_this_match');
  });
});

describe('Gate H — tournament stage', () => {
  it('group stage passes at 3%', () => {
    expect(checkTournamentStageGate(ctx()).passed).toBe(true);
  });
  it('r32 requires 3.5%', () => {
    expect(checkTournamentStageGate(ctx({ tournament_stage: 'r32' })).passed).toBe(false);
    expect(checkTournamentStageGate(ctx({ tournament_stage: 'r32', adjusted_prob: 0.52 })).passed).toBe(true);  // 4%
  });
  it('opener requires 3.0% (3.0 exactly fails the strict <)', () => {
    expect(checkTournamentStageGate(ctx({ is_opener: true, adjusted_prob: 0.516 })).passed).toBe(true);  // 3.2%
    expect(checkTournamentStageGate(ctx({ is_opener: true, adjusted_prob: 0.512 })).passed).toBe(false); // 2.4%
  });
  it('final requires 2.5%', () => {
    expect(checkTournamentStageGate(ctx({ tournament_stage: 'final', adjusted_prob: 0.511 })).passed).toBe(false); // 2.2%
  });
});

describe('Gate I — Asian/Western', () => {
  const detectedAW = { detected: true, magnitude_cents: 5, asian_implied_pct: 57, western_implied_pct: 52, actionable_side: 'asian_aligned' as const, explanation: 'gap' };
  it('non-totals markets always pass', () => {
    expect(checkAsianWesternGate(ctx({ asian_western: detectedAW })).passed).toBe(true);
  });
  it('totals with divergence but no sbobet prob passes (no data)', () => {
    expect(checkAsianWesternGate(ctx({ market: 'total_over_2.5', asian_western: detectedAW })).passed).toBe(true);
  });
  it('totals where Asian books disagree with us > 5% fails', () => {
    const r = checkAsianWesternGate(ctx({
      market: 'total_over_2.5', asian_western: detectedAW,
      adjusted_prob: 0.50, sbobet_no_vig_prob: 0.57
    }));
    expect(r.passed).toBe(false);
    expect(r.gate).toBe('asian_books_disagree');
  });
});

describe('runAllGates — order and first-failure semantics', () => {
  it('clean context passes all nine gates', () => {
    const outcome = runAllGates(ctx());
    expect(outcome.passed).toBe(true);
    expect(outcome.allResults).toHaveLength(9);
  });
  it('stops at the FIRST failing gate (edge before market)', () => {
    const outcome = runAllGates(ctx({ adjusted_prob: 0.40, line_freeze: true }));
    expect(outcome.passed).toBe(false);
    expect(outcome.failure?.gate).toBe('below_edge_threshold');  // never reaches line_frozen
    expect(outcome.allResults.length).toBeLessThan(9);
  });
  it('deterministic: same context → same outcome', () => {
    const c = ctx({ adjusted_prob: 0.511 });
    expect(runAllGates(c)).toEqual(runAllGates(c));
  });
});

describe('star rating boundaries', () => {
  it('maps the exact spec boundaries', () => {
    expect(computeStarRating(1.9).stars).toBe(0);
    expect(computeStarRating(2.0).stars).toBe(0.5);
    expect(computeStarRating(2.5).stars).toBe(1.0);
    expect(computeStarRating(3.5).stars).toBe(1.5);
    expect(computeStarRating(4.5).stars).toBe(2.0);
    expect(computeStarRating(6.0).stars).toBe(2.5);
    expect(computeStarRating(8.0).stars).toBe(3.0);
    expect(computeStarRating(12).stars).toBe(3.0);
  });
});
