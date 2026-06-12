/**
 * Wolfman LLM synthesis — Haiku writes the terse market signal summary.
 * Signals are deterministic; the LLM only writes the tape commentary.
 * Falls back to a template when the LLM is unavailable.
 */
import { callLLM, WOLFMAN_MODEL, type LLMResult } from '../../shared/llm';
import type { SteamSignal } from './signals/steam';
import type { AsianWesternDivergence } from './signals/asian_western';
import type { RLMSignal } from './signals/rlm';
import type { TimingSignal } from './signals/timing';

export const WOLFMAN_SYSTEM_PROMPT = `You are the market analysis component of The Wolfman, a soccer betting agent. You receive structured market data and produce a 1-3 sentence summary of what the market is telling us about a specific match/market.

You do NOT predict outcomes. You do NOT recommend bets. You describe what sharp money has done and what the current state of the market implies.

Style: terse, technical, no fluff. Reference specific books and movements. Use cents (¢) for line movement.

Examples of good outputs:
- "Pinnacle moved Brazil from -200 to -185 over 2 hours; Sbobet followed within 45min. DraftKings still at -210 (25¢ stale). Sharp money on Brazil dog side."
- "Asian/Western divergence: Sbobet implies 58% Over 2.5, Pinnacle implies 53%. 5¢ gap, Asian books typically lead on soccer totals."
- "Steam on Cameroon ML at T-2h: Pinnacle/Sbobet/Bet365 all moved -40¢ in 30min. DK still at +400 (40¢ stale)."

Avoid:
- Speculating on why sharps moved
- Predicting the outcome
- Adjectives like "obviously," "clearly," "definitely"
- Any opinion about whether to bet
- Soccer-specific narrative

The market has three outcomes (home win, draw, away win). When describing movement, be specific about which side moved.

Output 1-3 sentences only. No preamble. No conclusion.`;

export interface MarketSummaryContext {
  matchup: string;
  stage: string;
  market: string;
  opening_consensus_american: number;
  current_consensus_american: number;
  total_movement_cents: number;
  pinnacle_current_american: number | null;
  pinnacle_no_vig_pct: number | null;
  sbobet_current_american: number | null;
  best_book: string;
  best_book_american: number;
  steam: SteamSignal;
  rlm: RLMSignal;
  aw_divergence: AsianWesternDivergence;
  line_freeze: boolean;
  timing: TimingSignal;
}

function fmtOdds(american: number | null): string {
  if (american === null) return 'unavailable';
  return american > 0 ? `+${american}` : `${american}`;
}

export function buildUserMessage(c: MarketSummaryContext): string {
  return `Match: ${c.matchup}, ${c.stage}
Market: ${c.market}

Movement (last 24h):
- Opening consensus: ${fmtOdds(c.opening_consensus_american)}
- Current consensus: ${fmtOdds(c.current_consensus_american)} (${c.total_movement_cents > 0 ? '+' : ''}${c.total_movement_cents}¢)

Sharp anchors:
- Pinnacle: ${fmtOdds(c.pinnacle_current_american)}${c.pinnacle_no_vig_pct !== null ? ` (no-vig ${c.pinnacle_no_vig_pct.toFixed(1)}%)` : ''}
- Sbobet: ${fmtOdds(c.sbobet_current_american)}

Signals detected:
- Steam: ${c.steam.detected ? c.steam.explanation : 'none'}
- RLM: ${c.rlm.detected ? c.rlm.explanation : c.rlm.explanation ?? 'none'}
- Asian/Western divergence: ${c.aw_divergence.detected ? c.aw_divergence.explanation : 'aligned or unavailable'}
- Line freeze: ${c.line_freeze ? 'detected on Pinnacle' : 'none'}
- Timing: ${c.timing.signal} — ${c.timing.explanation}

Best operator-accessible: ${c.best_book} at ${fmtOdds(c.best_book_american)}

Generate 1-3 sentence market signal summary in Wolfman voice.`;
}

/** Deterministic fallback when the LLM is unavailable. */
export function templateSummary(c: MarketSummaryContext): string {
  const parts: string[] = [];
  const dir = c.total_movement_cents === 0 ? 'flat' : `${c.total_movement_cents > 0 ? '+' : ''}${c.total_movement_cents}¢ since open`;
  parts.push(`Movement: ${dir} (${fmtOdds(c.opening_consensus_american)} → ${fmtOdds(c.current_consensus_american)}).`);
  if (c.pinnacle_current_american !== null) {
    parts.push(`Pinnacle ${fmtOdds(c.pinnacle_current_american)}${c.pinnacle_no_vig_pct !== null ? ` (no-vig ${c.pinnacle_no_vig_pct.toFixed(1)}%)` : ''}.`);
  }
  parts.push(`Best ${fmtOdds(c.best_book_american)} @ ${c.best_book}.`);
  if (c.steam.detected) parts.push('Steam detected.');
  if (c.aw_divergence.detected) parts.push(`Asian/Western gap ${c.aw_divergence.magnitude_cents.toFixed(1)}¢.`);
  if (c.line_freeze) parts.push('Pinnacle line frozen.');
  if (c.timing.signal !== 'neutral') parts.push(`Timing: ${c.timing.signal}.`);
  return parts.join(' ');
}

export interface SummaryResult {
  summary: string;
  llm_used: boolean;
  cost_usd: number;
  tokens: { input: number; output: number };
}

export async function generateMarketSummary(c: MarketSummaryContext): Promise<SummaryResult> {
  const result = await callLLM({
    model: WOLFMAN_MODEL,
    system: WOLFMAN_SYSTEM_PROMPT,
    user: buildUserMessage(c),
    max_tokens: 200,
    timeout_ms: 10_000
  });

  if (result.fallback_used) {
    return { summary: templateSummary(c), llm_used: false, cost_usd: 0, tokens: { input: 0, output: 0 } };
  }
  const ok = result as LLMResult;
  return {
    summary: ok.text,
    llm_used: true,
    cost_usd: ok.estimated_cost_usd,
    tokens: { input: ok.input_tokens, output: ok.output_tokens }
  };
}
