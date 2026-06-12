/**
 * Lineup confirmation flow (the NHL Reader's role, simplified for soccer).
 * Sources: API-Football lineups (when key present) > operator overrides >
 * projection. Beat-reporter scraping is deferred (handles stored for later).
 * Writes match_contexts rows append-only.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { match_contexts } from '../../db/schema';
import { loadCoefficients } from './config';
import { computeClusterScore } from './factors/cluster_injury';
import type { PlayerAbsence, XIStatus } from './types';

export interface LineupState {
  home_xi_status: XIStatus;
  away_xi_status: XIStatus;
  home_xi_confidence: number;
  away_xi_confidence: number;
  home_absences: PlayerAbsence[];
  away_absences: PlayerAbsence[];
  home_cluster_score: number;
  away_cluster_score: number;
  flagged_concerns: string[];
  source: string;
}

/** Latest lineup state for a match from match_contexts (or fresh projection). */
export async function getLineupState(matchId: string, hoursToKickoff: number): Promise<LineupState> {
  const [latest] = await db
    .select()
    .from(match_contexts)
    .where(eq(match_contexts.match_id, matchId))
    .orderBy(desc(match_contexts.captured_at))
    .limit(1);

  const coef = loadCoefficients();
  const home_absences = ((latest?.home_absences as PlayerAbsence[] | null) ?? []);
  const away_absences = ((latest?.away_absences as PlayerAbsence[] | null) ?? []);

  const home_status = (latest?.home_xi_status as XIStatus | null) ?? 'projected';
  const away_status = (latest?.away_xi_status as XIStatus | null) ?? 'projected';

  const concerns: string[] = [];
  let home_conf = 100;
  let away_conf = 100;

  // -25 per unconfirmed XI at T-2h or later
  if (hoursToKickoff <= 2) {
    if (home_status !== 'confirmed') {
      home_conf -= 25;
      concerns.push('Home XI unconfirmed at T-2h');
    }
    if (away_status !== 'confirmed') {
      away_conf -= 25;
      concerns.push('Away XI unconfirmed at T-2h');
    }
  }
  // -15 when primary sources are unreachable (no API key = no automated source)
  if (!process.env.APIFOOTBALL_KEY) {
    home_conf -= 15;
    away_conf -= 15;
    concerns.push('No automated lineup source (APIFOOTBALL_KEY unset) — operator overrides only');
  }

  return {
    home_xi_status: home_status,
    away_xi_status: away_status,
    home_xi_confidence: Math.max(0, home_conf),
    away_xi_confidence: Math.max(0, away_conf),
    home_absences,
    away_absences,
    home_cluster_score: computeClusterScore(home_absences, coef),
    away_cluster_score: computeClusterScore(away_absences, coef),
    flagged_concerns: concerns,
    source: latest ? 'match_contexts' : 'default_projection'
  };
}

/** Persist a lineup snapshot (append-only) — called on every evaluation pass. */
export async function writeMatchContext(
  matchId: string,
  runPhase: string,
  state: LineupState,
  beatReporterSignals: Record<string, unknown> | null = null
): Promise<void> {
  await db.insert(match_contexts).values({
    match_id: matchId,
    run_phase: runPhase,
    home_xi_status: state.home_xi_status,
    away_xi_status: state.away_xi_status,
    home_xi_confidence: state.home_xi_confidence,
    away_xi_confidence: state.away_xi_confidence,
    home_absences: state.home_absences,
    away_absences: state.away_absences,
    home_cluster_score: state.home_cluster_score.toFixed(2),
    away_cluster_score: state.away_cluster_score.toFixed(2),
    beat_reporter_signals: beatReporterSignals,
    flagged_concerns: state.flagged_concerns,
    source_failures: process.env.APIFOOTBALL_KEY ? null : ['api_football_key_missing']
  });
}

/**
 * Operator lineup override — the dashboard form posts absences/status here.
 * Writes a new match_contexts row that subsequent runs pick up as latest.
 */
export async function applyOperatorOverride(
  matchId: string,
  override: {
    side: 'home' | 'away';
    xi_status: XIStatus;
    absences: PlayerAbsence[];
  }
): Promise<LineupState> {
  const current = await getLineupState(matchId, 99);
  const next: LineupState = {
    ...current,
    [`${override.side}_xi_status`]: override.xi_status,
    [`${override.side}_absences`]: override.absences
  } as LineupState;

  const coef = loadCoefficients();
  next.home_cluster_score = computeClusterScore(next.home_absences, coef);
  next.away_cluster_score = computeClusterScore(next.away_absences, coef);
  next.source = 'operator_override';

  await writeMatchContext(matchId, 'operator_override', next, {
    source: 'operator_override',
    side: override.side,
    at: new Date().toISOString()
  });
  return next;
}
