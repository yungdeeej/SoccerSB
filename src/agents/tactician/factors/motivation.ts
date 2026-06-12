/**
 * Factor 5 — Matchday 3 motivation differential. The canonical Walters
 * tournament edge (Brazil-Cameroon 2022). Only fires at group_md3.
 *
 * Qualification status comes from brute-force simulation of the group's
 * remaining Matchday 3 outcomes (exported here as a pure helper; the context
 * builder invokes it, the factor maps statuses to effects).
 */
import type { Coefficients } from '../config';
import type { FactorEffect, GroupStandingRow, MatchContext, QualificationStatus } from '../types';
import { NULL_EFFECT } from '../types';

export interface RemainingFixture {
  home_code: string;
  away_code: string;
}

/**
 * Score proxies per simulated outcome. Margins matter: a "guarantee" must
 * survive extreme goal-difference swings (e.g., a rival winning 4-0), so wins
 * are simulated at both 1-goal and 4-goal margins.
 */
const OUTCOME_SCORES: Array<[number, number]> = [
  [1, 0],  // narrow home win
  [4, 0],  // big home win
  [1, 1],  // draw
  [0, 1],  // narrow away win
  [0, 4]   // big away win
];

function rankTable(rows: GroupStandingRow[]): string[] {
  return [...rows]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.goal_diff - a.goal_diff ||
        b.goals_for - a.goals_for ||
        a.team_code.localeCompare(b.team_code)
    )
    .map((r) => r.team_code);
}

/**
 * Classify a team's qualification status before Matchday 3 by simulating all
 * 3^n outcomes of the group's remaining fixtures.
 */
export function classifyTeamStatus(
  team_code: string,
  standings: GroupStandingRow[],
  remaining: RemainingFixture[]
): QualificationStatus {
  if (remaining.length === 0 || remaining.length > 3) return 'not_applicable';

  const scenarios = Math.pow(OUTCOME_SCORES.length, remaining.length);
  let alwaysFirst = true;
  let alwaysTop2 = true;
  let neverTop2 = true;
  let maxPoints = standings.find((r) => r.team_code === team_code)?.points ?? 0;

  for (let s = 0; s < scenarios; s++) {
    const table = new Map(standings.map((r) => [r.team_code, { ...r }]));
    let digits = s;
    for (const fixture of remaining) {
      const outcome = OUTCOME_SCORES[digits % OUTCOME_SCORES.length];
      digits = Math.floor(digits / OUTCOME_SCORES.length);
      const [hg, ag] = outcome;
      const home = table.get(fixture.home_code);
      const away = table.get(fixture.away_code);
      if (!home || !away) continue;
      home.played += 1;
      away.played += 1;
      home.goals_for += hg;
      away.goals_for += ag;
      home.goal_diff += hg - ag;
      away.goal_diff += ag - hg;
      if (hg > ag) home.points += 3;
      else if (ag > hg) away.points += 3;
      else {
        home.points += 1;
        away.points += 1;
      }
    }
    const ranked = rankTable([...table.values()]);
    const rank = ranked.indexOf(team_code) + 1;
    if (rank !== 1) alwaysFirst = false;
    if (rank > 2) alwaysTop2 = false;
    if (rank <= 2) neverTop2 = false;
    const pts = table.get(team_code)?.points ?? 0;
    maxPoints = Math.max(maxPoints, pts);
  }

  if (alwaysFirst) return 'guaranteed_first';
  if (alwaysTop2) return 'guaranteed_advance';
  if (neverTop2) {
    // 48-team format: best 8 third-place teams advance. A points ceiling of 4+
    // keeps best-third plausible → still fighting; below that, pride only.
    return maxPoints >= 4 ? 'fighting' : 'eliminated_with_pride';
  }
  return 'fighting';
}

const LOCKED: QualificationStatus[] = ['guaranteed_first', 'guaranteed_advance'];
const OUT: QualificationStatus[] = ['eliminated', 'eliminated_with_pride'];

export function computeMotivation(ctx: MatchContext, coef: Coefficients): FactorEffect {
  if (ctx.tournament_stage !== 'group_md3') {
    return NULL_EFFECT(`not_matchday_3 (stage: ${ctx.tournament_stage})`);
  }
  const home = ctx.home.qualification_status;
  const away = ctx.away.qualification_status;
  if (home === 'not_applicable' || away === 'not_applicable') {
    return NULL_EFFECT('standings_unavailable');
  }

  const c = coef.motivation;
  const meta = { home_status: home, away_status: away };

  if (home === 'fighting' && LOCKED.includes(away)) {
    return {
      home_effect: c.fighting_vs_guaranteed_advance_motivated_team,
      away_effect: c.fighting_vs_guaranteed_advance_locked_team,
      metadata: meta
    };
  }
  if (away === 'fighting' && LOCKED.includes(home)) {
    return {
      home_effect: c.fighting_vs_guaranteed_advance_locked_team,
      away_effect: c.fighting_vs_guaranteed_advance_motivated_team,
      metadata: meta
    };
  }
  if (home === 'fighting' && OUT.includes(away)) {
    return { home_effect: c.eliminated_vs_fighting_motivated_team, away_effect: 0, metadata: meta };
  }
  if (away === 'fighting' && OUT.includes(home)) {
    return { home_effect: 0, away_effect: c.eliminated_vs_fighting_motivated_team, metadata: meta };
  }
  if (LOCKED.includes(home) && LOCKED.includes(away)) {
    return {
      home_effect: 0,
      away_effect: 0,
      ci_widening: c.both_guaranteed_first_ci_widening,
      metadata: { ...meta, note: 'both locked — rotation lottery, high variance' }
    };
  }
  return { home_effect: 0, away_effect: 0, metadata: meta };
}
