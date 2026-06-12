/** Factor module tests — each of the 11 with representative inputs. */
import { describe, it, expect } from 'vitest';
import { loadCoefficients } from '../src/agents/tactician/config';
import { computeRestDays } from '../src/agents/tactician/factors/rest_days';
import { computeTravel } from '../src/agents/tactician/factors/travel';
import { computeAltitude } from '../src/agents/tactician/factors/altitude';
import { computeWeather } from '../src/agents/tactician/factors/weather';
import { computeMotivation } from '../src/agents/tactician/factors/motivation';
import { computeSquadRotation } from '../src/agents/tactician/factors/squad_rotation';
import { computeTacticalMatchup } from '../src/agents/tactician/factors/tactical_matchup';
import { computeSetPiece } from '../src/agents/tactician/factors/set_piece';
import { computeReferee } from '../src/agents/tactician/factors/referee';
import { computeClusterInjury, computeClusterScore, clusterImpactAdjustment } from '../src/agents/tactician/factors/cluster_injury';
import { computeRecentForm } from '../src/agents/tactician/factors/recent_form';
import type { MatchContext, PlayerAbsence, TeamContext, TeamProfile } from '../src/agents/tactician/types';

const coef = loadCoefficients();

const PROFILE: TeamProfile = {
  press_intensity: 'mid_block', possession_orientation: 'transition',
  defensive_structure: 'mid_block', set_piece_reliance: 'moderate',
  style_directness_score: 0.5, bench_quality_z: 0, leads_protected_pct: 0.78
};

function team(overrides: Partial<TeamContext> = {}): TeamContext {
  return {
    code: 'AAA', profile: { ...PROFILE }, base_lat: 40, base_lng: -74,
    base_tz_offset_hours: -5, days_at_venue: 3, capital_altitude_m: 50,
    recent_matches: [], rest_days: 4, prev_match_extra_time: false,
    prev_match_penalties: false, xi_status: 'projected', xi_confidence: 100,
    absences: [], cluster_score: 0, qualification_status: 'not_applicable',
    cards_per_match: null, set_piece_goals_for: null, set_piece_goals_against: null,
    set_piece_defense_z: null,
    ...overrides
  };
}

function ctx(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    match_id: 'm1', tournament_stage: 'group_md1',
    kickoff_utc: new Date('2026-06-14T22:00:00Z'),
    venue: { name: 'Test', latitude: 25.958, longitude: -80.2389, altitude_meters: 2, tz_offset_hours: -4 },
    home: team({ code: 'HHH' }), away: team({ code: 'AAA' }),
    weather: null, referee: null, group_letter: null, group_standings: null,
    flagged_concerns: [], run_phase: 'manual',
    ...overrides
  };
}

describe('rest_days', () => {
  it('equal rest → zero', () => {
    const r = computeRestDays(ctx(), coef);
    expect(r.home_effect).toBeCloseTo(0, 12);
    expect(r.away_effect).toBeCloseTo(0, 12);
  });

  it('+2 days to home → +3% home, -3% away', () => {
    const c = ctx({ home: team({ rest_days: 5 }), away: team({ rest_days: 3 }) });
    const r = computeRestDays(c, coef);
    expect(r.home_effect).toBeCloseTo(0.03, 10);
    expect(r.away_effect).toBeCloseTo(-0.03, 10);
  });

  it('caps at +3 days', () => {
    const c = ctx({ home: team({ rest_days: 10 }), away: team({ rest_days: 3 }) });
    expect(computeRestDays(c, coef).home_effect).toBeCloseTo(0.045, 10);
  });

  it('extra time + shootout hangover stacks', () => {
    const c = ctx({ away: team({ prev_match_extra_time: true, prev_match_penalties: true }) });
    const r = computeRestDays(c, coef);
    expect(r.away_effect).toBeCloseTo(-0.025, 10);
  });

  it('unknown rest → null effect', () => {
    const c = ctx({ home: team({ rest_days: null }) });
    expect(computeRestDays(c, coef).home_effect).toBe(0);
    expect(computeRestDays(c, coef).metadata.reason).toContain('rest_days_unknown');
  });
});

describe('travel', () => {
  it('long haul penalized, acclimation halves it', () => {
    // Tokyo base (~12,000km to Miami, 13 zones) — fresh arrival
    const fresh = ctx({ home: team({ base_lat: 35.68, base_lng: 139.69, base_tz_offset_hours: 9, days_at_venue: 0 }) });
    const acclimated = ctx({ home: team({ base_lat: 35.68, base_lng: 139.69, base_tz_offset_hours: 9, days_at_venue: 5 }) });
    const f = computeTravel(fresh, coef);
    const a = computeTravel(acclimated, coef);
    expect(f.home_effect).toBeCloseTo(-0.03 + -0.025, 10);
    expect(a.home_effect).toBeCloseTo(f.home_effect * 0.5, 10);
  });

  it('short trip → no penalty', () => {
    const c = ctx({ home: team({ base_lat: 26.0, base_lng: -80.0, base_tz_offset_hours: -5 }) });
    expect(computeTravel(c, coef).home_effect).toBe(0);
  });

  it('unknown venue → null effect', () => {
    const c = ctx({ venue: { name: null, latitude: null, longitude: null, altitude_meters: 0, tz_offset_hours: null } });
    expect(computeTravel(c, coef).metadata.reason).toBe('venue_unknown');
  });
});

describe('altitude', () => {
  it('below 1500m venue → null effect', () => {
    expect(computeAltitude(ctx(), coef).metadata.reason).toBe('venue_below_1500m');
  });

  it('partial acclimation (5-10 days) at altitude gets the half bonus', () => {
    const c = ctx({
      venue: { name: 'Akron', latitude: 20.68, longitude: -103.46, altitude_meters: 1550, tz_offset_hours: -6 },
      home: team({ days_at_venue: 6, capital_altitude_m: 50 }),
      away: team({ days_at_venue: 1, capital_altitude_m: 50 })
    });
    const r = computeAltitude(c, coef);
    expect(r.home_effect).toBeCloseTo(0.015 * 0.5, 10);
    expect(r.away_effect).toBe(0);
  });

  it('fully acclimated team gets nothing extra (Quant handles)', () => {
    const c = ctx({
      venue: { name: 'Azteca', latitude: 19.3, longitude: -99.15, altitude_meters: 2240, tz_offset_hours: -6 },
      home: team({ capital_altitude_m: 2240, days_at_venue: 7 })
    });
    expect(computeAltitude(c, coef).home_effect).toBe(0);
  });
});

describe('weather', () => {
  it('null weather → null effect', () => {
    expect(computeWeather(ctx(), coef).metadata.reason).toBe('weather_unavailable');
  });

  it('heat favors deeper bench', () => {
    const c = ctx({
      weather: { temp_c: 35, condition: 'clear', wind_kph: 5, humidity_pct: 60, source: 'openweather' },
      home: team({ profile: { ...PROFILE, bench_quality_z: 1.5 } }),
      away: team({ profile: { ...PROFILE, bench_quality_z: -0.5 } })
    });
    const r = computeWeather(c, coef);
    expect(r.home_effect).toBeCloseTo(0.02, 10);
    expect(r.away_effect).toBeCloseTo(-0.02, 10);
  });

  it('heavy rain boosts BTTS and favors direct teams', () => {
    const c = ctx({
      weather: { temp_c: 18, condition: 'heavy_rain', wind_kph: 10, humidity_pct: 90, source: 'openweather' },
      home: team({ profile: { ...PROFILE, style_directness_score: 0.8 } }),
      away: team({ profile: { ...PROFILE, style_directness_score: 0.2 } })
    });
    const r = computeWeather(c, coef);
    expect(r.btts_modifier).toBeCloseTo(0.02, 10);
    expect(r.home_effect).toBeGreaterThan(0);
  });

  it('benign conditions → null effect', () => {
    const c = ctx({ weather: { temp_c: 20, condition: 'clear', wind_kph: 8, humidity_pct: 50, source: 'openweather' } });
    expect(computeWeather(c, coef).home_effect).toBe(0);
  });
});

describe('motivation (the Matchday 3 edge)', () => {
  it('only fires at group_md3', () => {
    const c = ctx({ home: team({ qualification_status: 'fighting' }), away: team({ qualification_status: 'guaranteed_first' }) });
    expect(computeMotivation(c, coef).metadata.reason).toContain('not_matchday_3');
  });

  it('fighting vs locked: the canonical Brazil-Cameroon shape', () => {
    const c = ctx({
      tournament_stage: 'group_md3',
      home: team({ qualification_status: 'guaranteed_first' }),
      away: team({ qualification_status: 'fighting' })
    });
    const r = computeMotivation(c, coef);
    expect(r.home_effect).toBeCloseTo(-0.02, 10);
    expect(r.away_effect).toBeCloseTo(0.05, 10);
  });

  it('both fighting → no edge', () => {
    const c = ctx({
      tournament_stage: 'group_md3',
      home: team({ qualification_status: 'fighting' }),
      away: team({ qualification_status: 'fighting' })
    });
    const r = computeMotivation(c, coef);
    expect(r.home_effect).toBe(0);
    expect(r.away_effect).toBe(0);
  });

  it('both locked → CI widening, no directional edge', () => {
    const c = ctx({
      tournament_stage: 'group_md3',
      home: team({ qualification_status: 'guaranteed_first' }),
      away: team({ qualification_status: 'guaranteed_advance' })
    });
    const r = computeMotivation(c, coef);
    expect(r.ci_widening).toBeCloseTo(0.15, 10);
  });

  it('eliminated vs fighting → smaller edge to fighting side', () => {
    const c = ctx({
      tournament_stage: 'group_md3',
      home: team({ qualification_status: 'eliminated_with_pride' }),
      away: team({ qualification_status: 'fighting' })
    });
    expect(computeMotivation(c, coef).away_effect).toBeCloseTo(0.03, 10);
  });
});

describe('squad_rotation', () => {
  it('guaranteed_first rotates hardest', () => {
    const c = ctx({
      tournament_stage: 'group_md3',
      home: team({ qualification_status: 'guaranteed_first' }),
      away: team({ qualification_status: 'fighting' })
    });
    const r = computeSquadRotation(c, coef);
    expect(r.home_effect).toBeCloseTo(-0.04, 10);
    expect(r.away_effect).toBe(0);
  });

  it('non-MD3 → null', () => {
    expect(computeSquadRotation(ctx(), coef).metadata.reason).toContain('not_matchday_3');
  });
});

describe('tactical_matchup', () => {
  it('high press blunted by deep block', () => {
    const c = ctx({
      home: team({ profile: { ...PROFILE, press_intensity: 'high' } }),
      away: team({ profile: { ...PROFILE, defensive_structure: 'deep_block' } })
    });
    expect(computeTacticalMatchup(c, coef).home_effect).toBeCloseTo(-0.015, 10);
  });

  it('direct attack thrives vs high line', () => {
    const c = ctx({
      home: team({ profile: { ...PROFILE, possession_orientation: 'direct' } }),
      away: team({ profile: { ...PROFILE, defensive_structure: 'high_line' } })
    });
    expect(computeTacticalMatchup(c, coef).home_effect).toBeCloseTo(0.02, 10);
  });

  it('heavy set-piece side vs poor set-piece defense', () => {
    const c = ctx({
      home: team({ profile: { ...PROFILE, set_piece_reliance: 'heavy' } }),
      away: team({ set_piece_defense_z: -1.0 })
    });
    expect(computeTacticalMatchup(c, coef).home_effect).toBeCloseTo(0.015, 10);
  });
});

describe('set_piece', () => {
  it('missing stats → null effect', () => {
    expect(computeSetPiece(ctx(), coef).metadata.reason).toContain('set_piece_stats_unavailable');
  });

  it('net edge becomes xG + totals modifiers', () => {
    const c = ctx({
      home: team({ set_piece_goals_for: 0.5, set_piece_goals_against: 0.2 }),
      away: team({ set_piece_goals_for: 0.2, set_piece_goals_against: 0.4 })
    });
    const r = computeSetPiece(c, coef);
    // home edge = (0.5 - 0.4)/2 = 0.05; away edge = (0.2 - 0.2)/2 = 0
    expect(r.xg_modifier_home).toBeCloseTo(0.025, 10);
    expect(r.xg_modifier_away).toBeCloseTo(0, 10);
    expect(r.totals_modifier).toBeCloseTo(0.015, 10);
  });
});

describe('referee', () => {
  it('unknown referee → null effect', () => {
    expect(computeReferee(ctx(), coef).metadata.reason).toBe('referee_unknown');
  });

  it('high-card ref punishes low-discipline side', () => {
    const c = ctx({
      referee: { full_name: 'Cardy McCardface', cards_per_match: 6.1, penalties_per_match: 0.2, home_team_card_rate: 0.5 },
      home: team({ cards_per_match: 4.2 }),
      away: team({ cards_per_match: 2.0 })
    });
    const r = computeReferee(c, coef);
    expect(r.home_effect).toBeCloseTo(-0.01, 10);
    expect(r.away_effect).toBe(0);
  });

  it('home-biased crew gives home bonus', () => {
    const c = ctx({
      referee: { full_name: 'Homer', cards_per_match: 3.0, penalties_per_match: 0.1, home_team_card_rate: 0.3 }
    });
    expect(computeReferee(c, coef).home_effect).toBeCloseTo(0.01, 10);
  });
});

describe('cluster_injury', () => {
  const absence = (pos: PlayerAbsence['position_group'], captain = false, key = false): PlayerAbsence => ({
    player_name: 'P', reason: 'injured', position_group: pos, is_captain: captain, is_key_player: key
  });

  it('no absences → score 0, null effect', () => {
    expect(computeClusterScore([], coef)).toBe(0);
    expect(computeClusterInjury(ctx(), coef).metadata.reason).toBe('no_confirmed_absences');
  });

  it('GK + striker is catastrophic (1.5x multiplier)', () => {
    const base = computeClusterScore([absence('goalkeeper')], coef) + computeClusterScore([absence('forward')], coef);
    const combo = computeClusterScore([absence('goalkeeper'), absence('forward')], coef);
    expect(combo).toBeCloseTo(base * 1.5, 10);
  });

  it('two defenders compound 1.4x', () => {
    const combo = computeClusterScore([absence('defender'), absence('defender')], coef);
    expect(combo).toBeCloseTo(2 * 1.4, 10);
  });

  it('captain adds +0.5 after multipliers', () => {
    const withCaptain = computeClusterScore([absence('midfielder', true)], coef);
    const without = computeClusterScore([absence('midfielder')], coef);
    expect(withCaptain - without).toBeCloseTo(0.5, 10);
  });

  it('bucketed impact adjustment', () => {
    expect(clusterImpactAdjustment(0, coef)).toBe(0);
    expect(clusterImpactAdjustment(1.0, coef)).toBeCloseTo(-0.01, 10);
    expect(clusterImpactAdjustment(2.0, coef)).toBeCloseTo(-0.03, 10);
    expect(clusterImpactAdjustment(4.0, coef)).toBeCloseTo(-0.06, 10);
    expect(clusterImpactAdjustment(6.0, coef)).toBeCloseTo(-0.09, 10);
    expect(clusterImpactAdjustment(9.0, coef)).toBeCloseTo(-0.12, 10);
  });
});

describe('recent_form', () => {
  const m = (points: number, expected: number) => ({
    kickoff_utc: new Date(), went_to_extra_time: false, went_to_penalties: false,
    points, expected_points: expected
  });

  it('insufficient data → null effect', () => {
    expect(computeRecentForm(ctx(), coef).metadata.reason).toContain('insufficient_recent_data');
  });

  it('overperforming form gets small boost, capped', () => {
    const c = ctx({ home: team({ recent_matches: [m(3, 1.0), m(3, 1.0), m(3, 0.5)] }) });
    const r = computeRecentForm(c, coef);
    expect(r.home_effect).toBeCloseTo(0.015, 10);  // delta = 9 - 2.5 = 6.5 > 4
  });

  it('mild underperformance → small negative', () => {
    const c = ctx({ home: team({ recent_matches: [m(0, 1.2), m(0, 1.2), m(1, 1.2)] }) });
    expect(computeRecentForm(c, coef).home_effect).toBeCloseTo(-0.008, 10);  // delta = 1 - 3.6 = -2.6
  });
});
