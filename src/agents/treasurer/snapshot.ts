/**
 * Real TreasurerSnapshot — everything derived from the append-only ledger and
 * bets table on every call. Nothing cached, nothing seeded.
 * Signature preserved from the Phase 3 stub (the contract), fields extended.
 */
import { and, asc, eq, gte, isNotNull } from 'drizzle-orm';
import { db } from '../../db/index';
import { bankroll_ledger, bets } from '../../db/schema';
import { BASE_KELLY_FRACTION } from '../../shared/utils/kelly';
import { operatorDayStartUtc } from '../../api/status';
import { evaluateStopLossState, type StopLossLevel } from './stop_loss';

export type CLVClassification = 'sharp' | 'marginal' | 'break_even' | 'below_replacement';

export interface TreasurerSnapshot {
  // --- Phase 3 stub contract (unchanged) ---
  active_bankroll_cents: bigint;
  available_capital_cents: bigint;
  stop_loss_active: StopLossLevel;
  todays_bet_count: number;
  daily_bet_cap: number;
  current_kelly_fraction: number;
  // --- Phase 4 extensions ---
  total_capital_cents: bigint;
  pending_wagers_cents: bigint;
  peak_bankroll_cents: bigint;
  peak_reached_at: string | null;
  drawdown_pct_from_peak: number;
  stop_loss_reason: string | null;
  stop_loss_resumes_at: string | null;
  todays_bets_by_match: Map<string, number>;
  daily_bet_cap_effective: number;
  this_week_clv_cents: number;
  rolling_30d_clv_cents: number;
  clv_classification: CLVClassification;
}

export interface LedgerStats {
  current_cents: bigint;
  peak_cents: bigint;
  peak_reached_at: Date | null;
  drawdown_pct: number;
}

export async function computeLedgerStats(): Promise<LedgerStats> {
  const entries = await db
    .select({
      balance: bankroll_ledger.balance_after_cents,
      occurred_at: bankroll_ledger.occurred_at
    })
    .from(bankroll_ledger)
    .orderBy(asc(bankroll_ledger.occurred_at), asc(bankroll_ledger.created_at));

  if (entries.length === 0) {
    throw new Error('Bankroll ledger is empty — Phase 0 should have initialized this');
  }

  const current = entries[entries.length - 1].balance;
  let peak = 0n;
  let peakReachedAt: Date | null = null;
  for (const entry of entries) {
    if (entry.balance > peak) {
      peak = entry.balance;
      peakReachedAt = entry.occurred_at;
    }
  }
  const drawdown = peak > 0n && current < peak
    ? Number(((peak - current) * 10000n) / peak) / 100
    : 0;

  return { current_cents: current, peak_cents: peak, peak_reached_at: peakReachedAt, drawdown_pct: drawdown };
}

export function classifyCLV(rolling30d: number): CLVClassification {
  if (rolling30d >= 0.5) return 'sharp';
  if (rolling30d >= 0.0) return 'marginal';
  if (rolling30d >= -0.5) return 'break_even';
  return 'below_replacement';
}

async function computeRollingCLV(): Promise<{ week: number; rolling30d: number }> {
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const settled = await db
    .select({ clv: bets.clv_cents, settled_at: bets.settled_at })
    .from(bets)
    .where(and(
      eq(bets.settlement_status, 'settled'),
      isNotNull(bets.clv_cents),
      gte(bets.settled_at, monthAgo)
    ));

  const avg = (rows: typeof settled): number =>
    rows.length > 0 ? rows.reduce((s, b) => s + Number(b.clv ?? 0), 0) / rows.length : 0;

  return {
    week: avg(settled.filter((b) => b.settled_at !== null && b.settled_at >= weekAgo)),
    rolling30d: avg(settled)
  };
}

export async function getTreasurerSnapshot(knockoutStage: boolean): Promise<TreasurerSnapshot> {
  const [ledger, clv, todays, pending] = await Promise.all([
    computeLedgerStats(),
    computeRollingCLV(),
    db.select({ id: bets.id, match_id: bets.match_id })
      .from(bets)
      .where(gte(bets.placed_at, operatorDayStartUtc())),
    db.select({ stake: bets.stake_cents })
      .from(bets)
      .where(eq(bets.settlement_status, 'pending'))
  ]);

  const stopLoss = evaluateStopLossState(ledger.current_cents, ledger.peak_cents);

  const byMatch = new Map<string, number>();
  for (const bet of todays) byMatch.set(bet.match_id, (byMatch.get(bet.match_id) ?? 0) + 1);

  const pendingCents = pending.reduce((s, b) => s + b.stake, 0n);
  const baseCap = knockoutStage ? 3 : 5;

  return {
    active_bankroll_cents: ledger.current_cents,
    available_capital_cents: ledger.current_cents,
    stop_loss_active: stopLoss.level,
    todays_bet_count: todays.length,
    daily_bet_cap: baseCap,
    current_kelly_fraction: BASE_KELLY_FRACTION * stopLoss.kelly_modifier,

    total_capital_cents: ledger.current_cents + pendingCents,
    pending_wagers_cents: pendingCents,
    peak_bankroll_cents: ledger.peak_cents,
    peak_reached_at: ledger.peak_reached_at?.toISOString() ?? null,
    drawdown_pct_from_peak: ledger.drawdown_pct,
    stop_loss_reason: stopLoss.reason,
    stop_loss_resumes_at: stopLoss.resumes_at,
    todays_bets_by_match: byMatch,
    daily_bet_cap_effective: stopLoss.daily_cap_override ?? baseCap,
    this_week_clv_cents: clv.week,
    rolling_30d_clv_cents: clv.rolling30d,
    clv_classification: classifyCLV(clv.rolling30d)
  };
}
