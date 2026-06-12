/** Factor 6 — expected rotation for teams already through (tied to motivation). */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext, QualificationStatus } from '../types';
import { NULL_EFFECT } from '../types';

function rotationPenalty(status: QualificationStatus, coef: Coefficients): number {
  if (status === 'guaranteed_first') return coef.squad_rotation.guaranteed_first;
  if (status === 'guaranteed_advance') return coef.squad_rotation.guaranteed_advance;
  return 0;
}

export function computeSquadRotation(ctx: MatchContext, coef: Coefficients): FactorEffect {
  if (ctx.tournament_stage !== 'group_md3') {
    return NULL_EFFECT(`not_matchday_3 (stage: ${ctx.tournament_stage})`);
  }
  const home = rotationPenalty(ctx.home.qualification_status, coef);
  const away = rotationPenalty(ctx.away.qualification_status, coef);
  if (home === 0 && away === 0) {
    return NULL_EFFECT('no_rotation_expected');
  }
  return {
    home_effect: home,
    away_effect: away,
    metadata: {
      home_status: ctx.home.qualification_status,
      away_status: ctx.away.qualification_status
    }
  };
}
