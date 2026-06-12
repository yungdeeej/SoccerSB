/**
 * Factor 10 — cluster injuries with Walters exponentialization.
 * Multiple absences at related positions compound non-linearly.
 */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext, PlayerAbsence } from '../types';
import { NULL_EFFECT } from '../types';

function baseGroupImpact(group: string, count: number, keyCount: number): number {
  if (count === 0) return 0;
  // Goalkeepers and key players weigh heavier
  const base = group === 'goalkeeper' ? 1.5 : 1.0;
  return base * count + 0.5 * keyCount;
}

export function computeClusterScore(absences: PlayerAbsence[], coef: Coefficients): number {
  if (absences.length === 0) return 0;
  const c = coef.cluster_injury;

  const groups = {
    forward: absences.filter((a) => a.position_group === 'forward'),
    midfielder: absences.filter((a) => a.position_group === 'midfielder'),
    defender: absences.filter((a) => a.position_group === 'defender'),
    goalkeeper: absences.filter((a) => a.position_group === 'goalkeeper')
  };

  let score = 0;
  for (const [group, missing] of Object.entries(groups)) {
    score += baseGroupImpact(group, missing.length, missing.filter((a) => a.is_key_player).length);
  }

  // Exponential clustering per Walters
  if (groups.goalkeeper.length > 0 && groups.forward.length > 0) {
    score *= c.goalkeeper_plus_attacker_multiplier;
  }
  if (groups.defender.length >= 2) {
    score *= c.two_plus_defenders_multiplier;
  }
  if (groups.midfielder.length >= 2) {
    score *= c.two_plus_midfielders_multiplier;
  }

  if (absences.some((a) => a.is_captain)) {
    score += c.captain_absence_addition;
  }

  return score;
}

export function clusterImpactAdjustment(score: number, coef: Coefficients): number {
  const c = coef.cluster_injury;
  if (score === 0) return 0;
  if (score < 1.5) return c['score_0_to_1.5'];
  if (score < 3) return c['score_1.5_to_3'];
  if (score < 5) return c.score_3_to_5;
  if (score < 7) return c.score_5_to_7;
  return c.score_7_plus;
}

export function computeClusterInjury(ctx: MatchContext, coef: Coefficients): FactorEffect {
  const home_score = ctx.home.cluster_score;
  const away_score = ctx.away.cluster_score;

  if (home_score === 0 && away_score === 0) {
    return NULL_EFFECT('no_confirmed_absences');
  }

  return {
    home_effect: clusterImpactAdjustment(home_score, coef),
    away_effect: clusterImpactAdjustment(away_score, coef),
    metadata: {
      home_cluster_score: home_score,
      away_cluster_score: away_score,
      home_absences: ctx.home.absences.map((a) => `${a.player_name} (${a.position_group}${a.is_captain ? ', C' : ''})`),
      away_absences: ctx.away.absences.map((a) => `${a.player_name} (${a.position_group}${a.is_captain ? ', C' : ''})`)
    }
  };
}
