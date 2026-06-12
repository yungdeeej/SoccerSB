/**
 * Tactician types — 03_AGENT_TACTICIAN.md + 07_SHARED_CONTRACTS.md.
 */

export type XIStatus = 'projected' | 'leaked' | 'confirmed';

export type QualificationStatus =
  | 'guaranteed_first'
  | 'guaranteed_advance'
  | 'fighting'
  | 'eliminated_with_pride'
  | 'eliminated'
  | 'not_applicable';  // non-MD3 stages

export interface FactorEffect {
  home_effect: number;
  away_effect: number;
  xg_modifier_home?: number;
  xg_modifier_away?: number;
  totals_modifier?: number;
  btts_modifier?: number;
  ci_widening?: number;
  metadata: Record<string, unknown>;
}

export const NULL_EFFECT = (reason: string): FactorEffect => ({
  home_effect: 0,
  away_effect: 0,
  metadata: { reason }
});

export interface PlayerAbsence {
  player_name: string;
  reason: string;  // 'injured' | 'suspended' | 'ill' | 'personal'
  position_group: 'goalkeeper' | 'defender' | 'midfielder' | 'forward';
  is_captain: boolean;
  is_key_player: boolean;
}

export interface TeamProfile {
  press_intensity: 'high' | 'mid_block' | 'low_block';
  possession_orientation: 'possession' | 'direct' | 'transition';
  defensive_structure: 'high_line' | 'mid_block' | 'deep_block';
  set_piece_reliance: 'heavy' | 'moderate' | 'light';
  style_directness_score: number;
  bench_quality_z: number;
  leads_protected_pct: number;
  _todo?: boolean;
}

export interface WeatherForecast {
  temp_c: number;
  condition: 'clear' | 'light_rain' | 'heavy_rain' | 'snow' | 'cloudy';
  wind_kph: number;
  humidity_pct: number;
  source: 'openweather' | 'seasonal_fallback';
}

export interface RefereeInfo {
  full_name: string;
  cards_per_match: number | null;
  penalties_per_match: number | null;
  home_team_card_rate: number | null;
}

export interface RecentMatchInfo {
  kickoff_utc: Date;
  went_to_extra_time: boolean;
  went_to_penalties: boolean;
  /** points won (3/1/0) — for form vs expectation */
  points: number | null;
  /** expected points from pre-match win prob if available */
  expected_points: number | null;
}

export interface GroupStandingRow {
  team_code: string;
  played: number;
  points: number;
  goal_diff: number;
  goals_for: number;
}

export interface TeamContext {
  code: string;
  profile: TeamProfile;
  base_lat: number | null;
  base_lng: number | null;
  base_tz_offset_hours: number | null;
  days_at_venue: number;
  capital_altitude_m: number;
  recent_matches: RecentMatchInfo[];  // most recent first
  rest_days: number | null;
  prev_match_extra_time: boolean;
  prev_match_penalties: boolean;
  xi_status: XIStatus;
  xi_confidence: number;
  absences: PlayerAbsence[];
  cluster_score: number;
  qualification_status: QualificationStatus;
  cards_per_match: number | null;  // discipline (for referee factor)
  set_piece_goals_for: number | null;
  set_piece_goals_against: number | null;
  set_piece_defense_z: number | null;
}

export interface MatchContext {
  match_id: string;
  tournament_stage: string;
  kickoff_utc: Date;
  venue: {
    name: string | null;
    latitude: number | null;
    longitude: number | null;
    altitude_meters: number;
    tz_offset_hours: number | null;
  };
  home: TeamContext;
  away: TeamContext;
  weather: WeatherForecast | null;
  referee: RefereeInfo | null;
  group_letter: string | null;
  group_standings: GroupStandingRow[] | null;
  flagged_concerns: string[];
  run_phase: 'T-24h' | 'T-12h' | 'T-2h' | 'T-30min' | 'manual';
}

export interface FactorBreakdown {
  rest_days: FactorEffect;
  travel: FactorEffect;
  altitude: FactorEffect;
  weather: FactorEffect;
  motivation: FactorEffect;
  squad_rotation: FactorEffect;
  tactical_matchup: FactorEffect;
  set_piece: FactorEffect;
  referee: FactorEffect;
  cluster_injury: FactorEffect;
  recent_form: FactorEffect;
}

export interface CombinedAdjustment {
  home_total: number;
  away_total: number;
  capped: boolean;
  net_advantage_home: number;
  xg_modifiers: { home: number; away: number; totals_offset: number };
  btts_modifier: number;
  ci_widening: number;
}

export interface ThreeWayProbs {
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
}

export interface AdjustedPredictions {
  adjusted_match_outcome: ThreeWayProbs;
  adjusted_totals: Record<string, { over: number; under: number }>;
  adjusted_asian_handicap: Record<string, { home_covers: number; away_covers: number }>;
  adjusted_btts: { yes_prob: number; no_prob: number };
  adjusted_double_chance: { home_or_draw: number; away_or_draw: number; home_or_away: number };
  adjusted_draw_no_bet: { home_dnb_prob: number; away_dnb_prob: number };
  adjusted_xg: { home: number; away: number };
  extreme_clip_flag: boolean;
}

export interface TacticianOutput {
  match_id: string;
  computed_at: string;
  coefficient_version: string;
  run_phase: string;
  home_xi_status: XIStatus;
  away_xi_status: XIStatus;
  home_xi_confidence_score: number;
  away_xi_confidence_score: number;
  home_cluster_score: number;
  away_cluster_score: number;
  flagged_lineup_concerns: string[];
  raw_quant_probs: ThreeWayProbs;
  adjusted_probs: ThreeWayProbs;
  adjusted_predictions: AdjustedPredictions;
  xg_modifiers: { home: number; away: number; totals_offset: number };
  factor_breakdown: FactorBreakdown;
  flags: string[];
  total_adjustment_capped: boolean;
  combined_advantage_home: number;
  inputs_quality_score: number;
}
