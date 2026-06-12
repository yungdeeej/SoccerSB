import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { healthHandler } from './health';
import { apiRouter } from './routes';
import { startPollingScheduler } from '../agents/wolfman/poll';
import { syncFixtures } from '../agents/wolfman/fixtures';
import { startTelegramCommandLoop } from '../notify/telegram';
import { getSystemStatus, formatStatusForTelegram } from './status';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => { void healthHandler(req, res); });
app.use(apiRouter);

// Pages
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));
app.get('/matches/:id', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'match.html')));
app.get('/bets', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'bets.html')));
app.get('/verdicts/:id', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'verdict.html')));
app.get('/treasurer', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'treasurer.html')));

const port = Number(process.env.PORT ?? 3000);

// 0.0.0.0: required for Replit/containers to route external traffic
app.listen(port, '0.0.0.0', () => {
  console.log(`The Pitch — terminal on 0.0.0.0:${port} (${process.env.SYSTEM_ENV ?? 'development'})`);

  // Live data layers — degrade gracefully without ODDS_API_KEY
  if (process.env.ODDS_API_KEY) {
    syncFixtures()
      .then((r) => console.log(`fixtures: ${r.matches_inserted} inserted, ${r.matches_updated} updated`))
      .catch((err) => console.error('fixtures sync failed:', err));
    startPollingScheduler();
    scheduleDailyFixtureSync();
  } else {
    console.warn('ODDS_API_KEY not set — fixtures + odds polling disabled until configured');
  }

  startTelegramCommandLoop({
    '/status': async () => formatStatusForTelegram(await getSystemStatus()),
    '/treasurer': async (args) => {
      const { handleTreasurerCommand } = await import('../agents/treasurer/index');
      return handleTreasurerCommand(args);
    }
  });

  scheduleQuantJobs();
  scheduleTacticianJobs();
  scheduleTreasurerJobs();
  void bootstrapFreshDatabase();
});

/**
 * Fresh-deploy bootstrap (e.g. first boot against a new Neon database):
 * if teams lack Elo ratings, pull them now instead of waiting for the 3am
 * cron; if no passing backtest-gate row exists, run the gate once so model
 * predictions can display. Retries while the Quant service finishes booting.
 */
async function bootstrapFreshDatabase(): Promise<void> {
  const { quantClient } = await import('../agents/orchestrator/quant_client');

  let health = null;
  for (let attempt = 0; attempt < 12 && !health; attempt++) {
    health = await quantClient.checkHealth();
    if (!health) await new Promise((r) => setTimeout(r, 5000));
  }
  if (!health) {
    console.warn('bootstrap: quant service unreachable after 60s — ratings/backtest deferred to crons');
    return;
  }

  if ((health.teams_with_elo ?? 0) < 48) {
    console.log('bootstrap: fresh database detected — loading Elo + market values now…');
    await quantClient.updateRatings(true)
      .then(() => console.log('bootstrap: ratings loaded'))
      .catch((err) => console.error('bootstrap: ratings load failed:', err));
  }

  if (!health.backtest_passed) {
    console.log('bootstrap: no passing backtest gate on this database — running validation (one-time, ~2min)…');
    quantClient.runBacktest('all_majors')
      .then((r) => console.log('bootstrap: backtest recorded:', JSON.stringify(r).slice(0, 120)))
      .catch((err) => console.error('bootstrap: backtest failed:', err));
  }
}

/** Treasurer crons: 8am MT daily report, then compound/withdraw trigger check. */
function scheduleTreasurerJobs(): void {
  let lastReportDay: string | null = null;
  setInterval(async () => {
    const tz = process.env.OPERATOR_TIMEZONE ?? 'America/Edmonton';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    if (get('hour') === '08' && lastReportDay !== day) {
      lastReportDay = day;
      const { sendDailyReport, checkCompoundWithdrawTrigger } = await import('../agents/treasurer/index');
      await sendDailyReport().catch((err) => console.error('daily report failed:', err));
      await checkCompoundWithdrawTrigger().catch((err) => console.error('compound check failed:', err));
    }
  }, 60 * 1000);
}

/**
 * Tactician checkpoints (Phase 2b): T-24h, T-12h, T-2h, T-30min per match.
 * A 5-minute sweep finds matches that crossed a checkpoint without a logged
 * run (dedupe via agent_runs). Lineup state refreshes on every Tactician run
 * plus dedicated passes at T-3h/T-90min/T-60min via the same sweep.
 */
function scheduleTacticianJobs(): void {
  const CHECKPOINTS: Array<{ phase: 'T-24h' | 'T-12h' | 'T-2h' | 'T-30min'; hours: number }> = [
    { phase: 'T-24h', hours: 24 },
    { phase: 'T-12h', hours: 12 },
    { phase: 'T-2h', hours: 2 },
    { phase: 'T-30min', hours: 0.5 }
  ];

  setInterval(async () => {
    try {
      const { db } = await import('../db/index');
      const { matches, agent_runs } = await import('../db/schema');
      const { and, eq, gte, lte } = await import('drizzle-orm');

      const now = Date.now();
      const upcoming = await db
        .select({ id: matches.id, kickoff: matches.scheduled_kickoff_utc })
        .from(matches)
        .where(and(
          eq(matches.status, 'scheduled'),
          gte(matches.scheduled_kickoff_utc, new Date(now)),
          lte(matches.scheduled_kickoff_utc, new Date(now + 25 * 3600 * 1000))
        ));

      for (const m of upcoming) {
        const hoursToKickoff = (m.kickoff.getTime() - now) / 3_600_000;
        // The latest checkpoint we've crossed
        const due = CHECKPOINTS.filter((c) => hoursToKickoff <= c.hours).pop();
        if (!due) continue;

        // T-24h: Tactician baseline only. T-12h/T-2h/T-30min: full CEO pipeline
        // (CEO runs Tactician + Wolfman internally). Dedupe per owning agent.
        const owningAgent = due.phase === 'T-24h' ? 'tactician' : 'ceo';
        const existing = await db
          .select({ id: agent_runs.id })
          .from(agent_runs)
          .where(and(
            eq(agent_runs.agent, owningAgent),
            eq(agent_runs.match_id, m.id),
            eq(agent_runs.run_phase, due.phase),
            eq(agent_runs.status, 'success')
          ))
          .limit(1);
        if (existing.length > 0) continue;

        if (due.phase === 'T-24h') {
          const { runTactician } = await import('../agents/tactician/index');
          await runTactician(m.id, due.phase).catch((err) =>
            console.error(`tactician ${due.phase} failed for ${m.id}:`, err instanceof Error ? err.message : err));
        } else {
          const { runCEO } = await import('../agents/ceo/index');
          await runCEO(m.id, due.phase).catch((err) =>
            console.error(`ceo ${due.phase} failed for ${m.id}:`, err instanceof Error ? err.message : err));
        }
      }
    } catch (err) {
      console.error('tactician sweep failed:', err);
    }
  }, 5 * 60 * 1000);
}

/**
 * Quant orchestration (Phase 2a):
 *  - nightly 3am MT: ratings update (Elo daily; market values added on Mondays)
 *  - hourly: predict any match kicking off within 26h that lacks a fresh
 *    (<12h old) prediction — approximates the T-24h/T-12h/T-2h cadence until
 *    the full per-match pipeline arrives in Phase 3.
 */
function scheduleQuantJobs(): void {
  let lastRatingsDay: string | null = null;

  setInterval(async () => {
    const { quantClient } = await import('../agents/orchestrator/quant_client');
    const health = await quantClient.checkHealth();
    if (!health) return; // quant service down — nothing to schedule

    const tz = process.env.OPERATOR_TIMEZONE ?? 'America/Edmonton';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour: '2-digit', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
    }).formatToParts(new Date());
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;

    if (get('hour') === '03' && lastRatingsDay !== day) {
      lastRatingsDay = day;
      const mondays = get('weekday') === 'Mon';
      quantClient.updateRatings(mondays).catch((err) => console.error('ratings update failed:', err));
    }
  }, 60 * 1000);

  setInterval(async () => {
    try {
      const { quantClient } = await import('../agents/orchestrator/quant_client');
      const health = await quantClient.checkHealth();
      if (!health?.backtest_passed) return;

      const { db } = await import('../db/index');
      const { matches, model_predictions } = await import('../db/schema');
      const { and, eq, gte, lte, desc } = await import('drizzle-orm');

      const now = Date.now();
      const upcoming = await db
        .select({ id: matches.id })
        .from(matches)
        .where(and(
          eq(matches.status, 'scheduled'),
          gte(matches.scheduled_kickoff_utc, new Date(now)),
          lte(matches.scheduled_kickoff_utc, new Date(now + 26 * 60 * 60 * 1000))
        ));

      for (const m of upcoming) {
        const [latest] = await db
          .select({ at: model_predictions.predicted_at })
          .from(model_predictions)
          .where(eq(model_predictions.match_id, m.id))
          .orderBy(desc(model_predictions.predicted_at))
          .limit(1);
        const fresh = latest && now - latest.at.getTime() < 12 * 60 * 60 * 1000;
        if (!fresh) {
          await quantClient.predict(m.id).catch((err) =>
            console.error(`quant predict failed for ${m.id}:`, err.message ?? err));
        }
      }
    } catch (err) {
      console.error('quant prediction sweep failed:', err);
    }
  }, 60 * 60 * 1000);
}

/** Daily fixtures re-sync at 4am MT (catches kickoff shifts, venue changes). */
function scheduleDailyFixtureSync(): void {
  let lastSyncDay: string | null = null;
  setInterval(() => {
    const tz = process.env.OPERATOR_TIMEZONE ?? 'America/Edmonton';
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    if (get('hour') === '04' && lastSyncDay !== day) {
      lastSyncDay = day;
      syncFixtures().catch((err) => console.error('daily fixtures sync failed:', err));
    }
  }, 60 * 1000);
}
