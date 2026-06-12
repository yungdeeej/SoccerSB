/**
 * MatchContext builder — assembles everything the 11 factor modules need.
 * Team base coordinates come from the Quant's capitals.yaml (single source).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { and, desc, eq, gte, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/index';
import { matches, teams, venues, referees, model_predictions } from '../../db/schema';
import { loadTeamProfiles } from './config';
import { classifyTeamStatus, type RemainingFixture } from './factors/motivation';
import { getLineupState } from './lineup';
import { getWeatherForecast } from './weather_api';
import type {
  GroupStandingRow, MatchContext, QualificationStatus,
  RecentMatchInfo, TeamContext, TeamProfile
} from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPITALS_PATH = join(__dirname, '../quant/config/capitals.yaml');

interface CapitalInfo { lat: number; lng: number; altitude_m: number }

let capitalsCache: Record<string, CapitalInfo> | null = null;
function loadCapitals(): Record<string, CapitalInfo> {
  if (!capitalsCache) {
    capitalsCache = parseYaml(readFileSync(CAPITALS_PATH, 'utf-8')) as Record<string, CapitalInfo>;
  }
  return capitalsCache;
}

function tzOffsetHours(timezone: string | null, at: Date): number | null {
  if (!timezone) return null;
  try {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' });
    const part = fmt.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    const m = /GMT([+-]\d+)(?::(\d+))?/.exec(part);
    if (!m) return null;
    return Number(m[1]) + (m[2] ? Math.sign(Number(m[1])) * Number(m[2]) / 60 : 0);
  } catch {
    return null;
  }
}

const NEUTRAL_PROFILE: TeamProfile = {
  press_intensity: 'mid_block', possession_orientation: 'transition',
  defensive_structure: 'mid_block', set_piece_reliance: 'moderate',
  style_directness_score: 0.5, bench_quality_z: 0, leads_protected_pct: 0.78, _todo: true
};

async function recentMatchesFor(teamId: string, before: Date): Promise<RecentMatchInfo[]> {
  const homeTeam = alias(teams, 'rh');
  const since = new Date(before.getTime() - 14 * 24 * 3600 * 1000);
  const rows = await db
    .select({
      id: matches.id,
      kickoff: matches.scheduled_kickoff_utc,
      status: matches.status,
      home_team_id: matches.home_team_id,
      home_score: matches.home_score,
      away_score: matches.away_score,
      went_to_extra_time: matches.went_to_extra_time,
      went_to_penalties: matches.went_to_penalties
    })
    .from(matches)
    .leftJoin(homeTeam, eq(matches.home_team_id, homeTeam.id))
    .where(and(
      or(eq(matches.home_team_id, teamId), eq(matches.away_team_id, teamId)),
      gte(matches.scheduled_kickoff_utc, since),
      lt(matches.scheduled_kickoff_utc, before),
      eq(matches.status, 'finished')
    ))
    .orderBy(desc(matches.scheduled_kickoff_utc));

  const result: RecentMatchInfo[] = [];
  for (const row of rows) {
    const isHome = row.home_team_id === teamId;
    let points: number | null = null;
    if (row.home_score !== null && row.away_score !== null) {
      const my = isHome ? row.home_score : row.away_score;
      const their = isHome ? row.away_score : row.home_score;
      points = my > their ? 3 : my === their ? 1 : 0;
    }
    // Expected points from the latest stored model prediction for that match
    let expected_points: number | null = null;
    const [pred] = await db
      .select({ predictions: model_predictions.predictions })
      .from(model_predictions)
      .where(eq(model_predictions.match_id, row.id))
      .orderBy(desc(model_predictions.predicted_at))
      .limit(1);
    if (pred) {
      const mo = (pred.predictions as { match_outcome?: { home_win_prob: number; draw_prob: number; away_win_prob: number } }).match_outcome;
      if (mo) {
        expected_points = isHome
          ? 3 * mo.home_win_prob + mo.draw_prob
          : 3 * mo.away_win_prob + mo.draw_prob;
      }
    }
    result.push({
      kickoff_utc: row.kickoff,
      went_to_extra_time: row.went_to_extra_time ?? false,
      went_to_penalties: row.went_to_penalties ?? false,
      points,
      expected_points
    });
  }
  return result;
}

async function groupStandings(groupLetter: string): Promise<{
  standings: GroupStandingRow[];
  remaining: RemainingFixture[];
}> {
  const home = alias(teams, 'gh');
  const away = alias(teams, 'ga');
  const rows = await db
    .select({
      home_code: home.short_name,
      away_code: away.short_name,
      home_score: matches.home_score,
      away_score: matches.away_score,
      status: matches.status,
      kickoff: matches.scheduled_kickoff_utc,
      stage: matches.tournament_stage
    })
    .from(matches)
    .innerJoin(home, eq(matches.home_team_id, home.id))
    .innerJoin(away, eq(matches.away_team_id, away.id))
    .where(eq(matches.group_letter, groupLetter));

  const table = new Map<string, GroupStandingRow>();
  const ensure = (code: string): GroupStandingRow => {
    let row = table.get(code);
    if (!row) {
      row = { team_code: code, played: 0, points: 0, goal_diff: 0, goals_for: 0 };
      table.set(code, row);
    }
    return row;
  };

  const remaining: RemainingFixture[] = [];
  for (const m of rows) {
    if (m.status === 'finished' && m.home_score !== null && m.away_score !== null) {
      const h = ensure(m.home_code);
      const a = ensure(m.away_code);
      h.played++; a.played++;
      h.goals_for += m.home_score; a.goals_for += m.away_score;
      h.goal_diff += m.home_score - m.away_score;
      a.goal_diff += m.away_score - m.home_score;
      if (m.home_score > m.away_score) h.points += 3;
      else if (m.away_score > m.home_score) a.points += 3;
      else { h.points++; a.points++; }
    } else {
      ensure(m.home_code);
      ensure(m.away_code);
      remaining.push({ home_code: m.home_code, away_code: m.away_code });
    }
  }
  return { standings: [...table.values()], remaining };
}

export async function buildMatchContext(
  matchId: string,
  runPhase: MatchContext['run_phase']
): Promise<MatchContext> {
  const homeTeam = alias(teams, 'home_t');
  const awayTeam = alias(teams, 'away_t');

  const [row] = await db
    .select({
      id: matches.id,
      stage: matches.tournament_stage,
      group_letter: matches.group_letter,
      kickoff: matches.scheduled_kickoff_utc,
      referee_id: matches.referee_id,
      home_id: homeTeam.id,
      home_code: homeTeam.short_name,
      home_sp_for: homeTeam.set_piece_goals_per_match,
      home_sp_def_z: homeTeam.set_piece_defense_z,
      away_id: awayTeam.id,
      away_code: awayTeam.short_name,
      away_sp_for: awayTeam.set_piece_goals_per_match,
      away_sp_def_z: awayTeam.set_piece_defense_z,
      venue_name: venues.name,
      venue_lat: venues.latitude,
      venue_lng: venues.longitude,
      venue_alt: venues.altitude_meters,
      venue_tz: venues.timezone
    })
    .from(matches)
    .innerJoin(homeTeam, eq(matches.home_team_id, homeTeam.id))
    .innerJoin(awayTeam, eq(matches.away_team_id, awayTeam.id))
    .leftJoin(venues, eq(matches.venue_id, venues.id))
    .where(eq(matches.id, matchId))
    .limit(1);

  if (!row) throw new Error(`Match ${matchId} not found`);

  const hoursToKickoff = (row.kickoff.getTime() - Date.now()) / 3_600_000;

  const [homeRecent, awayRecent, weather, lineup] = await Promise.all([
    recentMatchesFor(row.home_id, row.kickoff),
    recentMatchesFor(row.away_id, row.kickoff),
    getWeatherForecast(
      row.venue_lat !== null ? Number(row.venue_lat) : null,
      row.venue_lng !== null ? Number(row.venue_lng) : null,
      row.kickoff
    ),
    getLineupState(matchId, hoursToKickoff)
  ]);

  // Referee
  let referee: MatchContext['referee'] = null;
  if (row.referee_id) {
    const [ref] = await db.select().from(referees).where(eq(referees.id, row.referee_id)).limit(1);
    if (ref) {
      referee = {
        full_name: ref.full_name,
        cards_per_match: ref.cards_per_match !== null ? Number(ref.cards_per_match) : null,
        penalties_per_match: ref.penalties_per_match !== null ? Number(ref.penalties_per_match) : null,
        home_team_card_rate: ref.home_team_card_rate !== null ? Number(ref.home_team_card_rate) : null
      };
    }
  }

  // Group standings + qualification statuses (MD3 only)
  let standings: GroupStandingRow[] | null = null;
  let homeStatus: QualificationStatus = 'not_applicable';
  let awayStatus: QualificationStatus = 'not_applicable';
  if (row.stage === 'group_md3' && row.group_letter) {
    const g = await groupStandings(row.group_letter);
    standings = g.standings;
    homeStatus = classifyTeamStatus(row.home_code, g.standings, g.remaining);
    awayStatus = classifyTeamStatus(row.away_code, g.standings, g.remaining);
  }

  const profiles = loadTeamProfiles();
  const capitals = loadCapitals();
  const kickoff = row.kickoff;

  const buildTeam = (
    code: string,
    recent: RecentMatchInfo[],
    spFor: string | null,
    spDefZ: string | null,
    status: QualificationStatus,
    xi: { status: MatchContext['home']['xi_status']; conf: number; absences: MatchContext['home']['absences']; cluster: number }
  ): TeamContext => {
    const cap = capitals[code];
    const last = recent[0] ?? null;
    const rest = last ? Math.floor((kickoff.getTime() - last.kickoff_utc.getTime()) / 86_400_000) : null;
    return {
      code,
      profile: profiles[code] ?? NEUTRAL_PROFILE,
      base_lat: cap?.lat ?? null,
      base_lng: cap?.lng ?? null,
      base_tz_offset_hours: cap ? Math.round(cap.lng / 15) : null,
      // Proxy until training-camp itineraries are tracked: rest days at venue, clamped
      days_at_venue: rest !== null ? Math.min(7, Math.max(0, rest)) : 3,
      capital_altitude_m: cap?.altitude_m ?? 0,
      recent_matches: recent,
      rest_days: rest,
      prev_match_extra_time: last?.went_to_extra_time ?? false,
      prev_match_penalties: last?.went_to_penalties ?? false,
      xi_status: xi.status,
      xi_confidence: xi.conf,
      absences: xi.absences,
      cluster_score: xi.cluster,
      qualification_status: status,
      cards_per_match: null,  // populates from API-Football referee/discipline data later
      set_piece_goals_for: spFor !== null ? Number(spFor) : null,
      set_piece_goals_against: null,  // not yet tracked
      set_piece_defense_z: spDefZ !== null ? Number(spDefZ) : null
    };
  };

  return {
    match_id: matchId,
    tournament_stage: row.stage,
    kickoff_utc: kickoff,
    venue: {
      name: row.venue_name,
      latitude: row.venue_lat !== null ? Number(row.venue_lat) : null,
      longitude: row.venue_lng !== null ? Number(row.venue_lng) : null,
      altitude_meters: row.venue_alt ?? 0,
      tz_offset_hours: tzOffsetHours(row.venue_tz, kickoff)
    },
    home: buildTeam(row.home_code, homeRecent, row.home_sp_for, row.home_sp_def_z, homeStatus, {
      status: lineup.home_xi_status, conf: lineup.home_xi_confidence,
      absences: lineup.home_absences, cluster: lineup.home_cluster_score
    }),
    away: buildTeam(row.away_code, awayRecent, row.away_sp_for, row.away_sp_def_z, awayStatus, {
      status: lineup.away_xi_status, conf: lineup.away_xi_confidence,
      absences: lineup.away_absences, cluster: lineup.away_cluster_score
    }),
    weather,
    referee,
    group_letter: row.group_letter,
    group_standings: standings,
    flagged_concerns: lineup.flagged_concerns,
    run_phase: runPhase
  };
}
