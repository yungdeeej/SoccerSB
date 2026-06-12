/**
 * The Wolfman (full, Phase 3) — per-market signal analysis + LLM tape
 * commentary, written to market_intelligence.
 */
import { and, asc, eq, gte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/index';
import { market_intelligence, matches, odds_snapshots, teams } from '../../db/schema';
import { logAgentRun } from './agent_log';
import { computeMarketStates, operatorAccessibleBooks, type MarketState } from './market_state';
import { detectAsianWesternDivergence, type AsianWesternDivergence } from './signals/asian_western';
import { detectLineFreeze } from './signals/line_freeze';
import { detectRLM, type RLMSignal } from './signals/rlm';
import { detectSteam, type SteamSignal } from './signals/steam';
import { computeTimingSignal, type TimingSignal } from './signals/timing';
import type { MarketSnapshotSeries, SnapshotPoint } from './signals/types';
import { generateMarketSummary } from './synthesis';

export interface MarketAnalysis {
  state: MarketState;
  steam: SteamSignal;
  rlm: RLMSignal;
  line_freeze_detected: boolean;
  asian_western: AsianWesternDivergence;
  timing: TimingSignal;
  movement_last_30min_cents: number;
  market_signal_summary: string;
  llm_used: boolean;
}

export interface WolfmanOutput {
  match_id: string;
  analyzed_at: string;
  markets: Record<string, MarketAnalysis>;
  cross_market_observations: string[];
  llm_cost_usd: number;
}

function movementInWindow(series: MarketSnapshotSeries, windowMs: number, now: Date): number {
  // Consensus movement across books inside the window
  let total = 0;
  let counted = 0;
  for (const snapshots of series.values()) {
    const recent = snapshots.filter((s) => now.getTime() - s.captured_at.getTime() < windowMs);
    if (recent.length >= 2) {
      total += recent[recent.length - 1].american_odds - recent[0].american_odds;
      counted++;
    }
  }
  return counted > 0 ? Math.round(total / counted) : 0;
}

function crossMarketObservations(markets: Record<string, MarketAnalysis>): string[] {
  const obs: string[] = [];
  const steaming = Object.entries(markets).filter(([, m]) => m.steam.detected);
  if (steaming.length >= 2) {
    obs.push(`Coordinated steam across ${steaming.length} markets: ${steaming.map(([k]) => k).join(', ')}`);
  }
  const frozen = Object.entries(markets).filter(([, m]) => m.line_freeze_detected);
  if (frozen.length >= 2) {
    obs.push(`Pinnacle frozen on ${frozen.length} markets — possible breaking news, hold new positions`);
  }
  const diverged = Object.entries(markets).filter(([, m]) => m.asian_western.detected);
  if (diverged.length > 0) {
    obs.push(`Asian/Western divergence live on: ${diverged.map(([k]) => k).join(', ')}`);
  }
  return obs;
}

export async function runWolfman(matchId: string, runPhase: string): Promise<WolfmanOutput> {
  const startMs = Date.now();
  try {
    const homeTeam = alias(teams, 'wh');
    const awayTeam = alias(teams, 'wa');
    const [match] = await db
      .select({
        id: matches.id,
        kickoff: matches.scheduled_kickoff_utc,
        stage: matches.tournament_stage,
        home_code: homeTeam.short_name,
        away_code: awayTeam.short_name
      })
      .from(matches)
      .innerJoin(homeTeam, eq(matches.home_team_id, homeTeam.id))
      .innerJoin(awayTeam, eq(matches.away_team_id, awayTeam.id))
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!match) throw new Error(`Match ${matchId} not found`);

    // All snapshots from the last 24h, oldest first
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const rows = await db
      .select({
        book: odds_snapshots.book,
        market: odds_snapshots.market,
        side: odds_snapshots.side,
        american_odds: odds_snapshots.american_odds,
        captured_at: odds_snapshots.captured_at
      })
      .from(odds_snapshots)
      .where(and(eq(odds_snapshots.match_id, matchId), gte(odds_snapshots.captured_at, since)))
      .orderBy(asc(odds_snapshots.captured_at));

    // Market states from the shared Phase 1 computation
    const states = computeMarketStates(matchId, rows, operatorAccessibleBooks());
    const stateByMarket = new Map(states.map((s) => [s.market, s]));

    // Per-market snapshot series
    const seriesByMarket = new Map<string, MarketSnapshotSeries>();
    for (const row of rows) {
      let series = seriesByMarket.get(row.market);
      if (!series) {
        series = new Map();
        seriesByMarket.set(row.market, series);
      }
      let snaps = series.get(row.book);
      if (!snaps) {
        snaps = [];
        series.set(row.book, snaps);
      }
      snaps.push({ book: row.book, american_odds: row.american_odds, captured_at: row.captured_at });
    }

    const now = new Date();
    const markets: Record<string, MarketAnalysis> = {};
    let llmCost = 0;

    for (const [market, series] of seriesByMarket) {
      const state = stateByMarket.get(market);
      if (!state) continue;

      const steam = detectSteam(series, now);
      const movement30 = movementInWindow(series, 30 * 60 * 1000, now);
      const rlm = detectRLM(null, Math.abs(movement30));  // public bet data not wired yet
      const pinnacleSnaps: SnapshotPoint[] = series.get('pinnacle') ?? [];
      const lineFreeze = detectLineFreeze(pinnacleSnaps, now);
      const awDivergence = detectAsianWesternDivergence(market, series);
      const timing = computeTimingSignal({
        market,
        opening_consensus_american: state.opening_consensus_american,
        current_consensus_american: state.current_consensus_american,
        kickoff_utc: match.kickoff,
        now
      });

      const summary = await generateMarketSummary({
        matchup: `${match.away_code} @ ${match.home_code}`,
        stage: match.stage,
        market,
        opening_consensus_american: state.opening_consensus_american,
        current_consensus_american: state.current_consensus_american,
        total_movement_cents: state.total_movement_cents,
        pinnacle_current_american: state.pinnacle_current_american,
        pinnacle_no_vig_pct: state.pinnacle_no_vig_prob !== null ? state.pinnacle_no_vig_prob * 100 : null,
        sbobet_current_american: state.sbobet_current_american,
        best_book: state.best_book,
        best_book_american: state.best_book_american,
        steam,
        rlm,
        aw_divergence: awDivergence,
        line_freeze: lineFreeze,
        timing
      });
      llmCost += summary.cost_usd;

      markets[market] = {
        state,
        steam,
        rlm,
        line_freeze_detected: lineFreeze,
        asian_western: awDivergence,
        timing,
        movement_last_30min_cents: movement30,
        market_signal_summary: summary.summary,
        llm_used: summary.llm_used
      };
    }

    const crossMarket = crossMarketObservations(markets);
    const analyzedAt = new Date().toISOString();

    await db.insert(market_intelligence).values({
      match_id: matchId,
      markets,
      cross_market_observations: crossMarket
    });

    await logAgentRun({
      agent: 'wolfman',
      run_phase: `synthesis_${runPhase}`,
      status: 'success',
      duration_ms: Date.now() - startMs,
      match_id: matchId,
      outputs_summary: {
        markets_analyzed: Object.keys(markets).length,
        steam_detected: Object.values(markets).filter((m) => m.steam.detected).length,
        llm_cost_usd: Number(llmCost.toFixed(5)),
        llm_used: Object.values(markets).some((m) => m.llm_used)
      }
    });

    return { match_id: matchId, analyzed_at: analyzedAt, markets, cross_market_observations: crossMarket, llm_cost_usd: llmCost };
  } catch (error) {
    await logAgentRun({
      agent: 'wolfman',
      run_phase: `synthesis_${runPhase}`,
      status: 'failed_recoverable',
      duration_ms: Date.now() - startMs,
      match_id: matchId,
      error
    });
    throw error;
  }
}
