import { describe, it, expect } from 'vitest';
import { computeMarketStates, marketFamily } from '../src/agents/wolfman/market_state';
import { stripVigThreeWay } from '../src/shared/utils/odds';

const ACCESSIBLE = new Set(['draftkings', 'fanduel', 'betmgm', 'bet365_ontario', 'caesars', 'bovada']);

function snap(book: string, market: string, side: string, odds: number, at: string) {
  return { book, market, side, american_odds: odds, captured_at: new Date(at) };
}

describe('marketFamily', () => {
  it('groups match outcome sides into one family', () => {
    expect(marketFamily('match_outcome_home')).toEqual({ family: 'match_outcome', member: 'home' });
    expect(marketFamily('match_outcome_draw')).toEqual({ family: 'match_outcome', member: 'draw' });
  });

  it('groups totals by line', () => {
    expect(marketFamily('total_over_2.5')).toEqual({ family: 'total_2.5', member: 'over' });
    expect(marketFamily('total_under_2.5')).toEqual({ family: 'total_2.5', member: 'under' });
  });

  it('pairs AH home/away lines with opposite signs', () => {
    expect(marketFamily('asian_handicap_home_-0.5')).toEqual({ family: 'ah_-0.5', member: 'home' });
    expect(marketFamily('asian_handicap_away_+0.5')).toEqual({ family: 'ah_-0.5', member: 'away' });
  });
});

describe('computeMarketStates', () => {
  // Opening: pinnacle -180, dk -175. Current: pinnacle -200, dk -185 (line moved toward home)
  const snapshots = [
    snap('pinnacle', 'match_outcome_home', 'home', -180, '2026-06-14T10:00:00Z'),
    snap('pinnacle', 'match_outcome_draw', 'draw', 320, '2026-06-14T10:00:00Z'),
    snap('pinnacle', 'match_outcome_away', 'away', 550, '2026-06-14T10:00:00Z'),
    snap('draftkings', 'match_outcome_home', 'home', -175, '2026-06-14T10:00:00Z'),

    snap('pinnacle', 'match_outcome_home', 'home', -200, '2026-06-14T16:00:00Z'),
    snap('pinnacle', 'match_outcome_draw', 'draw', 330, '2026-06-14T16:00:00Z'),
    snap('pinnacle', 'match_outcome_away', 'away', 580, '2026-06-14T16:00:00Z'),
    snap('draftkings', 'match_outcome_home', 'home', -185, '2026-06-14T16:00:00Z')
  ];

  const states = computeMarketStates('match-1', snapshots, ACCESSIBLE);
  const home = states.find((s) => s.market === 'match_outcome_home');

  it('produces a state per market', () => {
    expect(states.map((s) => s.market).sort()).toEqual([
      'match_outcome_away', 'match_outcome_draw', 'match_outcome_home'
    ]);
  });

  it('uses the latest snapshot per book for current prices', () => {
    expect(home?.pinnacle_current_american).toBe(-200);
  });

  it('picks the best operator-accessible price (pinnacle excluded)', () => {
    expect(home?.best_book).toBe('draftkings');
    expect(home?.best_book_american).toBe(-185);
  });

  it('computes Pinnacle no-vig from the full three-way family', () => {
    const expected = stripVigThreeWay(-200, 330, 580).home_no_vig;
    expect(home?.pinnacle_no_vig_prob).toBeCloseTo(expected, 10);
  });

  it('tracks movement from opening consensus to current consensus', () => {
    expect(home).toBeDefined();
    // Line moved toward home (more negative american) → negative movement cents
    expect(home!.total_movement_cents).toBeLessThan(0);
    expect(home!.opening_consensus_american).toBeGreaterThan(home!.current_consensus_american);
  });

  it('falls back to consensus implied prob when Pinnacle family incomplete', () => {
    const partial = [
      snap('draftkings', 'total_over_2.5', 'over', -110, '2026-06-14T10:00:00Z')
    ];
    const [over] = computeMarketStates('match-2', partial, ACCESSIBLE);
    expect(over.pinnacle_no_vig_prob).toBeNull();
    expect(over.no_vig_probability).toBeCloseTo(1 / (100 / 110 + 1), 4);
  });
});
