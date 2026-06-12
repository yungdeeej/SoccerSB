/**
 * The nine discipline gates — deterministic TypeScript, executed IN ORDER.
 * First failure ends evaluation. The LLM never makes these decisions.
 * (05_AGENT_CEO.md; all thresholds per spec.)
 */
import {
  adjustedEdge, ALT_MARKETS, XI_DEPENDENT_MARKETS,
  type CEOContext, type GateResult
} from './types';

// ---------------------------------------------------------------------------
// Gate A — Edge (2.0% base; tighter by confidence / stage / market type)
// ---------------------------------------------------------------------------

export function edgeThreshold(ctx: CEOContext): number {
  let threshold = 2.0;
  if (ctx.low_confidence) threshold = 4.0;
  if (ctx.tournament_stage === 'r32') threshold = Math.max(threshold, 3.5);
  if (ctx.is_opener) threshold = Math.max(threshold, 3.0);
  if (['sf', 'final'].includes(ctx.tournament_stage)) threshold = Math.max(threshold, 2.5);
  if (ALT_MARKETS(ctx.market)) threshold = Math.max(threshold, 3.0);
  return threshold;
}

export function checkEdgeGate(ctx: CEOContext): GateResult {
  const edgePct = adjustedEdge(ctx) * 100;
  const threshold = edgeThreshold(ctx);
  if (edgePct < threshold) {
    return {
      passed: false,
      gate: 'below_edge_threshold',
      explanation: `Edge ${edgePct.toFixed(2)}% below required ${threshold.toFixed(1)}%`,
      watch_eligible: edgePct > threshold - 0.5 && edgePct >= 1.5
    };
  }
  // 2.0-2.5% borderline at base threshold → WATCH not STRIKE
  if (threshold === 2.0 && edgePct < 2.5) {
    return {
      passed: false,
      gate: 'edge_borderline',
      explanation: `Edge ${edgePct.toFixed(2)}% in 2.0-2.5% borderline band — sharp soccer markets demand cushion`,
      watch_eligible: true
    };
  }
  return { passed: true, gate: 'edge' };
}

// ---------------------------------------------------------------------------
// Gate B — Confirmation (XI-dependent markets need confirmed XIs at T-2h+)
// ---------------------------------------------------------------------------

export function checkConfirmationGate(ctx: CEOContext): GateResult {
  const xiConfidence = Math.min(ctx.tactician.home_xi_confidence_score, ctx.tactician.away_xi_confidence_score);
  if (xiConfidence < 70) {
    return {
      passed: false,
      gate: 'lineup_confidence_low',
      explanation: `Tactician XI confidence ${xiConfidence} < 70`
    };
  }
  if (!XI_DEPENDENT_MARKETS(ctx.market)) return { passed: true, gate: 'confirmation' };

  const unconfirmed =
    ctx.tactician.home_xi_status !== 'confirmed' || ctx.tactician.away_xi_status !== 'confirmed';
  if (unconfirmed && ctx.hours_to_kickoff <= 2) {
    return {
      passed: false,
      gate: 'xi_unconfirmed',
      explanation: `XI-dependent market with unconfirmed lineup at T-${ctx.hours_to_kickoff.toFixed(1)}h (${ctx.tactician.home_xi_status}/${ctx.tactician.away_xi_status})`
    };
  }
  if (unconfirmed && ctx.run_phase === 'T-12h') {
    return {
      passed: false,
      gate: 'xi_unconfirmed_early',
      explanation: 'XI-dependent market, lineups not yet confirmed at T-12h — track until confirmation',
      watch_eligible: true
    };
  }
  return { passed: true, gate: 'confirmation' };
}

// ---------------------------------------------------------------------------
// Gate C — Market (adverse steam, Pinnacle disagreement > 4%, line freeze)
// ---------------------------------------------------------------------------

export function checkMarketGate(ctx: CEOContext): GateResult {
  if (ctx.movement_direction_adverse && Math.abs(ctx.movement_last_30min_cents) > 4) {
    return {
      passed: false,
      gate: 'adverse_steam',
      explanation: `Line moved ${Math.abs(ctx.movement_last_30min_cents)}¢ against this side in the last 30min`
    };
  }
  if (ctx.pinnacle_no_vig_prob !== null) {
    const delta = Math.abs(ctx.adjusted_prob - ctx.pinnacle_no_vig_prob);
    if (delta > 0.04 + 1e-9) {
      return {
        passed: false,
        gate: 'pinnacle_disagrees',
        explanation: `Our ${(ctx.adjusted_prob * 100).toFixed(1)}% vs Pinnacle ${(ctx.pinnacle_no_vig_prob * 100).toFixed(1)}%. Gap ${(delta * 100).toFixed(1)}% > 4% on the sharpest line in sports`
      };
    }
  }
  if (ctx.line_freeze) {
    return { passed: false, gate: 'line_frozen', explanation: 'Pinnacle line frozen — uncertainty they cannot price' };
  }
  return { passed: true, gate: 'market' };
}

// ---------------------------------------------------------------------------
// Gate D — Model confidence (CI > 10% AND edge < 4%)
// ---------------------------------------------------------------------------

export function checkModelConfidenceGate(ctx: CEOContext): GateResult {
  const edgePct = adjustedEdge(ctx) * 100;
  if (ctx.quant_ci_max_width > 0.10 && edgePct < 4.0) {
    return {
      passed: false,
      gate: 'model_confidence_low',
      explanation: `Quant CI ±${(ctx.quant_ci_max_width * 100).toFixed(0)}% with only ${edgePct.toFixed(1)}% edge — uncertainty swallows the edge`
    };
  }
  return { passed: true, gate: 'model_confidence' };
}

// ---------------------------------------------------------------------------
// Gate E — Capital (bankroll, daily cap, stop-loss)
// ---------------------------------------------------------------------------

export function checkCapitalGate(ctx: CEOContext): GateResult {
  if (ctx.treasurer.stop_loss_active === 'halt') {
    return { passed: false, gate: 'stop_loss_halt', explanation: 'Stop-loss halt active — no new bets' };
  }
  if (ctx.treasurer.available_capital_cents < 2000n) {
    return {
      passed: false,
      gate: 'insufficient_capital',
      explanation: `Available capital $${(Number(ctx.treasurer.available_capital_cents) / 100).toFixed(2)} below $20 floor`
    };
  }
  if (ctx.treasurer.todays_bet_count >= ctx.treasurer.daily_bet_cap) {
    return {
      passed: false,
      gate: 'daily_cap_reached',
      explanation: `Daily bet cap reached (${ctx.treasurer.todays_bet_count}/${ctx.treasurer.daily_bet_cap})`
    };
  }
  return { passed: true, gate: 'capital' };
}

// ---------------------------------------------------------------------------
// Gate F — Tactician sanity (capped stack → WATCH; severe weather + totals/AH)
// ---------------------------------------------------------------------------

export function checkTacticianSanityGate(ctx: CEOContext): GateResult {
  const criticalFlags = ctx.tactician.flags.filter((f) => f.toUpperCase().includes('CRITICAL') || f.includes('EXTREME')).length;
  if (ctx.tactician.total_adjustment_capped && criticalFlags >= 1) {
    return {
      passed: false,
      gate: 'extreme_situational_stack',
      explanation: 'Tactician adjustment capped at ±12% with critical factors stacked — model outside calibrated envelope',
      watch_eligible: true
    };
  }
  const severeWeather = ctx.tactician.flags.some((f) => /severe|heavy_rain|>32|33°|34°|35°/i.test(f));
  if (severeWeather && (ctx.market.startsWith('total_') || ctx.market.startsWith('asian_handicap_'))) {
    return {
      passed: false,
      gate: 'severe_weather_totals',
      explanation: 'Severe weather conditions on a totals/AH market — variance outside model envelope'
    };
  }
  return { passed: true, gate: 'tactician_sanity' };
}

// ---------------------------------------------------------------------------
// Gate G — Walters discipline (one bet per match per day)
// ---------------------------------------------------------------------------

export function checkWaltersDisciplineGate(ctx: CEOContext): GateResult {
  if (ctx.already_bet_this_match_today) {
    return {
      passed: false,
      gate: 'already_bet_this_match',
      explanation: 'One bet per match per day — position already taken on this match'
    };
  }
  return { passed: true, gate: 'walters_discipline' };
}

// ---------------------------------------------------------------------------
// Gate H — Tournament stage (R32 3.5%, opener 3.0%, SF/Final 2.5%)
// ---------------------------------------------------------------------------

export function checkTournamentStageGate(ctx: CEOContext): GateResult {
  const edgePct = adjustedEdge(ctx) * 100;
  if (ctx.tournament_stage === 'r32' && edgePct < 3.5) {
    return {
      passed: false,
      gate: 'r32_format_unknown',
      explanation: 'Round of 32 has no historical precedent — 3.5% edge required'
    };
  }
  if (ctx.is_opener && edgePct < 3.0) {
    return { passed: false, gate: 'tournament_opener', explanation: 'Tournament opener — 3.0% edge required' };
  }
  if (['sf', 'final'].includes(ctx.tournament_stage) && edgePct < 2.5) {
    return { passed: false, gate: 'late_stage_low_scoring', explanation: 'SF/Final — 2.5% edge required' };
  }
  return { passed: true, gate: 'tournament_stage' };
}

// ---------------------------------------------------------------------------
// Gate I — Asian/Western divergence (totals/AH: Asian books disagree > 5%)
// ---------------------------------------------------------------------------

export function checkAsianWesternGate(ctx: CEOContext): GateResult {
  if (!ctx.market.startsWith('total_') && !ctx.market.startsWith('asian_handicap_')) {
    return { passed: true, gate: 'asian_western' };
  }
  if (!ctx.asian_western.detected || ctx.sbobet_no_vig_prob === null) {
    return { passed: true, gate: 'asian_western' };
  }
  const delta = Math.abs(ctx.adjusted_prob - ctx.sbobet_no_vig_prob);
  if (delta > 0.05) {
    return {
      passed: false,
      gate: 'asian_books_disagree',
      explanation: `Asian books imply ${(ctx.sbobet_no_vig_prob * 100).toFixed(1)}%, we have ${(ctx.adjusted_prob * 100).toFixed(1)}% — they lead on soccer totals/AH`
    };
  }
  return { passed: true, gate: 'asian_western' };
}

// ---------------------------------------------------------------------------
// Runner — gates in order, first failure ends evaluation
// ---------------------------------------------------------------------------

export const GATE_ORDER = [
  checkEdgeGate,
  checkConfirmationGate,
  checkMarketGate,
  checkModelConfidenceGate,
  checkCapitalGate,
  checkTacticianSanityGate,
  checkWaltersDisciplineGate,
  checkTournamentStageGate,
  checkAsianWesternGate
];

export interface GatesOutcome {
  passed: boolean;
  failure?: GateResult;
  allResults: GateResult[];
}

export function runAllGates(ctx: CEOContext): GatesOutcome {
  const results: GateResult[] = [];
  for (const gate of GATE_ORDER) {
    const result = gate(ctx);
    results.push(result);
    if (!result.passed) {
      return { passed: false, failure: result, allResults: results };
    }
  }
  return { passed: true, allResults: results };
}
