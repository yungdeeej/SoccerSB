/** Full-Wolfman signal tests — steam, A/W divergence, freeze, timing, RLM, synthesis fallback. */
import { describe, it, expect } from 'vitest';
import { detectSteam } from '../src/agents/wolfman/signals/steam';
import { detectAsianWesternDivergence } from '../src/agents/wolfman/signals/asian_western';
import { detectRLM } from '../src/agents/wolfman/signals/rlm';
import { detectLineFreeze } from '../src/agents/wolfman/signals/line_freeze';
import { computeTimingSignal } from '../src/agents/wolfman/signals/timing';
import { templateSummary, buildUserMessage, type MarketSummaryContext } from '../src/agents/wolfman/synthesis';
import { templateWriteup, watchTrigger, type WriteupContext } from '../src/agents/ceo/writeup';
import type { MarketSnapshotSeries, SnapshotPoint } from '../src/agents/wolfman/signals/types';

const NOW = new Date('2026-06-14T18:00:00Z');

function snaps(book: string, points: Array<[number, number]>): [string, SnapshotPoint[]] {
  // points: [minutesAgo, american]
  return [book, points.map(([min, odds]) => ({
    book, american_odds: odds, captured_at: new Date(NOW.getTime() - min * 60_000)
  }))];
}

describe('steam detection', () => {
  it('fires when sharp books move together in 30min (weight ≥ 1.8)', () => {
    const series: MarketSnapshotSeries = new Map([
      snaps('pinnacle', [[25, 400], [5, 360]]),
      snaps('sbobet', [[25, 395], [5, 355]]),
      snaps('bet365_eu', [[25, 420], [5, 380]]),
      snaps('draftkings', [[25, 400], [5, 400]])
    ]);
    const s = detectSteam(series, NOW);
    expect(s.detected).toBe(true);
    expect(s.weight).toBeCloseTo(1.0 + 1.0 + 0.6, 10);
    expect(s.books_involved).toContain('pinnacle');
    expect(s.books_involved).not.toContain('draftkings');
  });

  it('soft books alone cannot trigger steam', () => {
    const series: MarketSnapshotSeries = new Map([
      snaps('draftkings', [[20, -180], [5, -195]]),
      snaps('fanduel', [[20, -178], [5, -190]]),
      snaps('betmgm', [[20, -182], [5, -195]])
    ]);
    const s = detectSteam(series, NOW);
    expect(s.detected).toBe(false);
    expect(s.weight).toBeCloseTo(0.9, 10);
  });

  it('movement outside the 30min window is ignored', () => {
    const series: MarketSnapshotSeries = new Map([
      snaps('pinnacle', [[120, 400], [45, 360]]),
      snaps('sbobet', [[120, 395], [45, 355]])
    ]);
    expect(detectSteam(series, NOW).detected).toBe(false);
  });
});

describe('Asian/Western divergence', () => {
  it('detects a 4¢+ gap on totals', () => {
    const series: MarketSnapshotSeries = new Map([
      snaps('sbobet', [[10, -135]]),
      snaps('ibc', [[10, -133]]),
      snaps('pinnacle', [[10, -110]])
    ]);
    const d = detectAsianWesternDivergence('total_over_2.5', series);
    expect(d.detected).toBe(true);
    expect(d.magnitude_cents).toBeGreaterThan(4);
    expect(d.actionable_side).toBe('asian_aligned');
  });

  it('never applies to 1X2 (Pinnacle is the sole outcome anchor)', () => {
    const series: MarketSnapshotSeries = new Map([
      snaps('sbobet', [[10, -150]]),
      snaps('pinnacle', [[10, -110]])
    ]);
    expect(detectAsianWesternDivergence('match_outcome_home', series).detected).toBe(false);
  });

  it('degrades when Asian books absent', () => {
    const series: MarketSnapshotSeries = new Map([snaps('pinnacle', [[10, -110]])]);
    expect(detectAsianWesternDivergence('total_over_2.5', series).detected).toBe(false);
  });
});

describe('RLM', () => {
  it('degrades gracefully without public data', () => {
    const r = detectRLM(null, 10);
    expect(r.detected).toBe(false);
    expect(r.explanation).toContain('unavailable');
  });
  it('fires at 65% public + 3¢ reverse move', () => {
    expect(detectRLM(0.70, 5).detected).toBe(true);
    expect(detectRLM(0.60, 5).detected).toBe(false);
    expect(detectRLM(0.70, 2).detected).toBe(false);
  });
});

describe('line freeze', () => {
  it('fires when Pinnacle quiet > 10min', () => {
    const [, snapshots] = snaps('pinnacle', [[40, -110], [15, -110]]);
    expect(detectLineFreeze(snapshots, NOW)).toBe(true);
  });
  it('quiet < 10min is normal', () => {
    const [, snapshots] = snaps('pinnacle', [[40, -110], [5, -110]]);
    expect(detectLineFreeze(snapshots, NOW)).toBe(false);
  });
  it('needs at least 2 snapshots', () => {
    const [, snapshots] = snaps('pinnacle', [[40, -110]]);
    expect(detectLineFreeze(snapshots, NOW)).toBe(false);
  });
});

describe('Walters timing', () => {
  const kickoff = new Date(NOW.getTime() + 20 * 3600 * 1000);
  it('favorite far from kickoff → fav_early', () => {
    const t = computeTimingSignal({
      market: 'match_outcome_home', opening_consensus_american: -180,
      current_consensus_american: -185, kickoff_utc: kickoff, now: NOW
    });
    expect(t.signal).toBe('fav_early');
  });
  it('drifting dog near kickoff → dog_late', () => {
    const t = computeTimingSignal({
      market: 'match_outcome_away', opening_consensus_american: 300,
      current_consensus_american: 340, kickoff_utc: new Date(NOW.getTime() + 3 * 3600 * 1000), now: NOW
    });
    expect(t.signal).toBe('dog_late');
  });
  it('drifting draw → draw_drift_value', () => {
    const t = computeTimingSignal({
      market: 'match_outcome_draw', opening_consensus_american: 230,
      current_consensus_american: 240, kickoff_utc: new Date(NOW.getTime() + 3 * 3600 * 1000), now: NOW
    });
    expect(t.signal).toBe('draw_drift_value');
  });
  it('otherwise neutral', () => {
    const t = computeTimingSignal({
      market: 'match_outcome_home', opening_consensus_american: -150,
      current_consensus_american: -150, kickoff_utc: new Date(NOW.getTime() + 2 * 3600 * 1000), now: NOW
    });
    expect(t.signal).toBe('neutral');
  });
});

function summaryCtx(): MarketSummaryContext {
  return {
    matchup: 'CPV @ ESP', stage: 'group_md1', market: 'match_outcome_home',
    opening_consensus_american: -350, current_consensus_american: -380,
    total_movement_cents: -30,
    pinnacle_current_american: -385, pinnacle_no_vig_pct: 79.2,
    sbobet_current_american: null,
    best_book: 'bet365_ontario', best_book_american: -380,
    steam: { detected: true, weight: 2.0, books_involved: ['pinnacle', 'sbobet'], explanation: 'Steam: pinnacle, sbobet moved ≥3¢ in 30min window (weight: 2.0)', window_minutes: 30 },
    rlm: { detected: false, explanation: 'Public bet data unavailable' },
    aw_divergence: { detected: false, magnitude_cents: 0, asian_implied_pct: null, western_implied_pct: null, actionable_side: null, explanation: null },
    line_freeze: false,
    timing: { signal: 'fav_early', explanation: 'Favorite — bet early.' }
  };
}

describe('Wolfman synthesis (template fallback path)', () => {
  it('template summary contains movement, anchor, best price, signals', () => {
    const s = templateSummary(summaryCtx());
    expect(s).toContain('-350');
    expect(s).toContain('-380');
    expect(s).toContain('Pinnacle -385');
    expect(s).toContain('bet365_ontario');
    expect(s).toContain('Steam detected.');
  });
  it('user message includes all structured sections', () => {
    const msg = buildUserMessage(summaryCtx());
    expect(msg).toContain('Sharp anchors:');
    expect(msg).toContain('Signals detected:');
    expect(msg).toContain('Steam:');
  });
});

describe('CEO writeup templates (LLM fallback path)', () => {
  function writeupCtx(decision: 'STRIKE' | 'WATCH' | 'PASS'): WriteupContext {
    return {
      decision,
      ctx: {
        match_id: 'm1', market: 'match_outcome_home', side: 'home',
        tournament_stage: 'group_md2', is_opener: false, hours_to_kickoff: 3, run_phase: 'T-2h',
        adjusted_prob: 0.53, low_confidence: false, quant_ci_max_width: 0.06,
        best_book: 'draftkings', best_book_american: 100, best_book_decimal: 2.0,
        pinnacle_no_vig_prob: 0.51, movement_last_30min_cents: 0,
        movement_direction_adverse: false, line_freeze: false,
        asian_western: { detected: false, magnitude_cents: 0, asian_implied_pct: null, western_implied_pct: null, actionable_side: null, explanation: null },
        sbobet_no_vig_prob: null,
        tactician: { flags: [], flagged_lineup_concerns: [], home_xi_status: 'confirmed', away_xi_status: 'confirmed', home_cluster_score: 0, away_cluster_score: 0, combined_advantage_home: 0.02, total_adjustment_capped: false } as never,
        treasurer: {
          active_bankroll_cents: 500000n, available_capital_cents: 500000n,
          stop_loss_active: 'none', todays_bet_count: 0, daily_bet_cap: 5, current_kelly_fraction: 0.25,
          total_capital_cents: 500000n, pending_wagers_cents: 0n, peak_bankroll_cents: 500000n,
          peak_reached_at: null, drawdown_pct_from_peak: 0, stop_loss_reason: null,
          stop_loss_resumes_at: null, todays_bets_by_match: new Map(), daily_bet_cap_effective: 5,
          this_week_clv_cents: 0, rolling_30d_clv_cents: 0, clv_classification: 'marginal'
        },
        already_bet_this_match_today: false
      },
      failure: decision === 'STRIKE' ? null : { passed: false, gate: 'edge_borderline', explanation: 'Edge 2.2% in borderline band', watch_eligible: decision === 'WATCH' },
      stars: 2, stake_dollars: 150, matchup: 'CPV @ ESP', kickoff_display: 'June 14, 4:00 PM MT',
      wolfman_summary: 'Steam toward home.', factor_summary: 'travel -1.0%/-2.0%'
    };
  }

  it('STRIKE template cites edge, book, stars, stake', () => {
    const t = templateWriteup(writeupCtx('STRIKE'));
    expect(t).toContain('6.00%');  // 0.53×2-1
    expect(t).toContain('draftkings');
    expect(t).toContain('Strike with sizing');
  });
  it('PASS template cites the failed gate without apology', () => {
    const t = templateWriteup(writeupCtx('PASS'));
    expect(t).toContain('Pass.');
    expect(t).toContain('edge_borderline');
  });
  it('WATCH template names the trigger', () => {
    const t = templateWriteup(writeupCtx('WATCH'));
    expect(t).toContain('Watch.');
    expect(t).toContain('line drift');
  });
  it('watch triggers map per gate', () => {
    expect(watchTrigger({ passed: false, gate: 'xi_unconfirmed_early' })).toContain('XI confirmation');
    expect(watchTrigger({ passed: false, gate: 'something_else' })).toContain('next checkpoint');
  });
});
