import { describe, it, expect } from 'vitest';
import { resolveTeamCode } from '../src/agents/wolfman/team_alias';
import { inferTournamentStage, placeholderMatchId } from '../src/agents/wolfman/stage';
import { mapEventToFixture } from '../src/agents/wolfman/fixtures';
import { OddsResponseSchema, type OddsEvent } from '../src/agents/wolfman/odds_api';

describe('resolveTeamCode (alias map)', () => {
  it('resolves canonical FIFA names', () => {
    expect(resolveTeamCode('Mexico')).toBe('MEX');
    expect(resolveTeamCode('Korea Republic')).toBe('KOR');
    expect(resolveTeamCode('Turkiye')).toBe('TUR');
    expect(resolveTeamCode('Cabo Verde')).toBe('CPV');
  });

  it('resolves The Odds API spelling variants', () => {
    expect(resolveTeamCode('South Korea')).toBe('KOR');
    expect(resolveTeamCode('United States')).toBe('USA');
    expect(resolveTeamCode('USA')).toBe('USA');
    expect(resolveTeamCode('Czech Republic')).toBe('CZE');
    expect(resolveTeamCode('Turkey')).toBe('TUR');
    expect(resolveTeamCode('Cape Verde')).toBe('CPV');
    expect(resolveTeamCode('DR Congo')).toBe('COD');
    expect(resolveTeamCode('Congo DR')).toBe('COD');
    expect(resolveTeamCode('Democratic Republic of Congo')).toBe('COD');
    expect(resolveTeamCode("Côte d'Ivoire")).toBe('CIV');
    expect(resolveTeamCode('Bosnia-Herzegovina')).toBe('BIH');
    expect(resolveTeamCode('IR Iran')).toBe('IRN');
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(resolveTeamCode('  spain ')).toBe('ESP');
    expect(resolveTeamCode('CROATIA')).toBe('CRO');
  });

  it('returns null for unknown names (never auto-creates)', () => {
    expect(resolveTeamCode('Real Madrid')).toBeNull();
    expect(resolveTeamCode('Italy')).toBeNull();  // not qualified
  });
});

describe('inferTournamentStage', () => {
  it('maps the 2026 calendar to stages', () => {
    expect(inferTournamentStage(new Date('2026-06-11T18:00:00Z'))).toBe('group_md1');
    expect(inferTournamentStage(new Date('2026-06-17T23:59:00Z'))).toBe('group_md1');
    expect(inferTournamentStage(new Date('2026-06-19T18:00:00Z'))).toBe('group_md2');
    expect(inferTournamentStage(new Date('2026-06-24T18:00:00Z'))).toBe('group_md3');
    expect(inferTournamentStage(new Date('2026-06-29T18:00:00Z'))).toBe('r32');
    expect(inferTournamentStage(new Date('2026-07-05T18:00:00Z'))).toBe('r16');
    expect(inferTournamentStage(new Date('2026-07-10T18:00:00Z'))).toBe('qf');
    expect(inferTournamentStage(new Date('2026-07-14T18:00:00Z'))).toBe('sf');
    expect(inferTournamentStage(new Date('2026-07-18T18:00:00Z'))).toBe('third');
    expect(inferTournamentStage(new Date('2026-07-19T18:00:00Z'))).toBe('final');
  });
});

describe('placeholderMatchId', () => {
  it('is deterministic and positive 31-bit', () => {
    const id = placeholderMatchId('e912f3c2a01b6d8f4f4caa9d8f3e21bc');
    expect(id).toBe(placeholderMatchId('e912f3c2a01b6d8f4f4caa9d8f3e21bc'));
    expect(id).toBeGreaterThan(0);
    expect(id).toBeLessThanOrEqual(0x7fffffff);
  });

  it('differs for different event ids', () => {
    expect(placeholderMatchId('event-a')).not.toBe(placeholderMatchId('event-b'));
  });
});

// Recorded-shape Odds API response (structure matches live v4 API)
const RECORDED_EVENT = {
  id: 'e912f3c2a01b6d8f4f4caa9d8f3e21bc',
  sport_key: 'soccer_fifa_world_cup',
  commence_time: '2026-06-14T22:00:00Z',
  home_team: 'Spain',
  away_team: 'Cape Verde',
  bookmakers: [
    {
      key: 'pinnacle', title: 'Pinnacle', last_update: '2026-06-14T17:55:00Z',
      markets: [
        {
          key: 'h2h_3_way',
          outcomes: [
            { name: 'Spain', price: -380 },
            { name: 'Draw', price: 540 },
            { name: 'Cape Verde', price: 1100 }
          ]
        }
      ]
    }
  ]
};

describe('OddsResponseSchema (zod validation)', () => {
  it('accepts a recorded-shape response', () => {
    const parsed = OddsResponseSchema.safeParse([RECORDED_EVENT]);
    expect(parsed.success).toBe(true);
  });

  it('rejects malformed events', () => {
    expect(OddsResponseSchema.safeParse([{ id: 1 }]).success).toBe(false);
    expect(OddsResponseSchema.safeParse('nope').success).toBe(false);
  });
});

describe('mapEventToFixture', () => {
  const teamIds = new Map([['ESP', 'uuid-esp'], ['CPV', 'uuid-cpv']]);
  const groups = new Map([['ESP', 'H'], ['CPV', 'H']]);

  it('maps a valid event with group letter and stage', () => {
    const result = mapEventToFixture(RECORDED_EVENT as OddsEvent, teamIds, groups);
    expect('skip' in result).toBe(false);
    if ('skip' in result) return;
    expect(result.fixture.home_team_id).toBe('uuid-esp');
    expect(result.fixture.away_team_id).toBe('uuid-cpv');
    expect(result.fixture.group_letter).toBe('H');
    expect(result.fixture.tournament_stage).toBe('group_md1');
    expect(result.fixture.venue_id).toBeNull();
    expect(result.fixture.status).toBe('scheduled');
  });

  it('skips events with unknown team names', () => {
    const bad = { ...RECORDED_EVENT, home_team: 'Atlantis' };
    const result = mapEventToFixture(bad as OddsEvent, teamIds, groups);
    expect('skip' in result).toBe(true);
  });

  it('leaves group_letter null when teams are in different groups', () => {
    const crossGroup = new Map([['ESP', 'H'], ['CPV', 'A']]);
    const result = mapEventToFixture(RECORDED_EVENT as OddsEvent, teamIds, crossGroup);
    if ('skip' in result) throw new Error('should not skip');
    expect(result.fixture.group_letter).toBeNull();
  });
});
