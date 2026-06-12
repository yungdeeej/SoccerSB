/**
 * Intra-day cooldown rules (06_AGENT_TREASURER.md):
 *  - 2 consecutive losses → 30min pause
 *  - 3 losses today → capped to current count
 *  - down >5% today → cap to current count + 1
 * Pure core (evaluateCooldownFromBets) + DB wrapper.
 */
import { and, eq, gte, lt } from 'drizzle-orm';
import { db } from '../../db/index';
import { bankroll_ledger, bets } from '../../db/schema';
import { operatorDayStartUtc } from '../../api/status';

export interface CooldownState {
  active: boolean;
  reason: string | null;
  remaining_minutes: number | null;
  effective_cap_today: number | null;
}

export interface SettledBetLike {
  outcome: string | null;
  settled_at: Date | null;
}

const INACTIVE: CooldownState = { active: false, reason: null, remaining_minutes: null, effective_cap_today: null };

export function evaluateCooldownFromBets(
  todaysSettled: SettledBetLike[],
  todaysPlacedCount: number,
  dayStartBankrollCents: bigint | null,
  currentBankrollCents: bigint,
  now: Date = new Date()
): CooldownState {
  const settled = todaysSettled
    .filter((b) => b.settled_at !== null)
    .sort((a, b) => (b.settled_at as Date).getTime() - (a.settled_at as Date).getTime());

  // 2 consecutive (most recent) losses → 30min pause
  const lastTwo = settled.slice(0, 2);
  if (lastTwo.length === 2 && lastTwo.every((b) => b.outcome === 'loss' || b.outcome === 'half_loss')) {
    const minutesSince = (now.getTime() - (lastTwo[0].settled_at as Date).getTime()) / 60_000;
    if (minutesSince < 30) {
      return {
        active: true,
        reason: 'Two consecutive losses — 30min cooldown',
        remaining_minutes: Math.ceil(30 - minutesSince),
        effective_cap_today: null
      };
    }
  }

  // 3 losses today → no more bets today
  const losses = settled.filter((b) => b.outcome === 'loss').length;
  if (losses >= 3) {
    return {
      active: true,
      reason: '3 losses today — capped to current count',
      remaining_minutes: null,
      effective_cap_today: todaysPlacedCount
    };
  }

  // Down >5% today → one more shot, then done
  if (dayStartBankrollCents !== null && dayStartBankrollCents > 0n && currentBankrollCents < dayStartBankrollCents) {
    const ddPct = Number(((dayStartBankrollCents - currentBankrollCents) * 10000n) / dayStartBankrollCents) / 100;
    if (ddPct > 5) {
      return {
        active: true,
        reason: `Down ${ddPct.toFixed(1)}% today — one more shot then done`,
        remaining_minutes: null,
        effective_cap_today: todaysPlacedCount + 1
      };
    }
  }

  return INACTIVE;
}

export async function getBankrollAtStartOfDay(): Promise<bigint | null> {
  const dayStart = operatorDayStartUtc();
  const rows = await db
    .select({ balance: bankroll_ledger.balance_after_cents, occurred_at: bankroll_ledger.occurred_at })
    .from(bankroll_ledger)
    .where(lt(bankroll_ledger.occurred_at, dayStart))
    .orderBy(bankroll_ledger.occurred_at);
  return rows.length > 0 ? rows[rows.length - 1].balance : null;
}

export async function evaluateCooldown(currentBankrollCents: bigint): Promise<CooldownState> {
  const dayStart = operatorDayStartUtc();
  const todays = await db
    .select({
      outcome: bets.outcome,
      settled_at: bets.settled_at,
      placed_at: bets.placed_at,
      settlement_status: bets.settlement_status
    })
    .from(bets)
    .where(gte(bets.placed_at, dayStart));

  // Also count bets settled today regardless of placement day
  const settledToday = await db
    .select({ outcome: bets.outcome, settled_at: bets.settled_at })
    .from(bets)
    .where(and(eq(bets.settlement_status, 'settled'), gte(bets.settled_at, dayStart)));

  return evaluateCooldownFromBets(
    settledToday,
    todays.length,
    await getBankrollAtStartOfDay(),
    currentBankrollCents
  );
}
