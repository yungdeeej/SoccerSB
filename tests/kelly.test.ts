import { describe, it, expect } from 'vitest';
import {
  calculateKellyStake,
  BASE_KELLY_FRACTION,
  REDUCED_KELLY_FRACTION,
  FLOOR_CENTS
} from '../src/shared/utils/kelly';

const baseArgs = {
  adjusted_win_prob: 0.55,
  decimal_odds: 2.30,
  bankroll_cents: 500_000n, // $5,000
  fraction: BASE_KELLY_FRACTION,
  low_confidence_flag: false,
  knockout_stage: false
};

describe('calculateKellyStake', () => {
  it('matches the Treasurer worked example: full Kelly 20%, capped at 3% hard cap', () => {
    // b=1.30, p=0.55, q=0.45 → full Kelly = 0.265/1.3 ≈ 0.2038 (doc rounds to 0.2);
    // quarter ≈ 5.1% → $254.81 > 3% cap $150
    const res = calculateKellyStake(baseArgs);
    expect(res.approved).toBe(true);
    expect(res.kelly_fraction_full).toBeCloseTo(0.265 / 1.3, 10);
    expect(res.stake_cents).toBe(15_000n); // $150 = 3% of $5,000
    expect(res.cap_reasoning).toContain('3% hard cap');
  });

  it('returns uncapped quarter-Kelly stake when below the hard cap', () => {
    // p=0.40, dec=2.80: b=1.8 → full Kelly = (0.72-0.6)/1.8 = 0.0667; quarter ≈ 1.667% → $83.33
    const res = calculateKellyStake({ ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80 });
    expect(res.approved).toBe(true);
    expect(res.stake_cents).toBe(8_333n);
    expect(res.cap_reasoning).toContain('Quarter-Kelly');
  });

  it('rejects when Kelly is non-positive (no edge)', () => {
    const res = calculateKellyStake({ ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.0 });
    expect(res.approved).toBe(false);
    expect(res.rejection_reason).toBe('kelly_non_positive');
    expect(res.stake_cents).toBe(0n);
  });

  it('rejects when computed stake is below the $20 floor', () => {
    const res = calculateKellyStake({
      ...baseArgs,
      adjusted_win_prob: 0.40,
      decimal_odds: 2.80,
      bankroll_cents: 100_000n // $1,000 → quarter-Kelly ≈ $16.67 < $20
    });
    expect(res.approved).toBe(false);
    expect(res.rejection_reason).toBe('stake_below_floor');
    expect(res.stake_cents).toBe(0n);
  });

  it('halves exposure on low confidence', () => {
    const normal = calculateKellyStake({ ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80 });
    const lowConf = calculateKellyStake({
      ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80, low_confidence_flag: true
    });
    expect(Number(lowConf.stake_cents)).toBeCloseTo(Number(normal.stake_cents) / 2, -1);
  });

  it('applies 0.85x knockout multiplier', () => {
    const group = calculateKellyStake({ ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80 });
    const knockout = calculateKellyStake({
      ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80, knockout_stage: true
    });
    expect(Number(knockout.stake_cents)).toBeCloseTo(Number(group.stake_cents) * 0.85, -1);
  });

  it('reduced-state fraction (0.125) halves the stake vs quarter-Kelly', () => {
    const quarter = calculateKellyStake({ ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80 });
    const reduced = calculateKellyStake({
      ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80, fraction: REDUCED_KELLY_FRACTION
    });
    expect(Number(reduced.stake_cents)).toBeCloseTo(Number(quarter.stake_cents) / 2, -1);
  });

  it('stake at exactly the floor is approved', () => {
    // Engineer bankroll so quarter-Kelly lands exactly on $20:
    // full Kelly 0.0667 × 0.25 = 1.667% → need bankroll $1,200 → stake $20
    const res = calculateKellyStake({
      ...baseArgs, adjusted_win_prob: 0.40, decimal_odds: 2.80, bankroll_cents: 120_000n
    });
    expect(res.stake_cents).toBe(FLOOR_CENTS);
    expect(res.approved).toBe(true);
  });

  it('throws on invalid inputs', () => {
    expect(() => calculateKellyStake({ ...baseArgs, decimal_odds: 1 })).toThrow();
    expect(() => calculateKellyStake({ ...baseArgs, adjusted_win_prob: 0 })).toThrow();
    expect(() => calculateKellyStake({ ...baseArgs, adjusted_win_prob: 1 })).toThrow();
    expect(() => calculateKellyStake({ ...baseArgs, bankroll_cents: -1n })).toThrow();
  });

  it('returns BigInt cents (never floats) on the money path', () => {
    const res = calculateKellyStake(baseArgs);
    expect(typeof res.stake_cents).toBe('bigint');
  });
});
