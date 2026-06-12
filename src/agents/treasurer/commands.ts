/**
 * Operator Telegram commands: /treasurer resume|compound|withdraw|continue|state
 * All writes are append-only ledger rows. Auth happens in the Telegram loop.
 */
import { db } from '../../db/index';
import { bankroll_ledger } from '../../db/schema';
import { logAgentRun } from '../wolfman/agent_log';
import { BASELINE_NOTE_PREFIX, getCurrentBaseline, compoundGainPct } from './daily_report';
import { getTreasurerSnapshot } from './snapshot';

const money = (cents: bigint): string => `$${(Number(cents) / 100).toFixed(2)}`;

export async function handleTreasurerCommand(args: string[]): Promise<string> {
  const sub = args[0]?.toLowerCase() ?? 'state';

  if (sub === 'state') {
    const s = await getTreasurerSnapshot(false);
    const baseline = await getCurrentBaseline();
    return [
      'TREASURER STATE',
      `Bankroll: ${money(s.active_bankroll_cents)} (peak ${money(s.peak_bankroll_cents)}, drawdown ${s.drawdown_pct_from_peak.toFixed(1)}%)`,
      `Pending wagers: ${money(s.pending_wagers_cents)}`,
      `Stop-loss: ${s.stop_loss_active.toUpperCase()}${s.stop_loss_reason ? ` — ${s.stop_loss_reason}` : ''}`,
      `Kelly fraction: ${s.current_kelly_fraction}`,
      `Today's bets: ${s.todays_bet_count}/${s.daily_bet_cap_effective}`,
      `Rolling 30d CLV: ${s.rolling_30d_clv_cents >= 0 ? '+' : ''}${s.rolling_30d_clv_cents.toFixed(1)}¢ (${s.clv_classification})`,
      baseline !== null
        ? `Baseline: ${money(baseline)} (${compoundGainPct(s.active_bankroll_cents, baseline) >= 0 ? '+' : ''}${compoundGainPct(s.active_bankroll_cents, baseline).toFixed(1)}%)`
        : 'Baseline: not set (no deposits yet)'
    ].join('\n');
  }

  if (sub === 'resume') {
    const s = await getTreasurerSnapshot(false);
    if (s.stop_loss_active !== 'halt') {
      return `Halt not active (current state: ${s.stop_loss_active}). Nothing to resume.`;
    }
    await db.insert(bankroll_ledger).values({
      entry_type: 'adjustment',
      amount_cents: 0n,
      balance_after_cents: s.active_bankroll_cents,
      notes: 'Stop-loss halt manually resumed by operator',
      source: 'manual',
      stop_loss_state_at_entry: 'halt'
    });
    await logAgentRun({
      agent: 'treasurer', run_phase: 'halt_resume', status: 'success', duration_ms: 0,
      outputs_summary: { drawdown_pct: s.drawdown_pct_from_peak }
    });
    return 'Halt resume acknowledged and logged. The state machine re-evaluates from live drawdown — ' +
      `currently ${s.drawdown_pct_from_peak.toFixed(1)}%. Halt re-triggers while drawdown ≥ 20%; ` +
      'recovery requires a deposit or settled wins.';
  }

  if (sub === 'compound') {
    const s = await getTreasurerSnapshot(false);
    await db.insert(bankroll_ledger).values({
      entry_type: 'adjustment',
      amount_cents: 0n,
      balance_after_cents: s.active_bankroll_cents,
      notes: `${BASELINE_NOTE_PREFIX} reset to ${money(s.active_bankroll_cents)} by operator`,
      source: 'manual'
    });
    return `New baseline set at ${money(s.active_bankroll_cents)}. Compounding from here.`;
  }

  if (sub === 'withdraw') {
    const dollars = parseFloat(args[1] ?? '');
    if (!Number.isFinite(dollars) || dollars <= 0) {
      return 'Usage: /treasurer withdraw <amount> (e.g., /treasurer withdraw 500)';
    }
    const cents = BigInt(Math.round(dollars * 100));
    const s = await getTreasurerSnapshot(false);
    if (cents > s.active_bankroll_cents) {
      return `Cannot withdraw ${money(cents)} — bankroll is ${money(s.active_bankroll_cents)}.`;
    }
    const after = s.active_bankroll_cents - cents;
    await db.insert(bankroll_ledger).values({
      entry_type: 'withdrawal',
      amount_cents: -cents,
      balance_after_cents: after,
      notes: 'Operator withdrawal via Telegram',
      source: 'manual'
    });
    return `Withdrawal of ${money(cents)} recorded. Bankroll: ${money(after)}.`;
  }

  if (sub === 'continue') {
    await logAgentRun({
      agent: 'treasurer', run_phase: 'compound_prompt', status: 'success', duration_ms: 0,
      outputs_summary: { decision: 'deferred_by_operator' }
    });
    return 'Decision deferred. Will re-prompt in 14 days if still +20% from baseline.';
  }

  return 'Unknown subcommand. Use: /treasurer state | resume | compound | withdraw <amt> | continue';
}
