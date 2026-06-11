/**
 * Odds polling — adaptive cadence per 04_AGENT_WOLFMAN.md.
 *
 * A 2-minute scheduler tick decides which matches are due; one batched
 * API call covers every World Cup match, and snapshots are written
 * (append-only) for all due matches. Closing line captured at T-90s.
 * Quota guards: <50 credits → reduced cadence; <25 → Telegram alert.
 */
import { and, eq, gte, lte } from 'drizzle-orm';
import { db } from '../../db/index';
import { matches, odds_snapshots } from '../../db/schema';
import { fetchWorldCupOdds, OddsApiError, type OddsEvent } from './odds_api';
import { placeholderMatchId } from './stage';
import { parseEventSnapshots, pollIntervalMs, isClosingWindow } from './snapshots';
import { logAgentRun } from './agent_log';
import { sendTelegramMessage } from '../../notify/telegram';

const REDUCED_MODE_THRESHOLD = 50;
const ALERT_THRESHOLD = 25;

interface PollerState {
  lastPolledAt: Map<string, number>;       // match_id → epoch ms
  closingCaptured: Set<string>;            // match_ids with closing snapshot
  creditsRemaining: number | null;
  lastQuotaAlertAt: number | null;
}

const state: PollerState = {
  lastPolledAt: new Map(),
  closingCaptured: new Set(),
  creditsRemaining: null,
  lastQuotaAlertAt: null
};

export function getQuotaState(): { creditsRemaining: number | null; reducedMode: boolean } {
  return {
    creditsRemaining: state.creditsRemaining,
    reducedMode: state.creditsRemaining !== null && state.creditsRemaining < REDUCED_MODE_THRESHOLD
  };
}

/** Matches kicking off within the next 7 days or the last 3 hours. */
async function getActiveMatches(): Promise<Array<{ id: string; fifa_match_id: number; kickoff: Date; status: string }>> {
  const now = Date.now();
  const rows = await db
    .select({
      id: matches.id,
      fifa_match_id: matches.fifa_match_id,
      kickoff: matches.scheduled_kickoff_utc,
      status: matches.status
    })
    .from(matches)
    .where(and(
      gte(matches.scheduled_kickoff_utc, new Date(now - 3 * 60 * 60 * 1000)),
      lte(matches.scheduled_kickoff_utc, new Date(now + 7 * 24 * 60 * 60 * 1000))
    ));
  return rows;
}

/** Flip scheduled → live → finished based on clock (manual settlement remains operator's job). */
async function updateMatchStatuses(): Promise<void> {
  const now = Date.now();
  const active = await getActiveMatches();
  for (const m of active) {
    const kickoff = m.kickoff.getTime();
    let next: string | null = null;
    if (m.status === 'scheduled' && now >= kickoff) next = 'live';
    if ((m.status === 'live' || m.status === 'scheduled') && now >= kickoff + 2.25 * 60 * 60 * 1000) next = 'finished';
    if (next && next !== m.status) {
      await db.update(matches).set({ status: next, updated_at: new Date() }).where(eq(matches.id, m.id));
    }
  }
}

export interface PollResult {
  polled_matches: number;
  snapshots_written: number;
  credits_remaining: number | null;
  skipped: boolean;
}

/**
 * One scheduler tick. `force` polls every active match regardless of cadence
 * (used by the dashboard RUN POLL button).
 */
export async function pollTick(force = false): Promise<PollResult> {
  const started = Date.now();
  try {
    await updateMatchStatuses();

    const active = await getActiveMatches();
    if (active.length === 0) {
      return { polled_matches: 0, snapshots_written: 0, credits_remaining: state.creditsRemaining, skipped: true };
    }

    const reduced = getQuotaState().reducedMode;
    const now = Date.now();

    const due = active.filter((m) => {
      if (force) return true;
      const msToKickoff = m.kickoff.getTime() - now;
      const interval = pollIntervalMs(msToKickoff, reduced);
      if (interval === null) return false;
      // Closing window always polls (once)
      if (isClosingWindow(msToKickoff) && !state.closingCaptured.has(m.id)) return true;
      const last = state.lastPolledAt.get(m.id) ?? 0;
      return now - last >= interval;
    });

    if (due.length === 0) {
      return { polled_matches: 0, snapshots_written: 0, credits_remaining: state.creditsRemaining, skipped: true };
    }

    // One batched call covers all WC matches
    const { events, creditsRemaining, creditsUsed } = await fetchWorldCupOdds();
    state.creditsRemaining = creditsRemaining;

    const eventByPlaceholder = new Map<number, OddsEvent>();
    for (const e of events) eventByPlaceholder.set(placeholderMatchId(e.id), e);

    let written = 0;
    for (const match of due) {
      const event = eventByPlaceholder.get(match.fifa_match_id);
      if (!event) continue;  // match no longer offered (started/finished)

      const msToKickoff = match.kickoff.getTime() - now;
      const closing = isClosingWindow(msToKickoff) && !state.closingCaptured.has(match.id);

      const rows = parseEventSnapshots(event, match.id, closing);
      if (rows.length > 0) {
        await db.insert(odds_snapshots).values(rows);
        written += rows.length;
      }
      state.lastPolledAt.set(match.id, now);
      if (closing) state.closingCaptured.add(match.id);
    }

    await maybeAlertQuota(creditsRemaining);

    await logAgentRun({
      agent: 'wolfman',
      run_phase: 'odds_poll',
      status: 'success',
      duration_ms: Date.now() - started,
      outputs_summary: {
        polled_matches: due.length,
        snapshots_written: written,
        api_credits_used: creditsUsed,
        api_credits_remaining: creditsRemaining,
        reduced_mode: reduced,
        forced: force
      }
    });

    return { polled_matches: due.length, snapshots_written: written, credits_remaining: creditsRemaining, skipped: false };
  } catch (err) {
    const recoverable = err instanceof OddsApiError && err.statusCode !== 401;
    await logAgentRun({
      agent: 'wolfman',
      run_phase: 'odds_poll',
      status: recoverable ? 'failed_recoverable' : 'failed_fatal',
      duration_ms: Date.now() - started,
      error: err
    });
    throw err;
  }
}

async function maybeAlertQuota(remaining: number | null): Promise<void> {
  if (remaining === null || remaining >= ALERT_THRESHOLD) return;
  const now = Date.now();
  // At most one alert per 6h
  if (state.lastQuotaAlertAt !== null && now - state.lastQuotaAlertAt < 6 * 60 * 60 * 1000) return;
  state.lastQuotaAlertAt = now;
  await sendTelegramMessage(
    `[CRITICAL] ODDS API QUOTA LOW\n${remaining} credits remaining this month.\nPolling already in reduced mode. Consider upgrading tier.`
  );
}

let schedulerHandle: ReturnType<typeof setInterval> | null = null;

/** Start the 2-minute scheduler. No-op if already running or no API key. */
export function startPollingScheduler(): void {
  if (schedulerHandle) return;
  if (!process.env.ODDS_API_KEY) {
    console.warn('poll: ODDS_API_KEY not set — polling scheduler disabled');
    return;
  }
  schedulerHandle = setInterval(() => {
    pollTick().catch((err) => console.error('poll tick failed:', err));
  }, 2 * 60 * 1000);
  // immediate first tick
  pollTick().catch((err) => console.error('initial poll failed:', err));
  console.log('poll: scheduler started (2-minute tick, adaptive cadence)');
}

export function stopPollingScheduler(): void {
  if (schedulerHandle) {
    clearInterval(schedulerHandle);
    schedulerHandle = null;
  }
}
