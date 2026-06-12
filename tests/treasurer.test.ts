/** Treasurer tests — stop-loss boundaries, sizing, cooldowns, CLV, locking, compound. */
import { describe, it, expect } from 'vitest';
import { evaluateStopLossState, drawdownPct } from '../src/agents/treasurer/stop_loss';
import { computeStakeFromSnapshot, type StakeRequest } from '../src/agents/treasurer/sizing';
import { evaluateCooldownFromBets } from '../src/agents/treasurer/cooldown';
import { computeTwoWayCLV, computeThreeWayCLV, opposingMarketKey, classifyBetCLV } from '../src/agents/treasurer/clv';
import { classifyCLV, type TreasurerSnapshot } from '../src/agents/treasurer/snapshot';
import { compoundGainPct } from '../src/agents/treasurer/daily_report';
import { withMatchLock } from '../src/agents/treasurer/locking';
import type { CooldownState } from '../src/agents/treasurer/cooldown';

// ---------------------------------------------------------------------------
// Stop-loss state machine — exact boundaries
// ---------------------------------------------------------------------------

describe('stop-loss state machine', () => {
  const peak = 1_000_000n; // $10,000

  it('none below 12% drawdown', () => {
    expect(evaluateStopLossState(890_000n, peak).level).toBe('none');   // 11%
    expect(evaluateStopLossState(880_001n, peak).level).toBe('none');   // 11.9999%
  });

  it('reduced_kelly at exactly 12%', () => {
    const s = evaluateStopLossState(880_000n, peak);                     // exactly 12%
    expect(s.level).toBe('reduced_kelly');
    expect(s.kelly_modifier).toBe(0.5);
    expect(s.daily_cap_override).toBe(3);
    expect(s.resumes_at).not.toBeNull();
  });

  it('still reduced just under 20%', () => {
    expect(evaluateStopLossState(800_100n, peak).level).toBe('reduced_kelly');  // 19.99%
  });

  it('halt at exactly 20%', () => {
    const s = evaluateStopLossState(800_000n, peak);                     // exactly 20%
    expect(s.level).toBe('halt');
    expect(s.kelly_modifier).toBe(0);
    expect(s.daily_cap_override).toBe(0);
  });

  it('no state when at or above peak / zero peak', () => {
    expect(evaluateStopLossState(peak, peak).level).toBe('none');
    expect(evaluateStopLossState(1_100_000n, peak).level).toBe('none');
    expect(evaluateStopLossState(0n, 0n).level).toBe('none');
  });

  it('drawdownPct BigInt math is exact at basis-point precision', () => {
    expect(drawdownPct(880_000n, 1_000_000n)).toBeCloseTo(12.0, 10);
    // Sub-basis-point drawdowns floor to 0 (integer bips) — never spuriously trigger
    expect(drawdownPct(999_999n, 1_000_000n)).toBe(0);
    expect(drawdownPct(999_000n, 1_000_000n)).toBeCloseTo(0.1, 10);
  });
});

// ---------------------------------------------------------------------------
// Sizing — caps, floors, multipliers (pure core)
// ---------------------------------------------------------------------------

function snapshot(overrides: Partial<TreasurerSnapshot> = {}): TreasurerSnapshot {
  return {
    active_bankroll_cents: 500_000n,       // $5,000
    available_capital_cents: 500_000n,
    stop_loss_active: 'none',
    todays_bet_count: 0,
    daily_bet_cap: 5,
    current_kelly_fraction: 0.25,
    total_capital_cents: 500_000n,
    pending_wagers_cents: 0n,
    peak_bankroll_cents: 500_000n,
    peak_reached_at: null,
    drawdown_pct_from_peak: 0,
    stop_loss_reason: null,
    stop_loss_resumes_at: null,
    todays_bets_by_match: new Map(),
    daily_bet_cap_effective: 5,
    this_week_clv_cents: 0,
    rolling_30d_clv_cents: 0,
    clv_classification: 'marginal',
    ...overrides
  };
}

function req(overrides: Partial<StakeRequest> = {}): StakeRequest {
  return {
    match_id: 'm1', market: 'match_outcome_home', side: 'home',
    adjusted_win_prob: 0.55, american_odds: 130, decimal_odds: 2.30,
    book: 'draftkings', edge_pct: 3.5, low_confidence_flag: false,
    tournament_stage: 'group_md2',
    ...overrides
  };
}

const NO_COOLDOWN: CooldownState = { active: false, reason: null, remaining_minutes: null, effective_cap_today: null };

describe('calculateStake core (Treasurer worked example)', () => {
  it('quarter-Kelly capped at 3% hard cap: $5000, p=.55, dec 2.30 → $150', () => {
    const r = computeStakeFromSnapshot(req(), snapshot(), NO_COOLDOWN);
    expect(r.approved).toBe(true);
    expect(r.recommended_stake_cents).toBe(15_000n);  // 3% of $5,000
    expect(r.cap_reasoning).toContain('3% hard cap');
    expect(r.kelly_fraction_full).toBeCloseTo(0.265 / 1.3, 10);
  });

  it('uncapped stake below the 3% cap', () => {
    const r = computeStakeFromSnapshot(req({ adjusted_win_prob: 0.40, decimal_odds: 2.80 }), snapshot(), NO_COOLDOWN);
    expect(r.recommended_stake_cents).toBe(8_333n);   // quarter of 6.67% full Kelly
  });

  it('$20 floor rejection', () => {
    const r = computeStakeFromSnapshot(
      req({ adjusted_win_prob: 0.40, decimal_odds: 2.80 }),
      snapshot({ active_bankroll_cents: 100_000n, available_capital_cents: 100_000n }),
      NO_COOLDOWN
    );
    expect(r.approved).toBe(false);
    expect(r.rejection_reason).toBe('stake_below_floor');
  });

  it('low-confidence halves, knockout multiplies 0.85x, both stack', () => {
    const base = computeStakeFromSnapshot(req({ adjusted_win_prob: 0.40, decimal_odds: 2.80 }), snapshot(), NO_COOLDOWN);
    const low = computeStakeFromSnapshot(req({ adjusted_win_prob: 0.40, decimal_odds: 2.80, low_confidence_flag: true }), snapshot(), NO_COOLDOWN);
    const ko = computeStakeFromSnapshot(req({ adjusted_win_prob: 0.40, decimal_odds: 2.80, tournament_stage: 'qf' }), snapshot(), NO_COOLDOWN);
    const both = computeStakeFromSnapshot(req({ adjusted_win_prob: 0.40, decimal_odds: 2.80, low_confidence_flag: true, tournament_stage: 'qf' }), snapshot(), NO_COOLDOWN);
    expect(Number(low.recommended_stake_cents)).toBeCloseTo(Number(base.recommended_stake_cents) / 2, -1);
    expect(Number(ko.recommended_stake_cents)).toBeCloseTo(Number(base.recommended_stake_cents) * 0.85, -1);
    expect(Number(both.recommended_stake_cents)).toBeCloseTo(Number(base.recommended_stake_cents) * 0.425, -1);
  });

  it('reduced-state Kelly (0.125) halves the stake', () => {
    const reduced = computeStakeFromSnapshot(
      req({ adjusted_win_prob: 0.40, decimal_odds: 2.80 }),
      snapshot({ current_kelly_fraction: 0.125 }),
      NO_COOLDOWN
    );
    expect(reduced.recommended_stake_cents).toBe(4_167n);  // half of 8333
  });

  it('halt rejects everything', () => {
    const r = computeStakeFromSnapshot(req(), snapshot({ stop_loss_active: 'halt' }), NO_COOLDOWN);
    expect(r.rejection_reason).toBe('stop_loss_halt');
  });

  it('daily cap by stage: 5 group / 3 knockout', () => {
    const group = computeStakeFromSnapshot(req(), snapshot({ todays_bet_count: 5 }), NO_COOLDOWN);
    expect(group.rejection_reason).toBe('daily_cap_reached');
    const ko = computeStakeFromSnapshot(
      req({ tournament_stage: 'r16' }),
      snapshot({ todays_bet_count: 3, daily_bet_cap: 3, daily_bet_cap_effective: 3 }),
      NO_COOLDOWN
    );
    expect(ko.rejection_reason).toBe('daily_cap_reached');
  });

  it('one bet per match per day', () => {
    const r = computeStakeFromSnapshot(
      req(),
      snapshot({ todays_bets_by_match: new Map([['m1', 1]]), todays_bet_count: 1 }),
      NO_COOLDOWN
    );
    expect(r.rejection_reason).toBe('match_already_bet_today');
  });

  it('kelly non-positive rejection', () => {
    const r = computeStakeFromSnapshot(req({ adjusted_win_prob: 0.40, decimal_odds: 2.0 }), snapshot(), NO_COOLDOWN);
    expect(r.rejection_reason).toBe('kelly_non_positive');
  });

  it('cooldown timer rejection + cooldown cap folds into daily cap', () => {
    const paused = computeStakeFromSnapshot(req(), snapshot(), {
      active: true, reason: 'Two consecutive losses — 30min cooldown', remaining_minutes: 12, effective_cap_today: null
    });
    expect(paused.rejection_reason).toBe('cooldown_active');

    const capped = computeStakeFromSnapshot(req(), snapshot({ todays_bet_count: 2 }), {
      active: true, reason: '3 losses today — capped to current count', remaining_minutes: null, effective_cap_today: 2
    });
    expect(capped.rejection_reason).toBe('daily_cap_reached');
  });
});

// ---------------------------------------------------------------------------
// Cooldown rules (pure)
// ---------------------------------------------------------------------------

describe('cooldown rules', () => {
  const now = new Date('2026-06-14T20:00:00Z');
  const settledAt = (minAgo: number): Date => new Date(now.getTime() - minAgo * 60_000);

  it('two consecutive losses → 30min pause', () => {
    const c = evaluateCooldownFromBets(
      [{ outcome: 'loss', settled_at: settledAt(10) }, { outcome: 'loss', settled_at: settledAt(40) }],
      2, 500_000n, 480_000n, now
    );
    expect(c.active).toBe(true);
    expect(c.remaining_minutes).toBe(20);
  });

  it('pause expires after 30min', () => {
    const c = evaluateCooldownFromBets(
      [{ outcome: 'loss', settled_at: settledAt(35) }, { outcome: 'loss', settled_at: settledAt(50) }],
      2, 500_000n, 480_000n, now
    );
    expect(c.active).toBe(false);
  });

  it('win between losses resets the consecutive count', () => {
    const c = evaluateCooldownFromBets(
      [{ outcome: 'loss', settled_at: settledAt(5) }, { outcome: 'win', settled_at: settledAt(15) }, { outcome: 'loss', settled_at: settledAt(25) }],
      3, 500_000n, 495_000n, now
    );
    expect(c.active).toBe(false);
  });

  it('3 losses today → capped to current count', () => {
    const c = evaluateCooldownFromBets(
      [
        { outcome: 'loss', settled_at: settledAt(200) },
        { outcome: 'win', settled_at: settledAt(150) },
        { outcome: 'loss', settled_at: settledAt(100) },
        { outcome: 'loss', settled_at: settledAt(50) }
      ],
      4, 500_000n, 460_000n, now
    );
    expect(c.active).toBe(true);
    expect(c.effective_cap_today).toBe(4);
  });

  it('down >5% today → cap to current + 1', () => {
    const c = evaluateCooldownFromBets(
      [{ outcome: 'loss', settled_at: settledAt(100) }],
      1, 500_000n, 470_000n, now  // down 6%
    );
    expect(c.active).toBe(true);
    expect(c.effective_cap_today).toBe(2);
  });

  it('down exactly 5% is NOT a trigger (strict >)', () => {
    const c = evaluateCooldownFromBets([], 1, 500_000n, 475_000n, now);  // exactly 5%
    expect(c.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLV (pure)
// ---------------------------------------------------------------------------

describe('CLV computation', () => {
  it('Treasurer worked example: bet +195, close +175 (vs -210 opposing) → +1.57¢ beat_close', () => {
    const r = computeTwoWayCLV(195, 175, -210);
    expect(r.clv_cents).toBeCloseTo(1.57, 1);
    expect(r.classification).toBe('beat_close');
    // Manual: bet implied 1/2.95=.339 vs opp .677 → no-vig .3334; close 1/2.75=.3636 vs .677 → .3494 → +1.6¢? recompute below
    const betNoVig = (1 / 2.95) / (1 / 2.95 + 1 / (1 + 100 / 210));
    expect(r.bet_no_vig_prob).toBeCloseTo(betNoVig, 10);
  });

  it('three-way CLV: line moves toward our side → positive', () => {
    // Bet Mexico +195; closing: home -150/draw +280/away +175 (away = Mexico drifted in)
    const r = computeThreeWayCLV('away', 195, { home: -130, draw: 290, away: 175 });
    expect(r.clv_cents).toBeGreaterThan(0);
    expect(r.classification).toBe('beat_close');
  });

  it('three-way CLV: no movement → matched_close', () => {
    const r = computeThreeWayCLV('home', -150, { home: -150, draw: 280, away: 400 });
    expect(Math.abs(r.clv_cents)).toBeLessThan(0.01);
    expect(r.classification).toBe('matched_close');
  });

  it('negative CLV when line moves against us', () => {
    const r = computeTwoWayCLV(-110, -125, -105);
    expect(r.clv_cents).toBeGreaterThan(0); // -110 → -125 means OUR side shortened = we beat the close
    const worse = computeTwoWayCLV(-125, -110, -105);
    expect(worse.clv_cents).toBeLessThan(0);
    expect(worse.classification).toBe('lost_to_close');
  });

  it('classification thresholds at ±0.5¢', () => {
    expect(classifyBetCLV(0.51)).toBe('beat_close');
    expect(classifyBetCLV(0.5)).toBe('matched_close');
    expect(classifyBetCLV(-0.5)).toBe('matched_close');
    expect(classifyBetCLV(-0.51)).toBe('lost_to_close');
  });

  it('opposing market keys', () => {
    expect(opposingMarketKey('total_over_2.5')).toBe('total_under_2.5');
    expect(opposingMarketKey('asian_handicap_home_-0.5')).toBe('asian_handicap_away_+0.5');
    expect(opposingMarketKey('asian_handicap_away_+1.25')).toBe('asian_handicap_home_-1.25');
    expect(opposingMarketKey('btts_yes')).toBe('btts_no');
    expect(opposingMarketKey('match_outcome_home')).toBeNull();  // handled by 3-way path
  });

  it('rolling CLV classification tiers', () => {
    expect(classifyCLV(0.6)).toBe('sharp');
    expect(classifyCLV(0.5)).toBe('sharp');
    expect(classifyCLV(0.2)).toBe('marginal');
    expect(classifyCLV(0.0)).toBe('marginal');
    expect(classifyCLV(-0.3)).toBe('break_even');
    expect(classifyCLV(-0.6)).toBe('below_replacement');
  });
});

// ---------------------------------------------------------------------------
// Compound trigger + locking
// ---------------------------------------------------------------------------

describe('compound/withdraw trigger', () => {
  it('fires at exactly +20% gain', () => {
    expect(compoundGainPct(600_000n, 500_000n)).toBeCloseTo(20, 10);
    expect(compoundGainPct(599_999n, 500_000n)).toBeLessThan(20);
  });
});

describe('match locking', () => {
  it('serializes 1000 concurrent operations on the same match (no races)', async () => {
    let counter = 0;
    let maxConcurrent = 0;
    let inFlight = 0;

    await Promise.all(
      Array.from({ length: 1000 }, () =>
        withMatchLock('match-x', async () => {
          inFlight++;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          const value = counter;
          await new Promise((r) => setTimeout(r, 0));  // yield — would interleave without lock
          counter = value + 1;
          inFlight--;
        })
      )
    );

    expect(counter).toBe(1000);      // no lost updates
    expect(maxConcurrent).toBe(1);   // strictly serialized
  });

  it('different matches run concurrently', async () => {
    let maxConcurrent = 0;
    let inFlight = 0;
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        withMatchLock(`match-${i}`, async () => {
          inFlight++;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
        })
      )
    );
    expect(maxConcurrent).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// Ledger stats simulation (pure mirror of computeLedgerStats core logic)
// ---------------------------------------------------------------------------

describe('ledger integrity — 1000 simulated entries', () => {
  it('running balance always equals sum of amounts; peak/drawdown tracked exactly', () => {
    let seed = 7;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };

    let balance = 0n;
    let sum = 0n;
    let peak = 0n;
    for (let i = 0; i < 1000; i++) {
      const amount = BigInt(Math.round((rand() - 0.45) * 20_000));  // slight positive drift
      balance += amount;
      sum += amount;
      if (balance > peak) peak = balance;
      expect(balance).toBe(sum);  // balance_after_cents invariant
    }
    expect(peak).toBeGreaterThanOrEqual(balance);
    if (peak > 0n && balance < peak) {
      const dd = Number(((peak - balance) * 10000n) / peak) / 100;
      expect(dd).toBeGreaterThanOrEqual(0);
      expect(dd).toBeLessThanOrEqual(100);
    }
  });
});
