/**
 * Kelly stake calculator (06_AGENT_TREASURER.md / 07_SHARED_CONTRACTS.md).
 * Money is BigInt cents end-to-end. Floats never touch the ledger.
 */

export const BASE_KELLY_FRACTION = 0.25;
export const REDUCED_KELLY_FRACTION = 0.125;
export const LOW_CONFIDENCE_MULTIPLIER = 0.5;
export const KNOCKOUT_STAGE_MULTIPLIER = 0.85;
export const HARD_CAP_PCT = 0.03;
export const FLOOR_CENTS = 2000n; // $20

export type KellyRejectionReason = 'kelly_non_positive' | 'stake_below_floor' | null;

export interface KellyStakeArgs {
  adjusted_win_prob: number;
  decimal_odds: number;
  bankroll_cents: bigint;
  /** 0.25 default, 0.125 in reduced (drawdown) state */
  fraction: number;
  low_confidence_flag: boolean;
  knockout_stage: boolean;
}

export interface KellyStakeResult {
  stake_cents: bigint;
  kelly_fraction_full: number;
  cap_reasoning: string;
  approved: boolean;
  rejection_reason: KellyRejectionReason;
}

export function calculateKellyStake(args: KellyStakeArgs): KellyStakeResult {
  const { adjusted_win_prob: p, decimal_odds, bankroll_cents, fraction } = args;

  if (!Number.isFinite(decimal_odds) || decimal_odds <= 1) {
    throw new Error(`Invalid decimal odds: ${decimal_odds}`);
  }
  if (!Number.isFinite(p) || p <= 0 || p >= 1) {
    throw new Error(`Invalid win probability: ${p}`);
  }
  if (bankroll_cents < 0n) {
    throw new Error(`Invalid bankroll: ${bankroll_cents}`);
  }

  const b = decimal_odds - 1;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;

  if (fullKelly <= 0) {
    return {
      stake_cents: 0n,
      kelly_fraction_full: fullKelly,
      cap_reasoning: 'No positive Kelly fraction',
      approved: false,
      rejection_reason: 'kelly_non_positive'
    };
  }

  let kellyStakePct = fullKelly * fraction;
  if (args.low_confidence_flag) kellyStakePct *= LOW_CONFIDENCE_MULTIPLIER;
  if (args.knockout_stage) kellyStakePct *= KNOCKOUT_STAGE_MULTIPLIER;

  // Bankrolls are far below 2^53 cents; Number round-trip is exact here.
  const bankrollNumber = Number(bankroll_cents);
  let stake_cents = BigInt(Math.round(kellyStakePct * bankrollNumber));
  let cap_reasoning = `Quarter-Kelly: ${(kellyStakePct * 100).toFixed(2)}% of bankroll`;

  const hardCapCents = BigInt(Math.round(HARD_CAP_PCT * bankrollNumber));
  if (stake_cents > hardCapCents) {
    stake_cents = hardCapCents;
    cap_reasoning = `Capped at 3% hard cap ($${(Number(hardCapCents) / 100).toFixed(2)})`;
  }

  if (stake_cents < FLOOR_CENTS) {
    return {
      stake_cents: 0n,
      kelly_fraction_full: fullKelly,
      cap_reasoning: `Computed stake $${(Number(stake_cents) / 100).toFixed(2)} below $20 floor`,
      approved: false,
      rejection_reason: 'stake_below_floor'
    };
  }

  return {
    stake_cents,
    kelly_fraction_full: fullKelly,
    cap_reasoning,
    approved: true,
    rejection_reason: null
  };
}
