import { describe, it, expect } from 'vitest';
import { parseEventSnapshots, pollIntervalMs, isClosingWindow, normalizeBookKey } from '../src/agents/wolfman/snapshots';
import type { OddsEvent } from '../src/agents/wolfman/odds_api';

const EVENT: OddsEvent = {
  id: 'evt1',
  sport_key: 'soccer_fifa_world_cup',
  commence_time: '2026-06-14T22:00:00Z',
  home_team: 'Spain',
  away_team: 'Cape Verde',
  bookmakers: [
    {
      key: 'pinnacle', title: 'Pinnacle',
      markets: [
        {
          key: 'h2h_3_way',
          outcomes: [
            { name: 'Spain', price: -380 },
            { name: 'Draw', price: 540 },
            { name: 'Cape Verde', price: 1100 }
          ]
        },
        {
          key: 'totals',
          outcomes: [
            { name: 'Over', price: -135, point: 2.5 },
            { name: 'Under', price: 110, point: 2.5 }
          ]
        },
        {
          key: 'spreads',
          outcomes: [
            { name: 'Spain', price: -130, point: -1.5 },
            { name: 'Cape Verde', price: 110, point: 1.5 }
          ]
        }
      ]
    },
    {
      key: 'bet365', title: 'Bet365',
      markets: [
        {
          key: 'h2h_3_way',
          outcomes: [
            { name: 'Spain', price: -370 },
            { name: 'Draw', price: 550 },
            { name: 'Cape Verde', price: 1050 }
          ]
        }
      ]
    }
  ]
};

describe('parseEventSnapshots', () => {
  const rows = parseEventSnapshots(EVENT, 'match-uuid', false);

  it('parses three-way outcome markets per side', () => {
    const outcome = rows.filter((r) => r.market.startsWith('match_outcome_'));
    expect(outcome).toHaveLength(6);  // 3 sides × 2 books
    const pinHome = outcome.find((r) => r.book === 'pinnacle' && r.market === 'match_outcome_home');
    expect(pinHome?.american_odds).toBe(-380);
    expect(pinHome?.side).toBe('home');
    const draw = outcome.find((r) => r.book === 'pinnacle' && r.market === 'match_outcome_draw');
    expect(draw?.american_odds).toBe(540);
  });

  it('parses totals with line in market key and total_line column', () => {
    const over = rows.find((r) => r.market === 'total_over_2.5');
    expect(over?.american_odds).toBe(-135);
    expect(over?.total_line).toBe('2.50');
    const under = rows.find((r) => r.market === 'total_under_2.5');
    expect(under?.american_odds).toBe(110);
  });

  it('parses Asian handicap with signed line per 07 conventions', () => {
    const home = rows.find((r) => r.market === 'asian_handicap_home_-1.5');
    expect(home?.american_odds).toBe(-130);
    expect(home?.ah_line).toBe('-1.50');
    const away = rows.find((r) => r.market === 'asian_handicap_away_+1.5');
    expect(away?.american_odds).toBe(110);
  });

  it('normalizes book keys (bet365 → bet365_eu)', () => {
    expect(normalizeBookKey('bet365')).toBe('bet365_eu');
    expect(rows.some((r) => r.book === 'bet365_eu')).toBe(true);
    expect(normalizeBookKey('draftkings')).toBe('draftkings');
  });

  it('computes decimal odds on every row', () => {
    for (const r of rows) {
      expect(Number(r.decimal_odds)).toBeGreaterThan(1);
    }
  });

  it('marks closing-line rows when requested', () => {
    const closing = parseEventSnapshots(EVENT, 'match-uuid', true);
    expect(closing.every((r) => r.is_closing_line)).toBe(true);
    expect(rows.every((r) => !r.is_closing_line)).toBe(true);
  });
});

describe('pollIntervalMs (adaptive cadence)', () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('matches the Wolfman cadence table', () => {
    expect(pollIntervalMs(3 * DAY, false)).toBe(6 * HOUR);
    expect(pollIntervalMs(20 * HOUR, false)).toBe(2 * HOUR);
    expect(pollIntervalMs(5 * HOUR, false)).toBe(30 * MIN);
    expect(pollIntervalMs(2 * HOUR, false)).toBe(15 * MIN);
    expect(pollIntervalMs(30 * MIN, false)).toBe(5 * MIN);
    expect(pollIntervalMs(10 * MIN, false)).toBe(2 * MIN);
  });

  it('reduced mode floors at 15min, 5min in final hour', () => {
    expect(pollIntervalMs(3 * DAY, true)).toBe(15 * MIN);
    expect(pollIntervalMs(2 * HOUR, true)).toBe(15 * MIN);
    expect(pollIntervalMs(30 * MIN, true)).toBe(5 * MIN);
  });

  it('stops scheduling 3h after kickoff', () => {
    expect(pollIntervalMs(-4 * HOUR, false)).toBeNull();
  });
});

describe('isClosingWindow', () => {
  it('is true only inside T-90s to kickoff', () => {
    expect(isClosingWindow(60_000)).toBe(true);
    expect(isClosingWindow(89_000)).toBe(true);
    expect(isClosingWindow(120_000)).toBe(false);
    expect(isClosingWindow(-1)).toBe(false);
  });
});
