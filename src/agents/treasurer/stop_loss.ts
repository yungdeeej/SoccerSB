/**
 * Stop-loss state machine — pure function of (current, peak) drawdown.
 * Thresholds tighter than NHL: reduced at 12%, halt at 20% (5-week tournament).
 */

export type StopLossLevel = 'none' | 'reduced_kelly' | 'halt';

export interface StopLossState {
  level: StopLossLevel;
  reason: string | null;
  action: string | null;
  resumes_at: string | null;
  kelly_modifier: number;
  daily_cap_override: number | null;
}

const NONE: StopLossState = {
  level: 'none', reason: null, action: null, resumes_at: null,
  kelly_modifier: 1.0, daily_cap_override: null
};

export const REDUCED_DRAWDOWN_PCT = 12;
export const HALT_DRAWDOWN_PCT = 20;

export function drawdownPct(currentCents: bigint, peakCents: bigint): number {
  if (peakCents <= 0n || currentCents >= peakCents) return 0;
  return Number(((peakCents - currentCents) * 10000n) / peakCents) / 100;
}

export function evaluateStopLossState(currentCents: bigint, peakCents: bigint): StopLossState {
  const dd = drawdownPct(currentCents, peakCents);
  if (dd === 0) return NONE;

  if (dd >= HALT_DRAWDOWN_PCT) {
    return {
      level: 'halt',
      reason: `Bankroll down ${dd.toFixed(1)}% from peak`,
      action: 'No new bets. Manual resume required via Telegram (/treasurer resume).',
      resumes_at: null,
      kelly_modifier: 0,
      daily_cap_override: 0
    };
  }

  if (dd >= REDUCED_DRAWDOWN_PCT) {
    const resumesAt = new Date();
    resumesAt.setDate(resumesAt.getDate() + 7);
    return {
      level: 'reduced_kelly',
      reason: `Bankroll down ${dd.toFixed(1)}%. Half-Kelly active 7 days.`,
      action: 'Half-Kelly sizing. Daily cap reduced to 3.',
      resumes_at: resumesAt.toISOString(),
      kelly_modifier: 0.5,
      daily_cap_override: 3
    };
  }

  return NONE;
}
