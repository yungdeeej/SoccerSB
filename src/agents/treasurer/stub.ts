/**
 * Treasurer STUB — REPLACED IN PHASE 4.
 * Real bankroll from the ledger + placeholder quarter-Kelly sizing so the CEO
 * runs end-to-end. No stop-loss state machine, no CLV, no drawdown tracking.
 */
import { gte } from 'drizzle-orm';
import { db } from '../../db/index';
import { bets } from '../../db/schema';
import { getCurrentBalanceCents } from '../../shared/ledger';
import { calculateKellyStake, BASE_KELLY_FRACTION } from '../../shared/utils/kelly';
import { operatorDayStartUtc } from '../../api/status';

export interface TreasurerSnapshot {
  active_bankroll_cents: bigint;
  available_capital_cents: bigint;
  stop_loss_active: 'none' | 'reduced_kelly' | 'halt';
  todays_bet_count: number;
  daily_bet_cap: number;
  current_kelly_fraction: number;
}

export async function getTreasurerSnapshot(knockoutStage: boolean): Promise<TreasurerSnapshot> {
  const bankroll = await getCurrentBalanceCents();
  const todaysBets = await db
    .select({ id: bets.id })
    .from(bets)
    .where(gte(bets.placed_at, operatorDayStartUtc()));

  return {
    active_bankroll_cents: bankroll,
    available_capital_cents: bankroll,
    stop_loss_active: 'none',  // stub — Phase 4 wires the real state machine
    todays_bet_count: todaysBets.length,
    daily_bet_cap: knockoutStage ? 3 : 5,
    current_kelly_fraction: BASE_KELLY_FRACTION
  };
}

export interface PlaceholderStake {
  stake_cents: bigint;
  fraction: number;
  bankroll_pct: number;
  approved: boolean;
  reasoning: string;
}

export function computePlaceholderStake(args: {
  adjusted_win_prob: number;
  decimal_odds: number;
  snapshot: TreasurerSnapshot;
  low_confidence: boolean;
  knockout_stage: boolean;
}): PlaceholderStake {
  const result = calculateKellyStake({
    adjusted_win_prob: args.adjusted_win_prob,
    decimal_odds: args.decimal_odds,
    bankroll_cents: args.snapshot.active_bankroll_cents,
    fraction: args.snapshot.current_kelly_fraction,
    low_confidence_flag: args.low_confidence,
    knockout_stage: args.knockout_stage
  });

  return {
    stake_cents: result.stake_cents,
    fraction: args.snapshot.current_kelly_fraction,
    bankroll_pct: args.snapshot.active_bankroll_cents > 0n
      ? Number(result.stake_cents * 10000n / args.snapshot.active_bankroll_cents) / 100
      : 0,
    approved: result.approved,
    reasoning: result.cap_reasoning
  };
}
