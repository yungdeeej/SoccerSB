/**
 * The CEO — synthesis + discipline gates + verdicts (Phase 3).
 * Gates decide STRIKE/WATCH/PASS deterministically; Sonnet writes rationale.
 */
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/index';
import { bets, matches, model_predictions, teams, verdicts } from '../../db/schema';
import { sendTelegramMessage } from '../../notify/telegram';
import { operatorDayStartUtc } from '../../api/status';
import { logAgentRun } from '../wolfman/agent_log';
import { runWolfman, type WolfmanOutput } from '../wolfman/index';
import { runTactician } from '../tactician/index';
import type { TacticianOutput } from '../tactician/types';
import { computePlaceholderStake, getTreasurerSnapshot } from '../treasurer/stub';
import { runAllGates } from './gates';
import { computeStarRating } from './star_rating';
import { generateVerdictWriteup, watchTrigger } from './writeup';
import { adjustedEdge, isKnockout, type CEOContext, type Decision } from './types';

export interface CEORunResult {
  match_id: string;
  verdicts_written: number;
  strikes: number;
  watches: number;
  passes: number;
  llm_cost_usd: number;
}

/** Map a market key to the Tactician-adjusted probability for that side. */
export function adjustedProbForMarket(tactician: TacticianOutput, market: string): number | null {
  const adj = tactician.adjusted_predictions;
  if (market === 'match_outcome_home') return adj.adjusted_match_outcome.home_win_prob;
  if (market === 'match_outcome_draw') return adj.adjusted_match_outcome.draw_prob;
  if (market === 'match_outcome_away') return adj.adjusted_match_outcome.away_win_prob;

  let m = /^total_(over|under)_(.+)$/.exec(market);
  if (m) {
    const line = adj.adjusted_totals[m[2]];
    if (!line) return null;
    return m[1] === 'over' ? line.over : line.under;
  }

  m = /^asian_handicap_(home|away)_([+-].+)$/.exec(market);
  if (m) {
    const lineNum = parseFloat(m[2]);
    const homeLine = m[1] === 'home' ? lineNum : -lineNum;
    const key = homeLine > 0 ? `+${homeLine}` : String(homeLine);
    const probs = adj.adjusted_asian_handicap[key];
    if (!probs) return null;
    return m[1] === 'home' ? probs.home_covers : probs.away_covers;
  }

  if (market === 'btts_yes') return adj.adjusted_btts.yes_prob;
  if (market === 'btts_no') return adj.adjusted_btts.no_prob;
  return null;
}

function sideOf(market: string): string {
  let m = /^match_outcome_(home|draw|away)$/.exec(market);
  if (m) return m[1];
  m = /^total_(over|under)_(.+)$/.exec(market);
  if (m) return m[1];
  m = /^asian_handicap_(home|away)_([+-].+)$/.exec(market);
  if (m) return `${m[1]} ${m[2]}`;
  m = /^btts_(yes|no)$/.exec(market);
  if (m) return m[1];
  return market.split('_').pop() ?? market;
}

function summarizeFactors(t: TacticianOutput): string {
  const firing = Object.entries(t.factor_breakdown)
    .filter(([, f]) => f.home_effect !== 0 || f.away_effect !== 0)
    .map(([name, f]) => `${name} ${(f.home_effect * 100).toFixed(1)}%/${(f.away_effect * 100).toFixed(1)}%`);
  return firing.length > 0 ? firing.join('; ') : 'no situational factors firing';
}

export async function runCEO(matchId: string, runPhase: CEOContext['run_phase']): Promise<CEORunResult> {
  const startMs = Date.now();
  try {
    const homeTeam = alias(teams, 'ch');
    const awayTeam = alias(teams, 'ca');
    const [match] = await db
      .select({
        id: matches.id, kickoff: matches.scheduled_kickoff_utc, stage: matches.tournament_stage,
        home_code: homeTeam.short_name, away_code: awayTeam.short_name
      })
      .from(matches)
      .innerJoin(homeTeam, eq(matches.home_team_id, homeTeam.id))
      .innerJoin(awayTeam, eq(matches.away_team_id, awayTeam.id))
      .where(eq(matches.id, matchId))
      .limit(1);
    if (!match) throw new Error(`Match ${matchId} not found`);

    // Upstream agents — fail-safe to PASS is automatic: any throw here aborts
    // and no verdicts are written (operating rule 5: never STRIKE on incomplete data)
    const tactician = await runTactician(matchId, runPhase === 'manual' ? 'manual' : runPhase);
    const wolfman: WolfmanOutput = await runWolfman(matchId, runPhase);
    const knockout = isKnockout(match.stage);
    const treasurer = await getTreasurerSnapshot(knockout);

    // Quant CI from the latest stored prediction
    const [pred] = await db
      .select({ confidence_interval: model_predictions.confidence_interval })
      .from(model_predictions)
      .where(eq(model_predictions.match_id, matchId))
      .orderBy(desc(model_predictions.predicted_at))
      .limit(1);
    const ci = (pred?.confidence_interval ?? {}) as {
      home_win_ci_width?: number; draw_ci_width?: number; away_win_ci_width?: number; low_confidence_flag?: boolean;
    };
    const ciMax = Math.max(ci.home_win_ci_width ?? 0, ci.draw_ci_width ?? 0, ci.away_win_ci_width ?? 0);

    // One bet per match per day (Gate G input)
    const todaysMatchBets = await db
      .select({ id: bets.id })
      .from(bets)
      .where(and(eq(bets.match_id, matchId), gte(bets.placed_at, operatorDayStartUtc())));

    const hoursToKickoff = (match.kickoff.getTime() - Date.now()) / 3_600_000;
    const isOpener = match.stage === 'group_md1' &&
      match.kickoff.toISOString().startsWith('2026-06-11');
    const matchup = `${match.away_code} @ ${match.home_code}`;
    const kickoffDisplay = match.kickoff.toLocaleString('en-US', { timeZone: 'America/Edmonton' }) + ' MT';

    let strikes = 0, watches = 0, passes = 0, llmCost = 0, written = 0;

    for (const [market, analysis] of Object.entries(wolfman.markets)) {
      const adjustedProb = adjustedProbForMarket(tactician, market);
      if (adjustedProb === null) continue;  // market without a model probability

      const ctx: CEOContext = {
        match_id: matchId,
        market,
        side: sideOf(market),
        tournament_stage: match.stage,
        is_opener: isOpener,
        hours_to_kickoff: hoursToKickoff,
        run_phase: runPhase,
        adjusted_prob: adjustedProb,
        low_confidence: ci.low_confidence_flag ?? false,
        quant_ci_max_width: ciMax,
        best_book: analysis.state.best_book,
        best_book_american: analysis.state.best_book_american,
        best_book_decimal: analysis.state.best_book_decimal,
        pinnacle_no_vig_prob: analysis.state.pinnacle_no_vig_prob,
        movement_last_30min_cents: analysis.movement_last_30min_cents,
        // Our side drifting out (>+4¢) = sharps fading the side we'd back
        movement_direction_adverse: analysis.movement_last_30min_cents > 4,
        line_freeze: analysis.line_freeze_detected,
        asian_western: analysis.asian_western,
        sbobet_no_vig_prob: null,  // populated when Asian book feeds arrive
        tactician,
        treasurer,
        already_bet_this_match_today: todaysMatchBets.length > 0
      };

      const gates = runAllGates(ctx);
      const decision: Decision = gates.passed ? 'STRIKE' : gates.failure?.watch_eligible ? 'WATCH' : 'PASS';

      const edgePct = adjustedEdge(ctx) * 100;
      const { stars } = computeStarRating(edgePct);

      let stake: ReturnType<typeof computePlaceholderStake> | null = null;
      if (decision === 'STRIKE') {
        stake = computePlaceholderStake({
          adjusted_win_prob: adjustedProb,
          decimal_odds: ctx.best_book_decimal,
          snapshot: treasurer,
          low_confidence: ctx.low_confidence,
          knockout_stage: knockout
        });
      }

      const writeup = await generateVerdictWriteup({
        decision,
        ctx,
        failure: gates.failure ?? null,
        stars,
        stake_dollars: stake ? Number(stake.stake_cents) / 100 : null,
        matchup,
        kickoff_display: kickoffDisplay,
        wolfman_summary: analysis.market_signal_summary,
        factor_summary: summarizeFactors(tactician)
      });
      llmCost += writeup.cost_usd;

      // Atomic: supersede prior verdict + insert new one
      const prior = await db
        .select({ id: verdicts.id, decision: verdicts.decision })
        .from(verdicts)
        .where(and(
          eq(verdicts.match_id, matchId),
          eq(verdicts.market, market),
          eq(verdicts.side, ctx.side),
          isNull(verdicts.superseded_by)
        ))
        .orderBy(desc(verdicts.issued_at))
        .limit(1);

      const verdictId = await db.transaction(async (tx) => {
        const [inserted] = await tx.insert(verdicts).values({
          match_id: matchId,
          run_phase: runPhase,
          market,
          side: ctx.side,
          decision,
          recommended_book: decision === 'STRIKE' ? ctx.best_book : null,
          recommended_odds_american: decision === 'STRIKE' ? ctx.best_book_american : null,
          recommended_stake_cents: stake?.approved ? stake.stake_cents : null,
          kelly_fraction_used: stake?.approved ? stake.fraction.toFixed(4) : null,
          bankroll_pct: stake?.approved ? stake.bankroll_pct.toFixed(2) : null,
          star_rating: decision === 'STRIKE' ? stars.toFixed(1) : null,
          pass_reason: decision === 'PASS' ? gates.failure?.gate : null,
          watch_reason: decision === 'WATCH' ? gates.failure?.gate : null,
          watch_for: decision === 'WATCH' ? watchTrigger(gates.failure ?? null) : null,
          raw_edge_pct: ((tactician.raw_quant_probs.home_win_prob * ctx.best_book_decimal - 1) * 100).toFixed(3),
          adjusted_edge_pct: edgePct.toFixed(3),
          walters_writeup: writeup.writeup,
          agent_inputs_snapshot: {
            tactician_version: tactician.coefficient_version,
            tactician_computed_at: tactician.computed_at,
            wolfman_analyzed_at: wolfman.analyzed_at,
            adjusted_prob: adjustedProb,
            pinnacle_no_vig: ctx.pinnacle_no_vig_prob,
            best_book: ctx.best_book,
            best_book_american: ctx.best_book_american,
            treasurer_bankroll_cents: Number(treasurer.active_bankroll_cents),
            llm_used: writeup.llm_used
          },
          discipline_gates_passed: gates.allResults.filter((r) => r.passed).map((r) => r.gate),
          discipline_gates_failed: gates.allResults.filter((r) => !r.passed).map((r) => ({ gate: r.gate, explanation: r.explanation })),
          expires_at: match.kickoff
        }).returning({ id: verdicts.id });

        if (prior.length > 0) {
          await tx.update(verdicts).set({ superseded_by: inserted.id }).where(eq(verdicts.id, prior[0].id));
        }
        return inserted.id;
      });

      written++;
      if (decision === 'STRIKE') strikes++;
      else if (decision === 'WATCH') watches++;
      else passes++;

      // Telegram: new STRIKE (HIGH) and STRIKE downgrade (CRITICAL)
      if (decision === 'STRIKE' && prior[0]?.decision !== 'STRIKE') {
        await sendTelegramMessage(
          `🎯 STRIKE\n\n${matchup} (${match.stage}, ${kickoffDisplay})\nMarket: ${market}\n` +
          `Best: ${ctx.best_book_american > 0 ? '+' : ''}${ctx.best_book_american} @ ${ctx.best_book}\n` +
          `Edge: +${edgePct.toFixed(1)}% (${computeStarRating(edgePct).display})\n` +
          (stake?.approved ? `Stake: $${(Number(stake.stake_cents) / 100).toFixed(0)} (Kelly ¼, ${stake.bankroll_pct.toFixed(1)}% of bankroll)\n` : 'Stake: pending bankroll allocation\n') +
          `\nWolfman: "${analysis.market_signal_summary}"\n\n→ /verdicts/${verdictId}`
        );
      } else if (prior[0]?.decision === 'STRIKE' && decision !== 'STRIKE') {
        await sendTelegramMessage(
          `⚠️ STRIKE DOWNGRADED (CRITICAL)\n\n${matchup} — ${market}\n` +
          `Previous: STRIKE\nCurrent: ${decision}\n\nReason: ${gates.failure?.explanation ?? gates.failure?.gate}\n\n` +
          `⚠️ If you already placed this bet, the market may move against you. Consider hedging or accepting the position.\n\n→ /verdicts/${verdictId}`
        );
      }
    }

    await logAgentRun({
      agent: 'ceo',
      run_phase: runPhase,
      status: 'success',
      duration_ms: Date.now() - startMs,
      match_id: matchId,
      outputs_summary: {
        verdicts_written: written, strikes, watches, passes,
        llm_cost_usd: Number(llmCost.toFixed(5))
      }
    });

    return { match_id: matchId, verdicts_written: written, strikes, watches, passes, llm_cost_usd: llmCost };
  } catch (error) {
    await logAgentRun({
      agent: 'ceo',
      run_phase: runPhase,
      status: 'failed_recoverable',
      duration_ms: Date.now() - startMs,
      match_id: matchId,
      error
    });
    throw error;
  }
}
