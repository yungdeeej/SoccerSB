/**
 * Phase 1 API routes — slate, match detail, bets, deposits, manual poll.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asc, desc, eq, gte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../db/index';
import { matches, teams, venues, bets, model_predictions, model_versions, situational_adjustments, match_contexts } from '../db/schema';
import { getMarketStates, type MarketState } from '../agents/wolfman/market_state';
import { pollTick } from '../agents/wolfman/poll';
import { syncFixtures } from '../agents/wolfman/fixtures';
import { placeBet, deposit, settleBet, LedgerError } from '../shared/ledger';
import { getSystemStatus } from './status';

export const apiRouter = Router();

const homeTeam = alias(teams, 'home_team');
const awayTeam = alias(teams, 'away_team');

function errorOut(res: Response, err: unknown): void {
  if (err instanceof LedgerError) {
    res.status(400).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: 'Invalid request body', issues: err.issues });
    return;
  }
  console.error('API error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
}

// ---------------------------------------------------------------------------
// Slate + match detail
// ---------------------------------------------------------------------------

async function loadMatchRow(matchId: string) {
  const [row] = await db
    .select({
      id: matches.id,
      kickoff: matches.scheduled_kickoff_utc,
      stage: matches.tournament_stage,
      group_letter: matches.group_letter,
      status: matches.status,
      home_score: matches.home_score,
      away_score: matches.away_score,
      home_name: homeTeam.name,
      home_code: homeTeam.short_name,
      away_name: awayTeam.name,
      away_code: awayTeam.short_name,
      venue_name: venues.name,
      venue_city: venues.city
    })
    .from(matches)
    .innerJoin(homeTeam, eq(matches.home_team_id, homeTeam.id))
    .innerJoin(awayTeam, eq(matches.away_team_id, awayTeam.id))
    .leftJoin(venues, eq(matches.venue_id, venues.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  return row;
}

apiRouter.get('/api/slate', async (_req: Request, res: Response) => {
  try {
    const since = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: matches.id,
        kickoff: matches.scheduled_kickoff_utc,
        stage: matches.tournament_stage,
        group_letter: matches.group_letter,
        status: matches.status,
        home_name: homeTeam.name,
        home_code: homeTeam.short_name,
        away_name: awayTeam.name,
        away_code: awayTeam.short_name
      })
      .from(matches)
      .innerJoin(homeTeam, eq(matches.home_team_id, homeTeam.id))
      .innerJoin(awayTeam, eq(matches.away_team_id, awayTeam.id))
      .where(gte(matches.scheduled_kickoff_utc, since))
      .orderBy(asc(matches.scheduled_kickoff_utc));

    // Edge board: market states for the next 12 upcoming matches, 1X2 only on the slate
    const upcoming = rows.filter((r) => r.status !== 'finished').slice(0, 12);
    const edgeBoard: Array<MarketState & { matchup: string }> = [];
    for (const m of upcoming) {
      const states = await getMarketStates(m.id);
      for (const s of states) {
        if (s.market.startsWith('match_outcome_')) {
          edgeBoard.push({ ...s, matchup: `${m.away_code} @ ${m.home_code}` });
        }
      }
    }
    edgeBoard.sort((a, b) => Math.abs(b.total_movement_cents) - Math.abs(a.total_movement_cents));

    res.json({
      matches: rows,
      edge_board: edgeBoard.slice(0, 40),
      status: await getSystemStatus()
    });
  } catch (err) {
    errorOut(res, err);
  }
});

/** Backtest gate: latest passing quant model version, or null. */
async function quantGateStatus(): Promise<{ passed: boolean; brier: number | null; version: string | null }> {
  const [row] = await db
    .select({
      version: model_versions.version,
      brier: model_versions.backtest_brier
    })
    .from(model_versions)
    .where(eq(model_versions.backtest_passed, true))
    .orderBy(desc(model_versions.deployed_at))
    .limit(1);
  return row
    ? { passed: true, brier: row.brier === null ? null : Number(row.brier), version: row.version }
    : { passed: false, brier: null, version: null };
}

apiRouter.get('/api/matches/:id', async (req: Request, res: Response) => {
  try {
    const row = await loadMatchRow(req.params.id);
    if (!row) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    const states = await getMarketStates(req.params.id);

    // Quant panel data — predictions shown ONLY when the backtest gate passed
    const gate = await quantGateStatus();
    let latestPrediction: Record<string, unknown> | null = null;
    if (gate.passed) {
      const [pred] = await db
        .select({
          predicted_at: model_predictions.predicted_at,
          model_version: model_predictions.model_version,
          expected_goals_home: model_predictions.expected_goals_home,
          expected_goals_away: model_predictions.expected_goals_away,
          predictions: model_predictions.predictions,
          confidence_interval: model_predictions.confidence_interval,
          inputs_quality_score: model_predictions.inputs_quality_score,
          warnings: model_predictions.warnings
        })
        .from(model_predictions)
        .where(eq(model_predictions.match_id, req.params.id))
        .orderBy(desc(model_predictions.predicted_at))
        .limit(1);
      latestPrediction = pred ?? null;
    }

    // Latest Tactician adjustment + lineup snapshot (Phase 2b)
    const [tactician] = await db
      .select()
      .from(situational_adjustments)
      .where(eq(situational_adjustments.match_id, req.params.id))
      .orderBy(desc(situational_adjustments.computed_at))
      .limit(1);
    const [lineup] = await db
      .select({
        home_xi_status: match_contexts.home_xi_status,
        away_xi_status: match_contexts.away_xi_status,
        home_xi_confidence: match_contexts.home_xi_confidence,
        away_xi_confidence: match_contexts.away_xi_confidence,
        home_cluster_score: match_contexts.home_cluster_score,
        away_cluster_score: match_contexts.away_cluster_score
      })
      .from(match_contexts)
      .where(eq(match_contexts.match_id, req.params.id))
      .orderBy(desc(match_contexts.captured_at))
      .limit(1);

    res.json({
      match: row,
      market_states: states,
      quant: { gate, latest_prediction: latestPrediction },
      tactician: tactician ? { ...tactician, ...(lineup ?? {}) } : null
    });
  } catch (err) {
    errorOut(res, err);
  }
});

// ---------------------------------------------------------------------------
// Polling controls
// ---------------------------------------------------------------------------

apiRouter.post('/api/poll', async (_req: Request, res: Response) => {
  try {
    const result = await pollTick(true);
    res.json(result);
  } catch (err) {
    errorOut(res, err);
  }
});

apiRouter.post('/api/fixtures/sync', async (_req: Request, res: Response) => {
  try {
    const result = await syncFixtures();
    res.json(result);
  } catch (err) {
    errorOut(res, err);
  }
});

// ---------------------------------------------------------------------------
// Bets + bankroll
// ---------------------------------------------------------------------------

const PlaceBetBody = z.object({
  match_id: z.string().uuid(),
  market: z.string().min(1),
  side: z.string().min(1),
  book: z.string().min(1),
  american_odds: z.number().int().refine((v) => v !== 0, 'American odds cannot be 0'),
  stake_dollars: z.number().positive()
});

apiRouter.post('/bets/place', async (req: Request, res: Response) => {
  try {
    const body = PlaceBetBody.parse(req.body);
    const stake_cents = BigInt(Math.round(body.stake_dollars * 100));
    const result = await placeBet({
      match_id: body.match_id,
      market: body.market,
      side: body.side,
      book: body.book,
      american_odds: body.american_odds,
      stake_cents
    });
    res.json({
      bet_id: result.bet_id,
      balance_after_cents: Number(result.balance_after_cents)
    });
  } catch (err) {
    errorOut(res, err);
  }
});

const SettleBody = z.object({
  outcome: z.enum(['win', 'loss', 'push', 'half_win', 'half_loss', 'void'])
});

apiRouter.post('/bets/:id/settle', async (req: Request, res: Response) => {
  try {
    const body = SettleBody.parse(req.body);
    const result = await settleBet(req.params.id, body.outcome);
    res.json({
      payout_cents: Number(result.payout_cents),
      pl_cents: Number(result.pl_cents),
      balance_after_cents: Number(result.balance_after_cents)
    });
  } catch (err) {
    errorOut(res, err);
  }
});

const DepositBody = z.object({
  amount_dollars: z.number().positive(),
  note: z.string().default('Deposit')
});

apiRouter.post('/bankroll/deposit', async (req: Request, res: Response) => {
  try {
    const body = DepositBody.parse(req.body);
    const result = await deposit(BigInt(Math.round(body.amount_dollars * 100)), body.note);
    res.json({ balance_after_cents: Number(result.balance_after_cents) });
  } catch (err) {
    errorOut(res, err);
  }
});

apiRouter.get('/api/bets', async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: bets.id,
        placed_at: bets.placed_at,
        market: bets.market,
        side: bets.side,
        book: bets.book,
        stake_cents: bets.stake_cents,
        american_odds: bets.american_odds,
        settlement_status: bets.settlement_status,
        outcome: bets.outcome,
        pl_cents: bets.pl_cents,
        match_id: bets.match_id,
        home_code: homeTeam.short_name,
        away_code: awayTeam.short_name
      })
      .from(bets)
      .innerJoin(matches, eq(bets.match_id, matches.id))
      .innerJoin(homeTeam, eq(matches.home_team_id, homeTeam.id))
      .innerJoin(awayTeam, eq(matches.away_team_id, awayTeam.id))
      .orderBy(desc(bets.placed_at));

    res.json({
      bets: rows.map((r) => ({
        ...r,
        stake_cents: Number(r.stake_cents),
        pl_cents: r.pl_cents === null ? null : Number(r.pl_cents)
      }))
    });
  } catch (err) {
    errorOut(res, err);
  }
});

apiRouter.get('/api/status', async (_req: Request, res: Response) => {
  try {
    res.json(await getSystemStatus());
  } catch (err) {
    errorOut(res, err);
  }
});

// ---------------------------------------------------------------------------
// Tactician (Phase 2b)
// ---------------------------------------------------------------------------

apiRouter.post('/api/matches/:id/tactician/run', async (req: Request, res: Response) => {
  try {
    const { runTactician } = await import('../agents/tactician/index');
    const output = await runTactician(req.params.id, 'manual');
    res.json(output);
  } catch (err) {
    errorOut(res, err);
  }
});

const LineupOverrideBody = z.object({
  side: z.enum(['home', 'away']),
  xi_status: z.enum(['projected', 'leaked', 'confirmed']),
  absences: z.array(z.object({
    player_name: z.string().min(1),
    reason: z.string().default('injured'),
    position_group: z.enum(['goalkeeper', 'defender', 'midfielder', 'forward']),
    is_captain: z.boolean().default(false),
    is_key_player: z.boolean().default(false)
  })).default([])
});

apiRouter.post('/api/matches/:id/lineup', async (req: Request, res: Response) => {
  try {
    const body = LineupOverrideBody.parse(req.body);
    const { applyOperatorOverride } = await import('../agents/tactician/lineup');
    const state = await applyOperatorOverride(req.params.id, body);
    res.json(state);
  } catch (err) {
    errorOut(res, err);
  }
});
