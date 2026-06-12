/**
 * System status aggregation — shared by the dashboard footer and Telegram /status.
 */
import { and, desc, eq, gte, isNull, sql as rawSql } from 'drizzle-orm';
import { db } from '../db/index';
import { agent_runs, bets, verdicts } from '../db/schema';
import { getCurrentBalanceCents } from '../shared/ledger';
import { getQuotaState } from '../agents/wolfman/poll';

export interface SystemStatus {
  bankroll_cents: number;
  todays_bet_count: number;
  daily_bet_cap: number;
  last_odds_sync: string | null;
  last_fixtures_sync: string | null;
  api_credits_remaining: number | null;
  reduced_polling: boolean;
  active_strikes: number;
  llm_cost_today_usd: number;
}

async function lastRun(phase: string): Promise<string | null> {
  const [row] = await db
    .select({ ran_at: agent_runs.ran_at })
    .from(agent_runs)
    .where(and(eq(agent_runs.run_phase, phase), eq(agent_runs.status, 'success')))
    .orderBy(desc(agent_runs.ran_at))
    .limit(1);
  return row?.ran_at.toISOString() ?? null;
}

/** Start of "today" in the operator's timezone (MT), as a UTC Date. */
export function operatorDayStartUtc(now = new Date()): Date {
  const tz = process.env.OPERATOR_TIMEZONE ?? 'America/Edmonton';
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  // Local wall-clock time → ms since local midnight → subtract from now
  const msSinceMidnight =
    Number(parts.hour) * 3600_000 + Number(parts.minute) * 60_000 + Number(parts.second) * 1000;
  return new Date(now.getTime() - msSinceMidnight);
}

export async function getSystemStatus(): Promise<SystemStatus> {
  const balance = await getCurrentBalanceCents();

  const dayStart = operatorDayStartUtc();
  const todaysBets = await db
    .select({ id: bets.id })
    .from(bets)
    .where(gte(bets.placed_at, dayStart));

  const quota = getQuotaState();

  // Active STRIKEs (not superseded, not expired)
  const strikes = await db
    .select({ id: verdicts.id })
    .from(verdicts)
    .where(and(
      eq(verdicts.decision, 'STRIKE'),
      isNull(verdicts.superseded_by),
      gte(verdicts.expires_at, new Date())
    ));

  // Today's LLM spend from agent_runs outputs_summary
  const [llmCost] = await db
    .select({
      total: rawSql<string>`COALESCE(SUM((outputs_summary->>'llm_cost_usd')::numeric), 0)`
    })
    .from(agent_runs)
    .where(gte(agent_runs.ran_at, dayStart));

  return {
    bankroll_cents: Number(balance),
    todays_bet_count: todaysBets.length,
    daily_bet_cap: 5,  // group stage cap; enforcement is Phase 4 (Treasurer)
    last_odds_sync: await lastRun('odds_poll'),
    last_fixtures_sync: await lastRun('fixtures_sync'),
    api_credits_remaining: quota.creditsRemaining,
    reduced_polling: quota.reducedMode,
    active_strikes: strikes.length,
    llm_cost_today_usd: Number(llmCost?.total ?? 0)
  };
}

export function formatStatusForTelegram(s: SystemStatus): string {
  const money = (c: number): string => `$${(c / 100).toFixed(2)}`;
  return [
    'THE PITCH — STATUS',
    `Bankroll: ${money(s.bankroll_cents)}`,
    `Today's bets: ${s.todays_bet_count}/${s.daily_bet_cap}`,
    `Last odds sync: ${s.last_odds_sync ?? 'never'}`,
    `Last fixtures sync: ${s.last_fixtures_sync ?? 'never'}`,
    `API credits remaining: ${s.api_credits_remaining ?? 'unknown'}${s.reduced_polling ? ' (REDUCED POLLING)' : ''}`
  ].join('\n');
}
