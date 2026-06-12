/**
 * The Tactician — main entry point. Quant output + situational factors →
 * adjusted predictions, written append-only to situational_adjustments.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { model_predictions, situational_adjustments } from '../../db/schema';
import { logAgentRun } from '../wolfman/agent_log';
import { quantClient, QuantPredictionSchema, type QuantPrediction } from '../orchestrator/quant_client';
import { applyToQuant } from './apply';
import { combineAdjustments } from './compose';
import { getCoefficientVersion, loadCoefficients } from './config';
import { buildMatchContext } from './context';
import { computeAltitude } from './factors/altitude';
import { computeClusterInjury } from './factors/cluster_injury';
import { computeMotivation } from './factors/motivation';
import { computeRecentForm } from './factors/recent_form';
import { computeReferee } from './factors/referee';
import { computeRestDays } from './factors/rest_days';
import { computeSetPiece } from './factors/set_piece';
import { computeSquadRotation } from './factors/squad_rotation';
import { computeTacticalMatchup } from './factors/tactical_matchup';
import { computeTravel } from './factors/travel';
import { computeWeather } from './factors/weather';
import { writeMatchContext, getLineupState } from './lineup';
import type { FactorBreakdown, MatchContext, TacticianOutput } from './types';

/** Latest stored Quant prediction (fresh < 12h), else trigger one via HTTP. */
async function getQuantOutput(matchId: string): Promise<QuantPrediction> {
  const [row] = await db
    .select()
    .from(model_predictions)
    .where(eq(model_predictions.match_id, matchId))
    .orderBy(desc(model_predictions.predicted_at))
    .limit(1);

  if (row && Date.now() - row.predicted_at.getTime() < 12 * 3600 * 1000) {
    return QuantPredictionSchema.parse({
      prediction_id: row.id,
      match_id: matchId,
      model_version: row.model_version,
      predicted_at: row.predicted_at.toISOString(),
      expected_goals: {
        home: Number(row.expected_goals_home),
        away: Number(row.expected_goals_away),
        total: Number(row.expected_goals_home) + Number(row.expected_goals_away)
      },
      predictions: row.predictions,
      confidence_interval: row.confidence_interval,
      rating_components: row.rating_components ?? {},
      diagnostic: {
        inputs_quality_score: row.inputs_quality_score ?? 0,
        warnings: (row.warnings as string[] | null) ?? [],
        xi_status: row.xi_status
      }
    });
  }
  return quantClient.predict(matchId);
}

function buildFlags(factors: FactorBreakdown, ctx: MatchContext): string[] {
  const flags: string[] = [];
  const pct = (v: number): string => `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

  const f = factors;
  if (f.rest_days.home_effect !== 0 || f.rest_days.away_effect !== 0) {
    flags.push(`Rest: ${ctx.home.code} ${ctx.home.rest_days}d vs ${ctx.away.code} ${ctx.away.rest_days}d (${pct(f.rest_days.home_effect)} home / ${pct(f.rest_days.away_effect)} away)`);
  }
  if (f.travel.home_effect !== 0 || f.travel.away_effect !== 0) {
    const m = f.travel.metadata;
    flags.push(`Travel: ${ctx.home.code} ${String(m.home_distance_km)}km, ${ctx.away.code} ${String(m.away_distance_km)}km from base`);
  }
  if (f.motivation.home_effect !== 0 || f.motivation.away_effect !== 0 || f.motivation.ci_widening) {
    flags.push(`MOTIVATION (MD3): ${ctx.home.code} ${ctx.home.qualification_status} vs ${ctx.away.code} ${ctx.away.qualification_status}`);
  }
  if (f.squad_rotation.home_effect !== 0 || f.squad_rotation.away_effect !== 0) {
    flags.push(`Rotation expected: ${pct(f.squad_rotation.home_effect)} ${ctx.home.code} / ${pct(f.squad_rotation.away_effect)} ${ctx.away.code}`);
  }
  if (f.cluster_injury.home_effect !== 0 || f.cluster_injury.away_effect !== 0) {
    flags.push(`Cluster injuries: ${ctx.home.code} score ${ctx.home.cluster_score.toFixed(1)}, ${ctx.away.code} score ${ctx.away.cluster_score.toFixed(1)}`);
  }
  if (f.tactical_matchup.home_effect !== 0 || f.tactical_matchup.away_effect !== 0) {
    flags.push(`Tactical: ${pct(f.tactical_matchup.home_effect)} ${ctx.home.code} / ${pct(f.tactical_matchup.away_effect)} ${ctx.away.code}`);
  }
  if (f.weather.home_effect !== 0 || f.weather.totals_modifier) {
    flags.push(`Weather: ${ctx.weather?.temp_c.toFixed(0)}°C ${ctx.weather?.condition ?? ''}`);
  }
  if (f.referee.home_effect !== 0 || f.referee.away_effect !== 0) {
    flags.push(`Referee: ${String(f.referee.metadata.referee ?? 'tendencies firing')}`);
  }
  if (ctx.home.xi_status !== 'confirmed' || ctx.away.xi_status !== 'confirmed') {
    flags.push(`XI status: ${ctx.home.code} ${ctx.home.xi_status} / ${ctx.away.code} ${ctx.away.xi_status}`);
  }
  return flags;
}

function inputsQualityScore(ctx: MatchContext): number {
  let score = 100;
  const hoursToKickoff = (ctx.kickoff_utc.getTime() - Date.now()) / 3_600_000;
  if (hoursToKickoff <= 2) {
    if (ctx.home.xi_status !== 'confirmed') score -= 25;
    if (ctx.away.xi_status !== 'confirmed') score -= 25;
  }
  if (!ctx.weather) score -= 10;
  if (!ctx.referee && hoursToKickoff <= 48) score -= 10;
  if (ctx.home.profile._todo) score -= 5;
  if (ctx.away.profile._todo) score -= 5;
  return Math.max(0, score);
}

export async function runTactician(
  matchId: string,
  runPhase: MatchContext['run_phase'] = 'manual'
): Promise<TacticianOutput> {
  const startMs = Date.now();
  try {
    const quant = await getQuantOutput(matchId);
    const ctx = await buildMatchContext(matchId, runPhase);
    const coef = loadCoefficients();

    const factors: FactorBreakdown = {
      rest_days: computeRestDays(ctx, coef),
      travel: computeTravel(ctx, coef),
      altitude: computeAltitude(ctx, coef),
      weather: computeWeather(ctx, coef),
      motivation: computeMotivation(ctx, coef),
      squad_rotation: computeSquadRotation(ctx, coef),
      tactical_matchup: computeTacticalMatchup(ctx, coef),
      set_piece: computeSetPiece(ctx, coef),
      referee: computeReferee(ctx, coef),
      cluster_injury: computeClusterInjury(ctx, coef),
      recent_form: computeRecentForm(ctx, coef)
    };

    const combined = combineAdjustments(factors, coef);
    const adjusted = applyToQuant(quant, combined);

    const flags = buildFlags(factors, ctx);
    if (combined.capped) {
      flags.push('EXTREME SITUATIONAL STACK — total adjustment capped at ±12%, manual review recommended');
    }
    if (adjusted.extreme_clip_flag) {
      flags.push('WARNING: adjusted probabilities clipped at extremes — treat with suspicion');
    }

    const output: TacticianOutput = {
      match_id: matchId,
      computed_at: new Date().toISOString(),
      coefficient_version: getCoefficientVersion(),
      run_phase: runPhase,
      home_xi_status: ctx.home.xi_status,
      away_xi_status: ctx.away.xi_status,
      home_xi_confidence_score: ctx.home.xi_confidence,
      away_xi_confidence_score: ctx.away.xi_confidence,
      home_cluster_score: ctx.home.cluster_score,
      away_cluster_score: ctx.away.cluster_score,
      flagged_lineup_concerns: ctx.flagged_concerns,
      raw_quant_probs: quant.predictions.match_outcome,
      adjusted_probs: adjusted.adjusted_match_outcome,
      adjusted_predictions: adjusted,
      xg_modifiers: combined.xg_modifiers,
      factor_breakdown: factors,
      flags,
      total_adjustment_capped: combined.capped,
      combined_advantage_home: combined.net_advantage_home,
      inputs_quality_score: inputsQualityScore(ctx)
    };

    // Persist (append-only): situational_adjustments + a match_contexts snapshot
    await db.insert(situational_adjustments).values({
      match_id: matchId,
      coefficient_version: output.coefficient_version,
      raw_quant_probs: output.raw_quant_probs,
      adjusted_probs: output.adjusted_probs,
      home_xg_modifier: combined.xg_modifiers.home.toFixed(3),
      away_xg_modifier: combined.xg_modifiers.away.toFixed(3),
      totals_offset: combined.xg_modifiers.totals_offset.toFixed(3),
      factor_breakdown: factors,
      flags,
      total_adjustment_capped: combined.capped,
      combined_advantage_home: combined.net_advantage_home.toFixed(3),
      inputs_quality_score: output.inputs_quality_score
    });

    const lineupState = await getLineupState(matchId, (ctx.kickoff_utc.getTime() - Date.now()) / 3_600_000);
    await writeMatchContext(matchId, runPhase, lineupState);

    await logAgentRun({
      agent: 'tactician',
      run_phase: runPhase,
      status: 'success',
      duration_ms: Date.now() - startMs,
      match_id: matchId,
      outputs_summary: {
        capped: combined.capped,
        net_advantage_home: Number(combined.net_advantage_home.toFixed(4)),
        adjusted_home: Number(adjusted.adjusted_match_outcome.home_win_prob.toFixed(4)),
        factors_firing: Object.entries(factors)
          .filter(([, f]) => f.home_effect !== 0 || f.away_effect !== 0)
          .map(([name]) => name)
      }
    });

    return output;
  } catch (error) {
    await logAgentRun({
      agent: 'tactician',
      run_phase: runPhase,
      status: 'failed_recoverable',
      duration_ms: Date.now() - startMs,
      match_id: matchId,
      error
    });
    throw error;
  }
}
