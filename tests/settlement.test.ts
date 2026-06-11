import { describe, it, expect } from 'vitest';
import { computeSettlement, type BetOutcome } from '../src/shared/utils/settlement';

describe('computeSettlement (BigInt cents)', () => {
  const stake = 5000n; // $50

  it('win pays stake × decimal', () => {
    // $50 @ 2.95 → payout $147.50, P&L +$97.50
    const r = computeSettlement('win', stake, 2.95);
    expect(r.payout_cents).toBe(14750n);
    expect(r.pl_cents).toBe(9750n);
  });

  it('loss pays nothing', () => {
    const r = computeSettlement('loss', stake, 2.95);
    expect(r.payout_cents).toBe(0n);
    expect(r.pl_cents).toBe(-5000n);
  });

  it('push and void return stake', () => {
    for (const outcome of ['push', 'void'] as BetOutcome[]) {
      const r = computeSettlement(outcome, stake, 2.95);
      expect(r.payout_cents).toBe(5000n);
      expect(r.pl_cents).toBe(0n);
    }
  });

  it('half win pays half stake at full odds, half pushes', () => {
    // $50 @ 1.90: half ($25) wins at 1.90 → $47.50, half pushes → $25. Total $72.50
    const r = computeSettlement('half_win', stake, 1.90);
    expect(r.payout_cents).toBe(7250n);
    expect(r.pl_cents).toBe(2250n);
  });

  it('half loss returns half the stake', () => {
    const r = computeSettlement('half_loss', stake, 1.90);
    expect(r.payout_cents).toBe(2500n);
    expect(r.pl_cents).toBe(-2500n);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeSettlement('win', 0n, 2.0)).toThrow();
    expect(() => computeSettlement('win', stake, 1.0)).toThrow();
  });
});

describe('ledger integrity — 100 simulated placements + settlements', () => {
  it('balance reconciles exactly after every event', () => {
    // Deterministic pseudo-random (no Math.random — reproducibility rule)
    let seed = 42;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };

    let balance = 500_000n; // $5,000 deposit
    const ledger: bigint[] = [balance];
    const outcomes: BetOutcome[] = ['win', 'loss', 'push', 'half_win', 'half_loss', 'void'];

    let totalStaked = 0n;
    let totalPayout = 0n;

    for (let i = 0; i < 100; i++) {
      const stake = BigInt(Math.round(rand() * 9000) + 1000); // $10-$100
      const decimal = 1.5 + rand() * 2.5;                      // 1.5-4.0

      // bet_placed: debit
      balance -= stake;
      totalStaked += stake;
      ledger.push(balance);
      expect(balance).toBeGreaterThanOrEqual(0n);

      // bet_settled: credit payout
      const outcome = outcomes[Math.floor(rand() * outcomes.length)];
      const { payout_cents, pl_cents } = computeSettlement(outcome, stake, decimal);
      expect(payout_cents - stake).toBe(pl_cents);  // internal consistency

      if (payout_cents > 0n) {
        balance += payout_cents;
        ledger.push(balance);
      }
      totalPayout += payout_cents;
    }

    // Final balance = deposit - all stakes + all payouts, exactly
    expect(balance).toBe(500_000n - totalStaked + totalPayout);

    // Ledger never went negative and every entry is internally consistent
    for (const b of ledger) expect(b).toBeGreaterThanOrEqual(0n);
  });
});
