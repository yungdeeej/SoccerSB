/**
 * Daily morning report (8am MT) + compound/withdraw prompt.
 * Honesty over comfort: the report states the truth plainly.
 */
import { and, desc, eq, gte, isNull, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/index';
import { agent_runs, bankroll_ledger, bets, matches, teams, verdicts } from '../../db/schema';
import { sendTelegramMessage } from '../../notify/telegram';
import { operatorDayStartUtc } from '../../api/status';
import { logAgentRun } from '../wolfman/agent_log';
import { getTreasurerSnapshot } from './snapshot';

const money = (cents: bigint | number): string => {
  const n = typeof cents === 'bigint' ? Number(cents) : cents;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n / 100).toFixed(2)}`;
};

async function balanceAt(when: Date): Promise<bigint | null> {
  const rows = await db
    .select({ balance: bankroll_ledger.balance_after_cents })
    .from(bankroll_ledger)
    .where(lt(bankroll_ledger.occurred_at, when))
    .orderBy(desc(bankroll_ledger.occurred_at))
    .limit(1);
  return rows[0]?.balance ?? null;
}

export async function generateDailyReport(): Promise<string> {
  const snapshot = await getTreasurerSnapshot(false);
  const now = new Date();
  const dayStart = operatorDayStartUtc(now);
  const yesterdayStart = new Date(dayStart.getTime() - 24 * 3600 * 1000);

  const yesterdayBets = await db.select().from(bets)
    .where(and(gte(bets.placed_at, yesterdayStart), lt(bets.placed_at, dayStart)));
  const settled = yesterdayBets.filter((b) => b.settlement_status === 'settled');

  const allSettled = await db.select().from(bets).where(eq(bets.settlement_status, 'settled'));
  const record = {
    w: allSettled.filter((b) => b.outcome === 'win' || b.outcome === 'half_win').length,
    l: allSettled.filter((b) => b.outcome === 'loss' || b.outcome === 'half_loss').length,
    p: allSettled.filter((b) => b.outcome === 'push' || b.outcome === 'void').length
  };
  const tournamentPL = allSettled.reduce((s, b) => s + (b.pl_cents ?? 0n), 0n);

  const bal24h = await balanceAt(new Date(now.getTime() - 24 * 3600 * 1000));
  const bal7d = await balanceAt(new Date(now.getTime() - 7 * 24 * 3600 * 1000));
  const current = snapshot.active_bankroll_cents;

  const yesterdayPL = settled.reduce((s, b) => s + (b.pl_cents ?? 0n), 0n);
  const yesterdayStaked = yesterdayBets.reduce((s, b) => s + b.stake_cents, 0n);
  const clvBets = settled.filter((b) => b.clv_cents !== null);
  const avgCLV = clvBets.length > 0
    ? clvBets.reduce((s, b) => s + Number(b.clv_cents), 0) / clvBets.length
    : null;

  // Today's slate + active strikes
  const home = alias(teams, 'rh');
  const away = alias(teams, 'ra');
  const todayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
  const todays = await db
    .select({
      id: matches.id, kickoff: matches.scheduled_kickoff_utc,
      home: home.short_name, away: away.short_name
    })
    .from(matches)
    .innerJoin(home, eq(matches.home_team_id, home.id))
    .innerJoin(away, eq(matches.away_team_id, away.id))
    .where(and(gte(matches.scheduled_kickoff_utc, dayStart), lt(matches.scheduled_kickoff_utc, todayEnd)));

  const strikes = await db
    .select({ match_id: verdicts.match_id })
    .from(verdicts)
    .where(and(eq(verdicts.decision, 'STRIKE'), isNull(verdicts.superseded_by), gte(verdicts.expires_at, now)));
  const strikesByMatch = new Map<string, number>();
  for (const s of strikes) strikesByMatch.set(s.match_id, (strikesByMatch.get(s.match_id) ?? 0) + 1);

  const stateWarning =
    snapshot.stop_loss_active === 'halt'
      ? '🛑 STOP-LOSS HALT ACTIVE — all new bets blocked. /treasurer resume after review.\n\n'
      : snapshot.stop_loss_active === 'reduced_kelly'
        ? '⚠️ REDUCED KELLY ACTIVE — half sizing, cap 3/day.\n\n'
        : '';

  const lines = [
    `📊 DAILY TREASURER REPORT — ${now.toLocaleDateString('en-US', { timeZone: 'America/Edmonton', month: 'long', day: 'numeric', year: 'numeric' })}`,
    '',
    stateWarning + 'BANKROLL',
    `Current: ${money(current)}`,
    bal24h !== null ? `24h change: ${money(current - bal24h)}` : '24h change: n/a',
    bal7d !== null ? `7d change: ${money(current - bal7d)}` : '7d change: n/a',
    `From peak: -${snapshot.drawdown_pct_from_peak.toFixed(1)}% (peak ${money(snapshot.peak_bankroll_cents)})`,
    '',
    'YESTERDAY',
    `Bets: ${yesterdayBets.length} placed, ${settled.length} settled`,
    `Staked: ${money(yesterdayStaked)}`,
    `Net P&L: ${money(yesterdayPL)}`,
    avgCLV !== null ? `Avg CLV: ${avgCLV >= 0 ? '+' : ''}${avgCLV.toFixed(1)}¢` : 'Avg CLV: n/a (no closing lines)',
    '',
    'TOURNAMENT TO DATE',
    `Record: ${record.w}W-${record.l}L-${record.p}P`,
    `P&L: ${money(tournamentPL)}`,
    `Rolling 30d CLV: ${snapshot.rolling_30d_clv_cents >= 0 ? '+' : ''}${snapshot.rolling_30d_clv_cents.toFixed(1)}¢ (${snapshot.clv_classification})`,
    '',
    'STATE',
    `Stop-loss: ${snapshot.stop_loss_active.toUpperCase()}`,
    `Kelly fraction: ${snapshot.current_kelly_fraction}`,
    `Daily cap: ${snapshot.daily_bet_cap_effective}`,
    '',
    "TODAY'S MATCHES",
    ...(todays.length > 0
      ? todays.map((m) => {
          const k = m.kickoff.toLocaleTimeString('en-US', { timeZone: 'America/Edmonton', hour: 'numeric', minute: '2-digit' });
          const n = strikesByMatch.get(m.id) ?? 0;
          return `• ${m.away} @ ${m.home} (${k} MT)${n > 0 ? ` — ${n} STRIKE active` : ''}`;
        })
      : ['• none scheduled']),
    '',
    snapshot.stop_loss_active === 'none' ? '✅ System healthy. Continue with discipline.' : '⚠️ Review state before betting.'
  ];

  return lines.join('\n');
}

export async function sendDailyReport(): Promise<void> {
  const started = Date.now();
  try {
    const text = await generateDailyReport();
    await sendTelegramMessage(text);
    await logAgentRun({
      agent: 'treasurer', run_phase: 'daily_report', status: 'success',
      duration_ms: Date.now() - started, outputs_summary: { sent: true }
    });
  } catch (err) {
    await logAgentRun({
      agent: 'treasurer', run_phase: 'daily_report', status: 'failed_recoverable',
      duration_ms: Date.now() - started, error: err
    });
  }
}

// ---------------------------------------------------------------------------
// Compound / withdraw prompt (+20% from baseline, re-prompt every 14 days)
// ---------------------------------------------------------------------------

export const BASELINE_NOTE_PREFIX = 'baseline:';

export async function getCurrentBaseline(): Promise<bigint | null> {
  // Latest explicit baseline marker, else the first deposit
  const rows = await db
    .select({ notes: bankroll_ledger.notes, balance: bankroll_ledger.balance_after_cents, amount: bankroll_ledger.amount_cents, type: bankroll_ledger.entry_type })
    .from(bankroll_ledger)
    .orderBy(desc(bankroll_ledger.occurred_at));
  for (const row of rows) {
    if (row.notes?.startsWith(BASELINE_NOTE_PREFIX)) return row.balance;
  }
  const deposits = rows.filter((r) => r.type === 'deposit');
  return deposits.length > 0 ? deposits[deposits.length - 1].balance : null;
}

export function compoundGainPct(current: bigint, baseline: bigint): number {
  if (baseline <= 0n) return 0;
  return Number(((current - baseline) * 10000n) / baseline) / 100;
}

export async function checkCompoundWithdrawTrigger(): Promise<void> {
  const baseline = await getCurrentBaseline();
  if (baseline === null) return;

  const snapshot = await getTreasurerSnapshot(false);
  const gainPct = compoundGainPct(snapshot.active_bankroll_cents, baseline);
  if (gainPct < 20) return;

  // Re-prompt at most every 14 days
  const [lastPrompt] = await db
    .select({ ran_at: agent_runs.ran_at })
    .from(agent_runs)
    .where(and(eq(agent_runs.agent, 'treasurer'), eq(agent_runs.run_phase, 'compound_prompt')))
    .orderBy(desc(agent_runs.ran_at))
    .limit(1);
  if (lastPrompt && Date.now() - lastPrompt.ran_at.getTime() < 14 * 24 * 3600 * 1000) return;

  await sendTelegramMessage(
    `💰 BANKROLL +${gainPct.toFixed(1)}% FROM BASELINE\n\n` +
    `Current: ${money(snapshot.active_bankroll_cents)}\nBaseline: ${money(baseline)}\n` +
    `Gain: +${money(snapshot.active_bankroll_cents - baseline)}\n\n` +
    `Decision time. Three options:\n` +
    `1. /treasurer compound — set new baseline at current bankroll\n` +
    `2. /treasurer withdraw [amount] — withdraw, keep rest in play\n` +
    `3. /treasurer continue — defer (re-prompt in 14 days)\n\n` +
    `Per Walters: take profits when the math says you should.`
  );
  await logAgentRun({
    agent: 'treasurer', run_phase: 'compound_prompt', status: 'success', duration_ms: 0,
    outputs_summary: { gain_pct: gainPct, baseline_cents: Number(baseline) }
  });
}
