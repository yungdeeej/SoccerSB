/**
 * Settlement payout math — pure, BigInt cents.
 * Asian handicap quarter lines settle as half_win / half_loss.
 */

export type BetOutcome = 'win' | 'loss' | 'push' | 'half_win' | 'half_loss' | 'void';

export interface SettlementResult {
  payout_cents: bigint;
  pl_cents: bigint;
}

export function computeSettlement(
  outcome: BetOutcome,
  stake_cents: bigint,
  decimal_odds: number
): SettlementResult {
  if (stake_cents <= 0n) throw new Error(`Invalid stake: ${stake_cents}`);
  if (!Number.isFinite(decimal_odds) || decimal_odds <= 1) {
    throw new Error(`Invalid decimal odds: ${decimal_odds}`);
  }

  const stakeNum = Number(stake_cents);

  switch (outcome) {
    case 'win': {
      const payout = BigInt(Math.round(stakeNum * decimal_odds));
      return { payout_cents: payout, pl_cents: payout - stake_cents };
    }
    case 'loss':
      return { payout_cents: 0n, pl_cents: -stake_cents };
    case 'push':
    case 'void':
      return { payout_cents: stake_cents, pl_cents: 0n };
    case 'half_win': {
      // Half stake wins at full odds, half stake pushes
      const payout = BigInt(Math.round(stakeNum * (1 + (decimal_odds - 1) / 2)));
      return { payout_cents: payout, pl_cents: payout - stake_cents };
    }
    case 'half_loss': {
      // Half stake loses, half stake pushes
      const payout = BigInt(Math.round(stakeNum / 2));
      return { payout_cents: payout, pl_cents: payout - stake_cents };
    }
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unknown outcome: ${String(exhaustive)}`);
    }
  }
}
