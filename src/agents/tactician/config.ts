/**
 * Tactician config loading — zod-validated at startup; malformed config
 * refuses to start (07 rule). Loaded once, cached.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { TeamProfile } from './types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, 'config');

const CoefficientsSchema = z.object({
  version: z.string(),
  rest_days: z.object({
    equal: z.number(),
    plus_1_day: z.number(),
    plus_2_days: z.number(),
    plus_3_days: z.number(),
    extra_time_fatigue_penalty: z.number(),
    penalty_shootout_mental_penalty: z.number()
  }),
  travel: z.object({
    distance_2500_5000_km: z.number(),
    distance_5000_8000_km: z.number(),
    distance_8000_plus_km: z.number(),
    timezone_2_zones: z.number(),
    timezone_4_zones: z.number(),
    timezone_6_zones: z.number(),
    acclimation_4_days_modifier: z.number(),
    acclimation_2_days_modifier: z.number()
  }),
  altitude: z.object({
    akron_partial_acclimation_5_to_10_days: z.number(),
    akron_recent_altitude_match_30_percent: z.number(),
    partial_acclimation_bonus_1500m: z.number()
  }),
  weather: z.object({
    hot_above_32c_depth_multiplier: z.number(),
    wet_directness_multiplier: z.number(),
    wet_btts_adjustment: z.number(),
    hot_total_xg_offset: z.number(),
    heavy_rain_total_xg_offset: z.number(),
    high_wind_total_xg_offset: z.number()
  }),
  motivation: z.object({
    fighting_vs_guaranteed_advance_motivated_team: z.number(),
    fighting_vs_guaranteed_advance_locked_team: z.number(),
    eliminated_vs_fighting_motivated_team: z.number(),
    both_guaranteed_first_ci_widening: z.number()
  }),
  squad_rotation: z.object({
    guaranteed_first: z.number(),
    guaranteed_advance: z.number()
  }),
  tactical_matchup: z.object({
    press_vs_deep_block: z.number(),
    direct_vs_high_line: z.number(),
    set_piece_vs_poor_defender: z.number(),
    possession_vs_transition: z.number()
  }),
  set_piece: z.object({
    xg_modifier_multiplier: z.number(),
    totals_modifier_multiplier: z.number()
  }),
  referee: z.object({
    high_card_crew_threshold: z.number(),
    low_discipline_team_threshold: z.number(),
    high_card_low_discipline_penalty: z.number(),
    home_bias_threshold: z.number(),
    home_bias_bonus: z.number(),
    high_penalty_threshold: z.number(),
    high_penalty_btts_boost: z.number()
  }),
  cluster_injury: z.object({
    'score_0_to_1.5': z.number(),
    'score_1.5_to_3': z.number(),
    score_3_to_5: z.number(),
    score_5_to_7: z.number(),
    score_7_plus: z.number(),
    goalkeeper_plus_attacker_multiplier: z.number(),
    two_plus_defenders_multiplier: z.number(),
    two_plus_midfielders_multiplier: z.number(),
    captain_absence_addition: z.number()
  }),
  recent_form: z.object({
    delta_plus_4: z.number(),
    delta_plus_2: z.number(),
    delta_minus_2: z.number(),
    delta_minus_4: z.number()
  }),
  global: z.object({
    max_total_adjustment: z.number(),
    min_total_adjustment: z.number()
  })
});

export type Coefficients = z.infer<typeof CoefficientsSchema>;

const TeamProfileSchema = z.object({
  press_intensity: z.enum(['high', 'mid_block', 'low_block']),
  possession_orientation: z.enum(['possession', 'direct', 'transition']),
  defensive_structure: z.enum(['high_line', 'mid_block', 'deep_block']),
  set_piece_reliance: z.enum(['heavy', 'moderate', 'light']),
  style_directness_score: z.number().min(0).max(1),
  bench_quality_z: z.number(),
  leads_protected_pct: z.number().min(0).max(1),
  _todo: z.boolean().optional()
});

const RivalriesSchema = z.object({
  regional_rivalries: z.array(z.tuple([z.string(), z.string()])),
  playoff_rematches: z.array(z.tuple([z.string(), z.string()]))
});

let coefficientsCache: Coefficients | null = null;
let profilesCache: Record<string, TeamProfile> | null = null;
let rivalriesCache: z.infer<typeof RivalriesSchema> | null = null;

export function loadCoefficients(): Coefficients {
  if (!coefficientsCache) {
    const raw: unknown = JSON.parse(readFileSync(join(CONFIG_DIR, 'coefficients.json'), 'utf-8'));
    coefficientsCache = CoefficientsSchema.parse(raw);
  }
  return coefficientsCache;
}

export function loadTeamProfiles(): Record<string, TeamProfile> {
  if (!profilesCache) {
    const raw = JSON.parse(readFileSync(join(CONFIG_DIR, 'team_profiles.json'), 'utf-8')) as Record<string, unknown>;
    const profiles: Record<string, TeamProfile> = {};
    for (const [code, profile] of Object.entries(raw)) {
      if (code.startsWith('_')) continue;
      profiles[code] = TeamProfileSchema.parse(profile);
    }
    if (Object.keys(profiles).length !== 48) {
      throw new Error(`team_profiles.json must define 48 teams, found ${Object.keys(profiles).length}`);
    }
    profilesCache = profiles;
  }
  return profilesCache;
}

export function loadRivalries(): z.infer<typeof RivalriesSchema> {
  if (!rivalriesCache) {
    const raw: unknown = JSON.parse(readFileSync(join(CONFIG_DIR, 'rivalries.json'), 'utf-8'));
    rivalriesCache = RivalriesSchema.parse(raw);
  }
  return rivalriesCache;
}

export function getCoefficientVersion(): string {
  return loadCoefficients().version;
}
