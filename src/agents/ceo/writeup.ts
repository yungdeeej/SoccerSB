/**
 * CEO Walters-voice writeup — Sonnet writes the rationale; the DECISION was
 * already made by deterministic gates. Template fallback when LLM unavailable.
 * Cost guard: LLM only for STRIKE/WATCH; PASS verdicts use the template.
 */
import { callLLM, CEO_MODEL, type LLMResult } from '../../shared/llm';
import { adjustedEdge, type CEOContext, type Decision, type GateResult } from './types';

export const CEO_SYSTEM_PROMPT = `You are "Billy Walters," executive head of an international soccer betting syndicate during the 2026 FIFA World Cup. Your job in this call is to write the executive verdict rationale for a single market on a single match.

The decision (STRIKE / WATCH / PASS) has ALREADY been made by deterministic gate logic. You do NOT change the decision. You write the rationale that explains it in the Walters voice.

VOICE GUIDELINES:
- Cold, terse, peer-to-peer with the operator
- Reference data, never feelings
- No exclamation points, no hyperbole, no emojis
- Short sentences, active voice
- "Pass" is strong; use it without apology
- Cite agent outputs: "The Tactician shows..." "Wolfman's tape indicates..."
- Three-way thinking: be specific about home/draw/away
- Don't predict scorelines
- No soccer journalism vocabulary ("brilliant", "deserved")

OUTPUT FORMAT:
For STRIKE: one paragraph (~3-5 sentences) explaining why this bet, why this size, why this book, why now.
For WATCH: one paragraph explaining what we're tracking and what trigger would shift to STRIKE.
For PASS: one paragraph explaining which gate failed and why deferring is correct.

You receive structured context with all relevant data. Use it. Do not invent.`;

export interface WriteupContext {
  decision: Decision;
  ctx: CEOContext;
  failure: GateResult | null;
  stars: number;
  stake_dollars: number | null;
  matchup: string;
  kickoff_display: string;
  wolfman_summary: string;
  factor_summary: string;
}

function fmtOdds(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

export function buildWriteupUserMessage(w: WriteupContext): string {
  const edgePct = (adjustedEdge(w.ctx) * 100).toFixed(2);
  const t = w.ctx.tactician;
  return `DECISION: ${w.decision}
${w.decision === 'STRIKE' ? `Recommended: ${w.ctx.side} ${fmtOdds(w.ctx.best_book_american)} @ ${w.ctx.best_book}, stake $${w.stake_dollars}, ${w.stars} stars` : ''}
${w.decision !== 'STRIKE' && w.failure ? `Failed gate: ${w.failure.gate} — ${w.failure.explanation ?? ''}` : ''}

MATCH: ${w.matchup} | ${w.ctx.tournament_stage} | ${w.kickoff_display}
MARKET: ${w.ctx.market} (${w.ctx.side})

TACTICIAN'S INTEL:
- XI status: ${t.home_xi_status} (home) / ${t.away_xi_status} (away)
- Cluster scores: ${t.home_cluster_score.toFixed(1)} / ${t.away_cluster_score.toFixed(1)}
- Concerns: ${t.flagged_lineup_concerns.join('; ') || 'none'}

TACTICIAN'S DELTA:
${w.factor_summary}
Net advantage home: ${(t.combined_advantage_home * 100).toFixed(1)}%${t.total_adjustment_capped ? ' (CAPPED ±12%)' : ''}

QUANT'S READ (Tactician-adjusted):
- Adjusted probability this side: ${(w.ctx.adjusted_prob * 100).toFixed(1)}%
- Best price: ${fmtOdds(w.ctx.best_book_american)} (${w.ctx.best_book})
- Adjusted edge: ${edgePct}%
- Low confidence flag: ${w.ctx.low_confidence}

WOLFMAN'S TAPE:
- ${w.wolfman_summary}
- Pinnacle no-vig: ${w.ctx.pinnacle_no_vig_prob !== null ? (w.ctx.pinnacle_no_vig_prob * 100).toFixed(1) + '%' : 'unavailable'}
- 30min movement: ${w.ctx.movement_last_30min_cents}¢${w.ctx.movement_direction_adverse ? ' (adverse)' : ''}

Write the Walters executive verdict rationale. One paragraph.`;
}

/** Deterministic fallback templates — cold, accurate, no LLM required. */
export function templateWriteup(w: WriteupContext): string {
  const edgePct = (adjustedEdge(w.ctx) * 100).toFixed(2);
  const pinDelta = w.ctx.pinnacle_no_vig_prob !== null
    ? Math.abs(w.ctx.adjusted_prob - w.ctx.pinnacle_no_vig_prob) * 100
    : null;

  if (w.decision === 'STRIKE') {
    return `Edge ${edgePct}% on ${w.ctx.side} at ${w.ctx.best_book} ${fmtOdds(w.ctx.best_book_american)}. ` +
      `${w.factor_summary || 'No major situational factors.'} ` +
      `${pinDelta !== null ? `Pinnacle within ${pinDelta.toFixed(1)}%.` : 'Pinnacle anchor unavailable.'} ` +
      `${w.stars} stars. Stake $${w.stake_dollars}. Strike with sizing.`;
  }
  if (w.decision === 'WATCH') {
    return `Watch. ${w.failure?.explanation ?? w.failure?.gate ?? 'Borderline.'} ` +
      `Trigger to revisit: ${watchTrigger(w.failure)}.`;
  }
  return `Pass. ${w.failure?.gate ?? 'gate failure'}: ${w.failure?.explanation ?? 'discipline gate failed'}. ` +
    `The market beats the bettor most days — no edge, no bet.`;
}

export function watchTrigger(failure: GateResult | null): string {
  switch (failure?.gate) {
    case 'edge_borderline':
    case 'below_edge_threshold':
      return 'line drift toward our side pushing edge above threshold before kickoff';
    case 'xi_unconfirmed_early':
      return 'official XI confirmation (~T-90min)';
    case 'extreme_situational_stack':
      return 'manual review of stacked factors confirming the adjustment is real';
    default:
      return 're-evaluation at next checkpoint';
  }
}

export interface WriteupResult {
  writeup: string;
  llm_used: boolean;
  cost_usd: number;
}

export async function generateVerdictWriteup(w: WriteupContext): Promise<WriteupResult> {
  // Cost guard: PASS verdicts always use the deterministic template
  if (w.decision === 'PASS') {
    return { writeup: templateWriteup(w), llm_used: false, cost_usd: 0 };
  }

  const result = await callLLM({
    model: CEO_MODEL,
    system: CEO_SYSTEM_PROMPT,
    user: buildWriteupUserMessage(w),
    max_tokens: 500,
    timeout_ms: 20_000
  });

  if (result.fallback_used) {
    return { writeup: templateWriteup(w), llm_used: false, cost_usd: 0 };
  }
  const ok = result as LLMResult;
  return { writeup: ok.text, llm_used: true, cost_usd: ok.estimated_cost_usd };
}
