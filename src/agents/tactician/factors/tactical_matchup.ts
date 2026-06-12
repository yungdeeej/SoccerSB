/** Factor 7 — style-vs-style matchup matrix (03_AGENT_TACTICIAN.md). */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext, TeamProfile } from '../types';

function pairEffects(
  attacker: TeamProfile,
  defender: TeamProfile,
  coef: Coefficients
): { attacker_effect: number; notes: string[] } {
  const c = coef.tactical_matchup;
  let effect = 0;
  const notes: string[] = [];

  // High press blunted by a deep block
  if (attacker.press_intensity === 'high' && defender.defensive_structure === 'deep_block') {
    effect += c.press_vs_deep_block;
    notes.push('high press vs deep block');
  }
  // Direct attack thrives against a high line
  if (attacker.possession_orientation === 'direct' && defender.defensive_structure === 'high_line') {
    effect += c.direct_vs_high_line;
    notes.push('direct vs high line');
  }
  // Heavy set-piece side vs poor set-piece defender
  if (attacker.set_piece_reliance === 'heavy') {
    notes.push('set-piece reliance (defender quality checked separately)');
  }
  // Possession side bleeds against transition opponents in tournament play
  if (attacker.possession_orientation === 'possession' && defender.possession_orientation === 'transition') {
    effect += c.possession_vs_transition;
    notes.push('possession vs transition');
  }

  return { attacker_effect: effect, notes };
}

export function computeTacticalMatchup(ctx: MatchContext, coef: Coefficients): FactorEffect {
  const home = pairEffects(ctx.home.profile, ctx.away.profile, coef);
  const away = pairEffects(ctx.away.profile, ctx.home.profile, coef);

  // Set-piece reliance vs poor set-piece defense (needs defender z-score)
  let homeSetPiece = 0;
  let awaySetPiece = 0;
  if (ctx.home.profile.set_piece_reliance === 'heavy' && (ctx.away.set_piece_defense_z ?? 0) < -0.5) {
    homeSetPiece = coef.tactical_matchup.set_piece_vs_poor_defender;
  }
  if (ctx.away.profile.set_piece_reliance === 'heavy' && (ctx.home.set_piece_defense_z ?? 0) < -0.5) {
    awaySetPiece = coef.tactical_matchup.set_piece_vs_poor_defender;
  }

  return {
    home_effect: home.attacker_effect + homeSetPiece,
    away_effect: away.attacker_effect + awaySetPiece,
    metadata: {
      home_notes: home.notes,
      away_notes: away.notes,
      home_profile_todo: ctx.home.profile._todo ?? false,
      away_profile_todo: ctx.away.profile._todo ?? false
    }
  };
}
