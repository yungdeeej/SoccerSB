/** Composition engine + applyToQuant + Poisson parity vs Python. */
import { describe, it, expect } from 'vitest';
import { loadCoefficients } from '../src/agents/tactician/config';
import { combineAdjustments } from '../src/agents/tactician/compose';
import { applyToQuant } from '../src/agents/tactician/apply';
import { buildJointDistribution, deriveOutcome, deriveTotals, deriveBtts, deriveAsianHandicap } from '../src/agents/tactician/poisson';
import { classifyTeamStatus } from '../src/agents/tactician/factors/motivation';
import { NULL_EFFECT, type FactorBreakdown } from '../src/agents/tactician/types';
import type { QuantPrediction } from '../src/agents/orchestrator/quant_client';

const coef = loadCoefficients();

function breakdown(overrides: Partial<Record<keyof FactorBreakdown, { home_effect: number; away_effect: number;[k: string]: unknown }>> = {}): FactorBreakdown {
  const base = Object.fromEntries(
    ['rest_days', 'travel', 'altitude', 'weather', 'motivation', 'squad_rotation',
      'tactical_matchup', 'set_piece', 'referee', 'cluster_injury', 'recent_form']
      .map((k) => [k, NULL_EFFECT('test')])
  ) as unknown as FactorBreakdown;
  return { ...base, ...(overrides as Partial<FactorBreakdown>) };
}

describe('combineAdjustments', () => {
  it('sums factor effects additively (compound, don\'t average)', () => {
    const c = combineAdjustments(breakdown({
      rest_days: { home_effect: 0.03, away_effect: -0.03, metadata: {} },
      motivation: { home_effect: 0.05, away_effect: -0.02, metadata: {} }
    }), coef);
    expect(c.home_total).toBeCloseTo(0.08, 10);
    expect(c.away_total).toBeCloseTo(-0.05, 10);
    expect(c.net_advantage_home).toBeCloseTo(0.13, 10);
    expect(c.capped).toBe(false);
  });

  it('caps each side at ±12% and flags it', () => {
    const c = combineAdjustments(breakdown({
      motivation: { home_effect: 0.08, away_effect: -0.08, metadata: {} },
      cluster_injury: { home_effect: 0.07, away_effect: -0.07, metadata: {} }
    }), coef);
    expect(c.home_total).toBe(0.12);
    expect(c.away_total).toBe(-0.12);
    expect(c.capped).toBe(true);
  });

  it('aggregates xG, totals, BTTS modifiers and max CI widening', () => {
    const c = combineAdjustments(breakdown({
      set_piece: { home_effect: 0, away_effect: 0, xg_modifier_home: 0.1, totals_modifier: 0.02, metadata: {} },
      weather: { home_effect: 0, away_effect: 0, btts_modifier: 0.02, ci_widening: 0.1, metadata: {} },
      motivation: { home_effect: 0, away_effect: 0, ci_widening: 0.15, metadata: {} }
    }), coef);
    expect(c.xg_modifiers.home).toBeCloseTo(0.1, 10);
    expect(c.xg_modifiers.totals_offset).toBeCloseTo(0.02, 10);
    expect(c.btts_modifier).toBeCloseTo(0.02, 10);
    expect(c.ci_widening).toBeCloseTo(0.15, 10);
  });

  it('is deterministic (same inputs → same output)', () => {
    const b = breakdown({ travel: { home_effect: -0.02, away_effect: -0.01, metadata: {} } });
    expect(combineAdjustments(b, coef)).toEqual(combineAdjustments(b, coef));
  });
});

// Python reference vectors (generated from the live Quant pipeline, params:
// correlation 0.08, dc_rho -0.06, inflation 1.06, temper 1.0)
const PYTHON_REFERENCE = [
  { lh: 1.5, la: 1.1, home: 0.4461557536, draw: 0.2965562409, away: 0.2572880055, over25: 0.4711643971, btts: 0.5354586872 },
  { lh: 2.38, la: 0.73, home: 0.7342058333, draw: 0.1845643679, away: 0.0812297988, over25: 0.5877241955, btts: 0.4809002921 },
  { lh: 0.9, la: 0.9, home: 0.3126777663, draw: 0.3746444674, away: 0.3126777663, over25: 0.2675189196, btts: 0.3741311619 },
  { lh: 3.2, la: 0.4, home: 0.9005893327, draw: 0.0827104443, away: 0.016700223, over25: 0.6822728211, btts: 0.3199366503 }
];

describe('Poisson port parity with Python (divergence guard)', () => {
  for (const ref of PYTHON_REFERENCE) {
    it(`matches Python on λ=(${ref.lh}, ${ref.la})`, () => {
      const joint = buildJointDistribution(ref.lh, ref.la);
      const outcome = deriveOutcome(joint);
      expect(outcome.home).toBeCloseTo(ref.home, 8);
      expect(outcome.draw).toBeCloseTo(ref.draw, 8);
      expect(outcome.away).toBeCloseTo(ref.away, 8);
      expect(deriveTotals(joint)['2.5'].over).toBeCloseTo(ref.over25, 8);
      expect(deriveBtts(joint).yes_prob).toBeCloseTo(ref.btts, 8);
    });
  }

  it('AH quarter lines are the mean of adjacent half lines', () => {
    const joint = buildJointDistribution(1.8, 1.0);
    const ah = deriveAsianHandicap(joint);
    expect(ah['-0.75'].home_covers).toBeCloseTo((ah['-0.5'].home_covers + ah['-1'].home_covers) / 2, 10);
  });
});

function quantFixture(): QuantPrediction {
  return {
    prediction_id: 'p1', match_id: 'm1', model_version: '1.0.0',
    predicted_at: new Date().toISOString(),
    expected_goals: { home: 1.5, away: 1.1, total: 2.6 },
    predictions: {
      match_outcome: { home_win_prob: 0.45, draw_prob: 0.29, away_win_prob: 0.26 },
      double_chance: {}, draw_no_bet: {}, totals: { '2.5': { over: 0.47, under: 0.53 } },
      asian_handicap: { '-0.5': { home_covers: 0.45, away_covers: 0.55 } },
      both_teams_to_score: { yes_prob: 0.53, no_prob: 0.47 },
      halftime_fulltime: {}, halftime_totals: {}
    },
    confidence_interval: {
      method: 'bootstrap', iterations: 1000, home_win_ci_width: 0.06,
      draw_ci_width: 0.04, away_win_ci_width: 0.05, low_confidence_flag: false
    },
    rating_components: {},
    diagnostic: { inputs_quality_score: 90, warnings: [], xi_status: 'unknown' }
  };
}

describe('applyToQuant', () => {
  const combined = (net: number, xgH = 0, xgA = 0) => ({
    home_total: net, away_total: 0, capped: false, net_advantage_home: net,
    xg_modifiers: { home: xgH, away: xgA, totals_offset: 0 }, btts_modifier: 0, ci_widening: 0
  });

  it('shifts the win differential, holds draw, renormalizes to 1', () => {
    const adj = applyToQuant(quantFixture(), combined(0.05));
    const mo = adj.adjusted_match_outcome;
    expect(mo.home_win_prob + mo.draw_prob + mo.away_win_prob).toBeCloseTo(1, 10);
    expect(mo.home_win_prob).toBeGreaterThan(0.45);
    expect(mo.away_win_prob).toBeLessThan(0.26);
  });

  it('zero adjustment is identity on the outcome', () => {
    const adj = applyToQuant(quantFixture(), combined(0));
    expect(adj.adjusted_match_outcome.home_win_prob).toBeCloseTo(0.45, 6);
    expect(adj.extreme_clip_flag).toBe(false);
  });

  it('xG modifiers shift totals through the ported joint', () => {
    const more = applyToQuant(quantFixture(), combined(0, 0.4, 0.3));
    const less = applyToQuant(quantFixture(), combined(0, -0.4, -0.3));
    expect(more.adjusted_totals['2.5'].over).toBeGreaterThan(less.adjusted_totals['2.5'].over);
    expect(more.adjusted_xg.home).toBeCloseTo(1.9, 10);
  });

  it('flags extreme clipping instead of shipping nonsense', () => {
    const q = quantFixture();
    q.predictions.match_outcome = { home_win_prob: 0.93, draw_prob: 0.05, away_win_prob: 0.02 };
    const adj = applyToQuant(q, combined(0.1));
    expect(adj.extreme_clip_flag).toBe(true);
  });

  it('derived double chance + DNB stay consistent with adjusted outcome', () => {
    const adj = applyToQuant(quantFixture(), combined(0.04));
    const mo = adj.adjusted_match_outcome;
    expect(adj.adjusted_double_chance.home_or_draw).toBeCloseTo(mo.home_win_prob + mo.draw_prob, 10);
    expect(adj.adjusted_draw_no_bet.home_dnb_prob).toBeCloseTo(mo.home_win_prob / (mo.home_win_prob + mo.away_win_prob), 10);
  });
});

describe('classifyTeamStatus (group permutation analysis)', () => {
  const row = (code: string, points: number, gd = 0, gf = 0, played = 2) =>
    ({ team_code: code, played, points, goal_diff: gd, goals_for: gf });

  it('runaway leader is guaranteed_first', () => {
    // A has 6 pts +6 GD; nearest rival max 4 pts
    const standings = [row('A', 6, 6, 7), row('B', 1, -1, 2), row('C', 1, -2, 1), row('D', 1, -3, 1)];
    const remaining = [{ home_code: 'A', away_code: 'B' }, { home_code: 'C', away_code: 'D' }];
    expect(classifyTeamStatus('A', standings, remaining)).toBe('guaranteed_first');
  });

  it('6 points with weak GD can still be guaranteed_advance', () => {
    // A 6 pts but B also 6 with better GD → A locked top-2 but not first
    const standings = [row('A', 6, 1, 3), row('B', 6, 5, 6), row('C', 0, -3, 1), row('D', 0, -3, 0)];
    const remaining = [{ home_code: 'A', away_code: 'B' }, { home_code: 'C', away_code: 'D' }];
    const status = classifyTeamStatus('A', standings, remaining);
    expect(['guaranteed_advance', 'guaranteed_first']).toContain(status);
  });

  it('0 points after two losses with bad GD → eliminated_with_pride', () => {
    const standings = [row('A', 6, 4, 5), row('B', 4, 2, 3), row('C', 1, -2, 1), row('D', 0, -4, 0)];
    const remaining = [{ home_code: 'A', away_code: 'D' }, { home_code: 'B', away_code: 'C' }];
    expect(classifyTeamStatus('D', standings, remaining)).toBe('eliminated_with_pride');
  });

  it('mid-table team with live scenarios is fighting', () => {
    const standings = [row('A', 4, 2, 3), row('B', 3, 0, 2), row('C', 2, -1, 2), row('D', 1, -1, 1)];
    const remaining = [{ home_code: 'A', away_code: 'C' }, { home_code: 'B', away_code: 'D' }];
    expect(classifyTeamStatus('B', standings, remaining)).toBe('fighting');
    expect(classifyTeamStatus('C', standings, remaining)).toBe('fighting');
  });

  it('Brazil-Cameroon 2022 shape: leader locked top-2 (not first — SUI can leapfrog on GD), opponent fighting', () => {
    const standings = [row('BRA', 6, 3, 3), row('SUI', 3, 1, 1), row('CMR', 1, -1, 4), row('SRB', 1, -3, 5)];
    const remaining = [{ home_code: 'BRA', away_code: 'CMR' }, { home_code: 'SUI', away_code: 'SRB' }];
    // Margin-aware: SUI winning big while BRA loses big flips first place — so
    // 'guaranteed_advance', which still triggers rotation + motivation factors.
    expect(classifyTeamStatus('BRA', standings, remaining)).toBe('guaranteed_advance');
    expect(classifyTeamStatus('CMR', standings, remaining)).toBe('fighting');  // can reach 4 pts
  });
});
