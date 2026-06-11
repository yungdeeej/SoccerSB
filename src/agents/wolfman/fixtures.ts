/**
 * Fixtures ingestion — populates `matches` from The Odds API (lean philosophy:
 * fixtures are fetched live, never seeded).
 *
 * Runs once on deployment, then daily at 4am MT to catch kickoff shifts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { matches, teams } from '../../db/schema';
import { fetchWorldCupOdds, type OddsEvent } from './odds_api';
import { resolveTeamCode } from './team_alias';
import { inferTournamentStage, placeholderMatchId } from './stage';
import { logAgentRun } from './agent_log';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadGroupByCode(): Map<string, string> {
  const raw = readFileSync(join(__dirname, '../../shared/config/groups.json'), 'utf-8');
  const groups = JSON.parse(raw) as Record<string, string[]>;
  const map = new Map<string, string>();
  for (const [letter, codes] of Object.entries(groups)) {
    for (const code of codes) map.set(code, letter);
  }
  return map;
}

export interface FixtureSyncResult {
  events_received: number;
  matches_inserted: number;
  matches_updated: number;
  skipped_unknown_teams: string[];
  credits_remaining: number | null;
}

/** Resolve an event into a row shape, or a skip reason. */
export function mapEventToFixture(
  event: OddsEvent,
  teamIdByCode: Map<string, string>,
  groupByCode: Map<string, string>
): { fixture: typeof matches.$inferInsert; homeCode: string; awayCode: string } | { skip: string } {
  const homeCode = resolveTeamCode(event.home_team);
  const awayCode = resolveTeamCode(event.away_team);

  if (!homeCode || !awayCode) {
    return { skip: `unresolvable team name(s): "${event.home_team}" vs "${event.away_team}"` };
  }

  const home_team_id = teamIdByCode.get(homeCode);
  const away_team_id = teamIdByCode.get(awayCode);
  if (!home_team_id || !away_team_id) {
    return { skip: `team code not in DB: ${homeCode}/${awayCode}` };
  }

  const kickoff = new Date(event.commence_time);
  if (Number.isNaN(kickoff.getTime())) {
    return { skip: `invalid commence_time: ${event.commence_time}` };
  }

  const homeGroup = groupByCode.get(homeCode);
  const awayGroup = groupByCode.get(awayCode);
  const stage = inferTournamentStage(kickoff);
  const isGroupStage = stage.startsWith('group_');

  return {
    homeCode,
    awayCode,
    fixture: {
      fifa_match_id: placeholderMatchId(event.id),
      home_team_id,
      away_team_id,
      venue_id: null,  // The Odds API doesn't provide venues — FIFA backfill later
      tournament_stage: stage,
      group_letter: isGroupStage && homeGroup && homeGroup === awayGroup ? homeGroup : null,
      scheduled_kickoff_utc: kickoff,
      status: 'scheduled'
    }
  };
}

export async function syncFixtures(): Promise<FixtureSyncResult> {
  const started = Date.now();
  try {
    const { events, creditsRemaining, creditsUsed } = await fetchWorldCupOdds();

    const allTeams = await db
      .select({ id: teams.id, short_name: teams.short_name })
      .from(teams);
    const teamIdByCode = new Map(allTeams.map((t) => [t.short_name, t.id]));
    const groupByCode = loadGroupByCode();

    let inserted = 0;
    let updated = 0;
    const skipped: string[] = [];

    for (const event of events) {
      const mapped = mapEventToFixture(event, teamIdByCode, groupByCode);
      if ('skip' in mapped) {
        skipped.push(mapped.skip);
        console.error(`fixtures: SKIP — ${mapped.skip}`);
        continue;
      }

      const existing = await db
        .select({ id: matches.id })
        .from(matches)
        .where(eq(matches.fifa_match_id, mapped.fixture.fifa_match_id))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(matches).values(mapped.fixture);
        inserted++;
      } else {
        // Kickoff times and stages can shift — keep them fresh
        await db.update(matches)
          .set({
            scheduled_kickoff_utc: mapped.fixture.scheduled_kickoff_utc,
            tournament_stage: mapped.fixture.tournament_stage,
            group_letter: mapped.fixture.group_letter,
            updated_at: new Date()
          })
          .where(eq(matches.id, existing[0].id));
        updated++;
      }
    }

    const result: FixtureSyncResult = {
      events_received: events.length,
      matches_inserted: inserted,
      matches_updated: updated,
      skipped_unknown_teams: skipped,
      credits_remaining: creditsRemaining
    };

    await logAgentRun({
      agent: 'wolfman',
      run_phase: 'fixtures_sync',
      status: skipped.length > 0 ? 'failed_recoverable' : 'success',
      duration_ms: Date.now() - started,
      outputs_summary: { ...result, api_credits_used: creditsUsed }
    });

    return result;
  } catch (err) {
    await logAgentRun({
      agent: 'wolfman',
      run_phase: 'fixtures_sync',
      status: 'failed_fatal',
      duration_ms: Date.now() - started,
      error: err
    });
    throw err;
  }
}
