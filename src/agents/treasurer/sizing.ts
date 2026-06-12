/**
 * Real Kelly sizing engine — pure core + locked DB wrapper.
 * Quarter-Kelly (halved in reduced state), 3% hard cap, $20 floor,
 * 0.5x low-confidence, 0.85x knockout, daily/match caps, cooldowns.
 */
import { withMatchLock } from './locking';
import { evaluateCooldown, type CooldownState } from './cooldown';
import { getTreasurerSnapshot, type TreasurerSnapshot } from './snapshot';

export interface StakeRequest {
  match_id: string;
  market: string;
  side: string;
  adjusted_win_prob: number;
  american_odds: number;
  decimal_odds: number;
  book: string;
  edge_pct: number;
  low_confidence_flag: boolean;
  tournament_stage: string;
}

export interface StakeResponse {
  approved: boolean;
  recommended_stake_cents: bigint | null;
  kelly_fraction_full: number;
  kelly_fraction_used: number;
  bankroll_pct: number;
  cap_reasoning: string;
  rejection_reason: string | null;
  capital_snapshot: TreasurerSnapshot;
}

const KNOCKOUT_STAGES = ['r32', 'r16', 'qf', 'sf', 'third', 'final'];
const HARD_CAP_PCT = 0.03;
const FLOOR_CENTS = 2000n;
const LOW_CONFIDENCE_MULTIPLIER = 0.5;
const KNOCKOUT_MULTIPLIER = 0.85;

function rejection(
  snapshot: TreasurerSnapshot,
  reason: string,
  explanation: string,
  fullKelly = 0
): StakeResponse {
  return {
    approved: false,
    recommended_stake_cents: null,
    kelly_fraction_full: fullKelly,
    kelly_fraction_used: snapshot.current_kelly_fraction,
    bankroll_pct: 0,
    cap_reasoning: explanation,
    rejection_reason: reason,
    capital_snapshot: snapshot
  };
}

/** Pure sizing core — fully testable without a database. */
export function computeStakeFromSnapshot(
  req: StakeRequest,
  snapshot: TreasurerSnapshot,
  cooldown: CooldownState
): StakeResponse {
  if (snapshot.stop_loss_active === 'halt') {
    return rejection(snapshot, 'stop_loss_halt', 'Bankroll halt active. Manual resume required.');
  }

  const effectiveCap = cooldown.effective_cap_today !== null
    ? Math.min(snapshot.daily_bet_cap_effective, cooldown.effective_cap_today)
    : snapshot.daily_bet_cap_effective;

  if (cooldown.active && cooldown.remaining_minutes !== null) {
    return rejection(snapshot, 'cooldown_active', `${cooldown.reason} (${cooldown.remaining_minutes}min remaining)`);
  }
  if (snapshot.todays_bet_count >= effectiveCap) {
    const why = cooldown.active ? ` (${cooldown.reason})` : '';
    return rejection(snapshot, 'daily_cap_reached', `Already at ${snapshot.todays_bet_count}/${effectiveCap} bets today${why}`);
  }
  if ((snapshot.todays_bets_by_match.get(req.match_id) ?? 0) > 0) {
    return rejection(snapshot, 'match_already_bet_today', 'One bet per match per day — position already taken');
  }

  // Full Kelly
  const b = req.decimal_odds - 1;
  const p = req.adjusted_win_prob;
  const fullKelly = (b * p - (1 - p)) / b;
  if (fullKelly <= 0) {
    return rejection(snapshot, 'kelly_non_positive', 'No positive Kelly fraction at this price');
  }

  let kellyStakePct = fullKelly * snapshot.current_kelly_fraction;
  if (req.low_confidence_flag) kellyStakePct *= LOW_CONFIDENCE_MULTIPLIER;
  if (KNOCKOUT_STAGES.includes(req.tournament_stage)) kellyStakePct *= KNOCKOUT_MULTIPLIER;

  const bankrollNum = Number(snapshot.active_bankroll_cents);
  let stake_cents = BigInt(Math.round(kellyStakePct * bankrollNum));
  let cap_reasoning = `${(snapshot.current_kelly_fraction * 100).toFixed(1)}%-Kelly: ${(kellyStakePct * 100).toFixed(2)}% of bankroll`;

  const hardCap = BigInt(Math.round(HARD_CAP_PCT * bankrollNum));
  if (stake_cents > hardCap) {
    stake_cents = hardCap;
    cap_reasoning = `Capped at 3% hard cap ($${(Number(hardCap) / 100).toFixed(2)})`;
  }

  if (stake_cents < FLOOR_CENTS) {
    return rejection(
      snapshot, 'stake_below_floor',
      `Computed stake $${(Number(stake_cents) / 100).toFixed(2)} below $20 floor`,
      fullKelly
    );
  }

  if (stake_cents > snapshot.available_capital_cents) {
    if (snapshot.available_capital_cents >= FLOOR_CENTS) {
      stake_cents = snapshot.available_capital_cents;
      cap_reasoning = `Reduced to fit available capital ($${(Number(snapshot.available_capital_cents) / 100).toFixed(2)})`;
    } else {
      return rejection(snapshot, 'insufficient_capital', 'Available capital below $20 floor', fullKelly);
    }
  }

  return {
    approved: true,
    recommended_stake_cents: stake_cents,
    kelly_fraction_full: fullKelly,
    kelly_fraction_used: snapshot.current_kelly_fraction,
    bankroll_pct: bankrollNum > 0 ? (Number(stake_cents) / bankrollNum) * 100 : 0,
    cap_reasoning,
    rejection_reason: null,
    capital_snapshot: snapshot
  };
}

/** Locked, DB-backed stake calculation — the CEO/placement entry point. */
export async function calculateStake(req: StakeRequest): Promise<StakeResponse> {
  return withMatchLock(req.match_id, async () => {
    const knockout = KNOCKOUT_STAGES.includes(req.tournament_stage);
    const snapshot = await getTreasurerSnapshot(knockout);
    const cooldown = await evaluateCooldown(snapshot.active_bankroll_cents);
    return computeStakeFromSnapshot(req, snapshot, cooldown);
  });
}

/**
 * Discipline-only validation for manual bet placement (operator picks the
 * stake; the Treasurer enforces halt/caps/cooldowns/match-cap).
 */
export async function validateBetPlacement(
  match_id: string,
  knockoutStage = false
): Promise<{ allowed: boolean; reason: string | null }> {
  return withMatchLock(match_id, async () => {
    const snapshot = await getTreasurerSnapshot(knockoutStage);
    if (snapshot.stop_loss_active === 'halt') {
      return { allowed: false, reason: 'Stop-loss halt active — no new bets. /treasurer resume after review.' };
    }
    const cooldown = await evaluateCooldown(snapshot.active_bankroll_cents);
    if (cooldown.active && cooldown.remaining_minutes !== null) {
      return { allowed: false, reason: `${cooldown.reason} (${cooldown.remaining_minutes}min remaining)` };
    }
    const effectiveCap = cooldown.effective_cap_today !== null
      ? Math.min(snapshot.daily_bet_cap_effective, cooldown.effective_cap_today)
      : snapshot.daily_bet_cap_effective;
    if (snapshot.todays_bet_count >= effectiveCap) {
      return { allowed: false, reason: `Daily bet cap reached (${snapshot.todays_bet_count}/${effectiveCap})${cooldown.active ? ` — ${cooldown.reason}` : ''}` };
    }
    if ((snapshot.todays_bets_by_match.get(match_id) ?? 0) > 0) {
      return { allowed: false, reason: 'One bet per match per day — position already taken on this match' };
    }
    return { allowed: true, reason: null };
  });
}
