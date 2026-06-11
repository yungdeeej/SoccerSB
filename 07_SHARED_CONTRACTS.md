# 07 — SHARED CONTRACTS

## Database Schema, Message Contracts, Utility Functions

This is the contract layer that all agents share. Every field, every type, every utility function used across agents lives here. If two agents need to communicate, they communicate through these schemas.

---

## DATABASE SCHEMA (Drizzle ORM)

### Core entities

```typescript
// /src/db/schema.ts

import { pgTable, uuid, text, timestamp, integer, bigint, boolean, 
         numeric, jsonb, pgEnum, index } from 'drizzle-orm/pg-core';

// =========================================================================
// TEAMS
// =========================================================================

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  fifa_team_id: integer('fifa_team_id').notNull().unique(),
  name: text('name').notNull(),
  short_name: text('short_name').notNull(),  // 3-letter code like 'MEX'
  confederation: text('confederation').notNull(),  // 'CONCACAF', 'CONMEBOL', 'UEFA', etc.
  
  // Power rating signals
  elo_rating: numeric('elo_rating', { precision: 6, scale: 1 }),
  elo_last_updated: timestamp('elo_last_updated', { withTimezone: true }),
  
  market_value_squad_eur_m: numeric('market_value_squad_eur_m', { precision: 8, scale: 2 }),
  market_value_xi_eur_m: numeric('market_value_xi_eur_m', { precision: 8, scale: 2 }),
  market_value_last_updated: timestamp('market_value_last_updated', { withTimezone: true }),
  
  // Composite rating
  attack_rating: numeric('attack_rating', { precision: 5, scale: 3 }),
  defense_rating: numeric('defense_rating', { precision: 5, scale: 3 }),
  composite_z: numeric('composite_z', { precision: 5, scale: 3 }),
  
  // Rolling stats
  rolling_8_match: jsonb('rolling_8_match'),
  club_xg_aggregate: jsonb('club_xg_aggregate'),
  recent_form_score: numeric('recent_form_score', { precision: 4, scale: 3 }),
  
  // Base location
  home_base_lat: numeric('home_base_lat', { precision: 8, scale: 5 }),
  home_base_lng: numeric('home_base_lng', { precision: 9, scale: 5 }),
  altitude_acclimation_meters: integer('altitude_acclimation_meters').default(0),
  
  // Style profile
  press_intensity: text('press_intensity'),  // 'high', 'mid_block', 'low_block'
  possession_orientation: text('possession_orientation'),  // 'possession', 'direct', 'transition'
  defensive_structure: text('defensive_structure'),  // 'high_line', 'mid_block', 'deep_block'
  set_piece_reliance: text('set_piece_reliance'),  // 'heavy', 'moderate', 'light'
  style_directness_score: numeric('style_directness_score', { precision: 4, scale: 3 }),
  bench_quality_z: numeric('bench_quality_z', { precision: 4, scale: 3 }),
  
  // Set piece stats
  set_piece_goals_per_match: numeric('set_piece_goals_per_match', { precision: 4, scale: 3 }),
  set_piece_defense_z: numeric('set_piece_defense_z', { precision: 4, scale: 3 }),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// PLAYERS (for cluster injury tracking)
// =========================================================================

export const players = pgTable('players', {
  id: uuid('id').primaryKey().defaultRandom(),
  fifa_player_id: integer('fifa_player_id'),
  full_name: text('full_name').notNull(),
  team_id: uuid('team_id').references(() => teams.id),
  
  position: text('position').notNull(),  // 'GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'CF'
  position_group: text('position_group').notNull(),  // 'goalkeeper', 'defender', 'midfielder', 'forward'
  is_captain: boolean('is_captain').default(false),
  is_alternate_captain: boolean('is_alternate_captain').default(false),
  
  market_value_eur_m: numeric('market_value_eur_m', { precision: 6, scale: 2 }),
  
  club: text('club'),
  club_xg90: numeric('club_xg90', { precision: 5, scale: 3 }),  // for attackers
  club_xga90: numeric('club_xga90', { precision: 5, scale: 3 }),  // for defenders
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// VENUES
// =========================================================================

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  fifa_venue_id: integer('fifa_venue_id'),
  name: text('name').notNull(),
  city: text('city').notNull(),
  country: text('country').notNull(),
  
  latitude: numeric('latitude', { precision: 8, scale: 5 }).notNull(),
  longitude: numeric('longitude', { precision: 9, scale: 5 }).notNull(),
  altitude_meters: integer('altitude_meters').notNull(),
  
  surface_type: text('surface_type'),  // 'natural_grass', 'hybrid', 'artificial'
  capacity: integer('capacity'),
  is_indoor: boolean('is_indoor').default(false),
  is_outdoor: boolean('is_outdoor').default(true),
  
  timezone: text('timezone').notNull(),
  
  // Pre-computed flags
  is_high_altitude: boolean('is_high_altitude').default(false),  // > 1500m
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// REFEREES
// =========================================================================

export const referees = pgTable('referees', {
  id: uuid('id').primaryKey().defaultRandom(),
  fifa_referee_id: integer('fifa_referee_id'),
  full_name: text('full_name').notNull(),
  nationality: text('nationality'),
  
  // Rolling tendency stats (last 30 matches)
  cards_per_match: numeric('cards_per_match', { precision: 4, scale: 2 }),
  penalties_per_match: numeric('penalties_per_match', { precision: 4, scale: 2 }),
  added_time_avg_minutes: numeric('added_time_avg_minutes', { precision: 4, scale: 2 }),
  home_team_card_rate: numeric('home_team_card_rate', { precision: 4, scale: 3 }),
  var_intervention_rate: numeric('var_intervention_rate', { precision: 4, scale: 3 }),
  
  last_updated: timestamp('last_updated', { withTimezone: true })
});

// =========================================================================
// MATCHES
// =========================================================================

export const matches = pgTable('matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  fifa_match_id: integer('fifa_match_id').notNull().unique(),
  
  home_team_id: uuid('home_team_id').references(() => teams.id).notNull(),
  away_team_id: uuid('away_team_id').references(() => teams.id).notNull(),
  venue_id: uuid('venue_id').references(() => venues.id).notNull(),
  referee_id: uuid('referee_id').references(() => referees.id),
  
  tournament_stage: text('tournament_stage').notNull(),  
  // 'group_md1', 'group_md2', 'group_md3', 'r32', 'r16', 'qf', 'sf', 'third', 'final'
  group_letter: text('group_letter'),  // 'A' to 'L', null for knockout
  
  scheduled_kickoff_utc: timestamp('scheduled_kickoff_utc', { withTimezone: true }).notNull(),
  
  status: text('status').notNull().default('scheduled'),
  // 'scheduled', 'live', 'finished', 'postponed', 'cancelled'
  
  // Final result (populated post-match)
  home_score: integer('home_score'),
  away_score: integer('away_score'),
  home_score_ht: integer('home_score_ht'),
  away_score_ht: integer('away_score_ht'),
  went_to_extra_time: boolean('went_to_extra_time').default(false),
  went_to_penalties: boolean('went_to_penalties').default(false),
  penalty_winner: text('penalty_winner'),  // 'home', 'away'
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  matchKickoffIdx: index('idx_matches_kickoff').on(table.scheduled_kickoff_utc),
  matchStatusIdx: index('idx_matches_status').on(table.status)
}));

// =========================================================================
// MATCH CONTEXTS (Tactician's lineup data)
// =========================================================================

export const match_contexts = pgTable('match_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  match_id: uuid('match_id').references(() => matches.id).notNull(),
  
  captured_at: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  run_phase: text('run_phase').notNull(),  // 'T-24h', 'T-12h', 'T-2h', 'T-30min'
  
  // Confirmation status
  home_xi_status: text('home_xi_status'),  // 'projected', 'leaked', 'confirmed'
  away_xi_status: text('away_xi_status'),
  home_xi_confidence: integer('home_xi_confidence'),  // 0-100
  away_xi_confidence: integer('away_xi_confidence'),
  
  // Lineups (when known)
  home_confirmed_xi: jsonb('home_confirmed_xi'),  // [{ player_id, position }, ...]
  away_confirmed_xi: jsonb('away_confirmed_xi'),
  
  // Absences
  home_absences: jsonb('home_absences'),  // [{ player_id, reason, position_group, is_captain }]
  away_absences: jsonb('away_absences'),
  
  // Cluster scores
  home_cluster_score: numeric('home_cluster_score', { precision: 4, scale: 2 }),
  away_cluster_score: numeric('away_cluster_score', { precision: 4, scale: 2 }),
  
  // Beat reporter signals
  beat_reporter_signals: jsonb('beat_reporter_signals'),
  
  flagged_concerns: jsonb('flagged_concerns'),
  source_failures: jsonb('source_failures'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// MODEL PREDICTIONS (Quant outputs)
// =========================================================================

export const model_predictions = pgTable('model_predictions', {
  id: uuid('id').primaryKey().defaultRandom(),
  match_id: uuid('match_id').references(() => matches.id).notNull(),
  
  predicted_at: timestamp('predicted_at', { withTimezone: true }).notNull().defaultNow(),
  model_version: text('model_version').notNull(),
  xi_status: text('xi_status').notNull(),  // 'projected' or 'confirmed'
  
  // Expected goals
  expected_goals_home: numeric('expected_goals_home', { precision: 5, scale: 3 }),
  expected_goals_away: numeric('expected_goals_away', { precision: 5, scale: 3 }),
  goal_correlation: numeric('goal_correlation', { precision: 4, scale: 3 }),
  
  // All market probabilities stored as JSON
  predictions: jsonb('predictions').notNull(),
  // {
  //   match_outcome: { home_win_prob, draw_prob, away_win_prob },
  //   double_chance: { ... },
  //   draw_no_bet: { ... },
  //   totals: { '0.5': {...}, '1.5': {...}, ... },
  //   asian_handicap: { '-2.0': {...}, ... },
  //   both_teams_to_score: { ... },
  //   halftime_fulltime: { ... },
  //   halftime_totals: { ... }
  // }
  
  // Confidence
  confidence_interval: jsonb('confidence_interval'),
  // { method, iterations, home_win_ci_width, draw_ci_width, away_win_ci_width, low_confidence_flag }
  
  // Rating components used
  rating_components: jsonb('rating_components'),
  
  // Diagnostic
  inputs_quality_score: integer('inputs_quality_score'),
  warnings: jsonb('warnings'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  matchIdx: index('idx_predictions_match').on(table.match_id),
  predictedIdx: index('idx_predictions_predicted').on(table.predicted_at)
}));

// =========================================================================
// SITUATIONAL ADJUSTMENTS (Tactician outputs)
// =========================================================================

export const situational_adjustments = pgTable('situational_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  match_id: uuid('match_id').references(() => matches.id).notNull(),
  
  computed_at: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  coefficient_version: text('coefficient_version').notNull(),
  
  // Raw vs adjusted probabilities
  raw_quant_probs: jsonb('raw_quant_probs'),  // { home_win, draw, away_win }
  adjusted_probs: jsonb('adjusted_probs'),
  
  // xG modifiers
  home_xg_modifier: numeric('home_xg_modifier', { precision: 5, scale: 3 }),
  away_xg_modifier: numeric('away_xg_modifier', { precision: 5, scale: 3 }),
  totals_offset: numeric('totals_offset', { precision: 5, scale: 3 }),
  
  // Factor breakdown
  factor_breakdown: jsonb('factor_breakdown').notNull(),
  // Each factor: { home_effect, away_effect, metadata }
  
  flags: jsonb('flags'),
  total_adjustment_capped: boolean('total_adjustment_capped').default(false),
  combined_advantage_home: numeric('combined_advantage_home', { precision: 5, scale: 3 }),
  
  inputs_quality_score: integer('inputs_quality_score'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// ODDS SNAPSHOTS (Wolfman raw captures)
// =========================================================================

export const odds_snapshots = pgTable('odds_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  match_id: uuid('match_id').references(() => matches.id).notNull(),
  
  captured_at: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  book: text('book').notNull(),  // 'pinnacle', 'draftkings', 'fanduel', etc.
  market: text('market').notNull(),  // 'match_outcome_home', 'total_over_2.5', etc.
  side: text('side'),  // 'home', 'draw', 'away', 'over', 'under', etc.
  
  american_odds: integer('american_odds').notNull(),
  decimal_odds: numeric('decimal_odds', { precision: 8, scale: 4 }),
  
  // For Asian handicap
  ah_line: numeric('ah_line', { precision: 4, scale: 2 }),
  
  // For totals
  total_line: numeric('total_line', { precision: 4, scale: 2 }),
  
  is_closing_line: boolean('is_closing_line').default(false),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  matchMarketIdx: index('idx_odds_match_market').on(table.match_id, table.market, table.side),
  capturedIdx: index('idx_odds_captured').on(table.captured_at),
  closingIdx: index('idx_odds_closing').on(table.is_closing_line)
}));

// =========================================================================
// MARKET INTELLIGENCE (Wolfman synthesized outputs)
// =========================================================================

export const market_intelligence = pgTable('market_intelligence', {
  id: uuid('id').primaryKey().defaultRandom(),
  match_id: uuid('match_id').references(() => matches.id).notNull(),
  
  analyzed_at: timestamp('analyzed_at', { withTimezone: true }).notNull().defaultNow(),
  
  // Full structured analysis per market stored as JSON
  markets: jsonb('markets').notNull(),
  
  cross_market_observations: jsonb('cross_market_observations'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// VERDICTS (CEO outputs)
// =========================================================================

export const verdicts = pgTable('verdicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  match_id: uuid('match_id').references(() => matches.id).notNull(),
  
  issued_at: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }),
  run_phase: text('run_phase').notNull(),
  
  market: text('market').notNull(),
  side: text('side').notNull(),
  decision: text('decision').notNull(),  // 'STRIKE', 'WATCH', 'PASS'
  
  // STRIKE fields
  recommended_book: text('recommended_book'),
  recommended_odds_american: integer('recommended_odds_american'),
  recommended_stake_cents: bigint('recommended_stake_cents', { mode: 'bigint' }),
  kelly_fraction_used: numeric('kelly_fraction_used', { precision: 5, scale: 4 }),
  bankroll_pct: numeric('bankroll_pct', { precision: 5, scale: 2 }),
  star_rating: numeric('star_rating', { precision: 3, scale: 1 }),
  
  // WATCH/PASS fields
  pass_reason: text('pass_reason'),
  watch_reason: text('watch_reason'),
  watch_for: text('watch_for'),
  
  // Common
  raw_edge_pct: numeric('raw_edge_pct', { precision: 6, scale: 3 }),
  adjusted_edge_pct: numeric('adjusted_edge_pct', { precision: 6, scale: 3 }),
  walters_writeup: text('walters_writeup'),
  
  // Audit
  agent_inputs_snapshot: jsonb('agent_inputs_snapshot').notNull(),
  discipline_gates_passed: jsonb('discipline_gates_passed'),
  discipline_gates_failed: jsonb('discipline_gates_failed'),
  
  // Re-evaluation tracking
  superseded_by: uuid('superseded_by'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  matchIdx: index('idx_verdicts_match').on(table.match_id),
  decisionIdx: index('idx_verdicts_decision').on(table.decision),
  issuedIdx: index('idx_verdicts_issued').on(table.issued_at)
}));

// =========================================================================
// BETS
// =========================================================================

export const bets = pgTable('bets', {
  id: uuid('id').primaryKey().defaultRandom(),
  verdict_id: uuid('verdict_id').references(() => verdicts.id),
  match_id: uuid('match_id').references(() => matches.id).notNull(),
  
  placed_at: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  
  market: text('market').notNull(),
  side: text('side').notNull(),
  book: text('book').notNull(),
  
  stake_cents: bigint('stake_cents', { mode: 'bigint' }).notNull(),
  american_odds: integer('american_odds').notNull(),
  decimal_odds: numeric('decimal_odds', { precision: 8, scale: 4 }).notNull(),
  potential_payout_cents: bigint('potential_payout_cents', { mode: 'bigint' }),
  
  // Settlement
  settlement_status: text('settlement_status').notNull().default('pending'),
  // 'pending', 'settled', 'void', 'cancelled'
  outcome: text('outcome'),  // 'win', 'loss', 'push', 'half_win', 'half_loss'
  payout_cents: bigint('payout_cents', { mode: 'bigint' }),
  pl_cents: bigint('pl_cents', { mode: 'bigint' }),
  settled_at: timestamp('settled_at', { withTimezone: true }),
  
  // CLV
  closing_line_american: integer('closing_line_american'),
  closing_line_no_vig_prob: numeric('closing_line_no_vig_prob', { precision: 5, scale: 4 }),
  bet_no_vig_prob: numeric('bet_no_vig_prob', { precision: 5, scale: 4 }),
  clv_cents: numeric('clv_cents', { precision: 6, scale: 2 }),
  clv_classification: text('clv_classification'),
  
  // Audit
  stop_loss_state_at_placement: text('stop_loss_state_at_placement'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  matchIdx: index('idx_bets_match').on(table.match_id),
  settlementIdx: index('idx_bets_settlement').on(table.settlement_status),
  placedIdx: index('idx_bets_placed').on(table.placed_at)
}));

// =========================================================================
// BANKROLL LEDGER (append-only)
// =========================================================================

export const bankroll_ledger = pgTable('bankroll_ledger', {
  id: uuid('id').primaryKey().defaultRandom(),
  occurred_at: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  
  entry_type: text('entry_type').notNull(),
  amount_cents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  balance_after_cents: bigint('balance_after_cents', { mode: 'bigint' }).notNull(),
  reference_id: uuid('reference_id'),
  notes: text('notes'),
  source: text('source').notNull(),
  
  // State snapshot at this moment
  peak_bankroll_at_entry_cents: bigint('peak_bankroll_at_entry_cents', { mode: 'bigint' }),
  drawdown_pct_at_entry: numeric('drawdown_pct_at_entry', { precision: 5, scale: 2 }),
  stop_loss_state_at_entry: text('stop_loss_state_at_entry'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  occurredIdx: index('idx_ledger_occurred').on(table.occurred_at),
  referenceIdx: index('idx_ledger_reference').on(table.reference_id)
}));

// =========================================================================
// MODEL VERSIONS
// =========================================================================

export const model_versions = pgTable('model_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent: text('agent').notNull(),  // 'quant', 'tactician', 'wolfman', 'ceo', 'treasurer'
  version: text('version').notNull(),
  deployed_at: timestamp('deployed_at', { withTimezone: true }).notNull().defaultNow(),
  config_snapshot: jsonb('config_snapshot'),
  change_notes: text('change_notes'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// AGENT RUNS (logging)
// =========================================================================

export const agent_runs = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agent: text('agent').notNull(),
  ran_at: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  
  match_id: uuid('match_id'),
  run_phase: text('run_phase'),
  
  status: text('status').notNull(),  // 'success', 'failed_recoverable', 'failed_fatal'
  duration_ms: integer('duration_ms'),
  
  error_message: text('error_message'),
  error_stack: text('error_stack'),
  
  outputs_summary: jsonb('outputs_summary'),
  
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  agentIdx: index('idx_runs_agent').on(table.agent),
  statusIdx: index('idx_runs_status').on(table.status),
  ranIdx: index('idx_runs_ran').on(table.ran_at)
}));
```

---

## INTER-AGENT MESSAGE CONTRACTS

These are the TypeScript interfaces agents use to communicate.

### Quant → Tactician

```typescript
interface QuantOutput {
  match_id: string;
  model_version: string;
  predicted_at: string;
  
  expected_goals: { home: number; away: number; total: number; correlation: number };
  
  predictions: {
    match_outcome: { home_win_prob: number; draw_prob: number; away_win_prob: number };
    double_chance: { home_or_draw: number; away_or_draw: number; home_or_away: number };
    draw_no_bet: { home_dnb_prob: number; away_dnb_prob: number };
    totals: Record<string, { over: number; under: number }>;
    asian_handicap: Record<string, { home_covers: number; away_covers: number }>;
    both_teams_to_score: { yes_prob: number; no_prob: number };
    halftime_fulltime: Record<string, number>;
    halftime_totals: Record<string, { over: number; under: number }>;
  };
  
  confidence_interval: {
    method: 'bootstrap';
    iterations: number;
    home_win_ci_width: number;
    draw_ci_width: number;
    away_win_ci_width: number;
    low_confidence_flag: boolean;
  };
  
  rating_components: {
    home_elo_z: number;
    home_market_value_z: number;
    home_club_xg_z: number;
    home_composite_z: number;
    away_elo_z: number;
    away_market_value_z: number;
    away_club_xg_z: number;
    away_composite_z: number;
    venue_factor_applied: number;
  };
  
  diagnostic: {
    inputs_quality_score: number;
    warnings: string[];
    xi_status: 'projected' | 'confirmed' | 'unknown';
  };
}
```

### Tactician → CEO

```typescript
interface TacticianOutput {
  match_id: string;
  computed_at: string;
  coefficient_version: string;
  
  home_xi_status: 'projected' | 'leaked' | 'confirmed';
  away_xi_status: 'projected' | 'leaked' | 'confirmed';
  home_xi_confidence_score: number;
  away_xi_confidence_score: number;
  home_cluster_score: number;
  away_cluster_score: number;
  flagged_lineup_concerns: string[];
  
  raw_quant_probs: { home_win: number; draw: number; away_win: number };
  adjusted_probs: { home_win: number; draw: number; away_win: number };
  
  xg_modifiers: { home: number; away: number; totals_offset: number };
  
  factor_breakdown: {
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
  };
  
  flags: string[];
  total_adjustment_capped: boolean;
  combined_advantage_home: number;
  inputs_quality_score: number;
}

interface FactorEffect {
  home_effect: number;
  away_effect: number;
  metadata: Record<string, unknown>;
}
```

### Wolfman → CEO

```typescript
interface WolfmanOutput {
  match_id: string;
  analyzed_at: string;
  
  markets: Record<string, MarketAnalysis>;
  cross_market_observations: string[];
}

interface MarketAnalysis {
  opening_consensus_american: number;
  current_consensus_american: number;
  consensus_no_vig_prob: number;
  
  pinnacle_current_american: number;
  pinnacle_no_vig_prob: number;
  sbobet_current_american: number | null;
  sbobet_no_vig_prob: number | null;
  
  total_movement_cents: number;
  movement_direction: 'toward_home' | 'toward_draw' | 'toward_away' | 'flat';
  biggest_mover_book: string;
  biggest_mover_cents: number;
  
  rlm_detected: boolean;
  rlm_explanation: string | null;
  steam_detected: boolean;
  steam_explanation: string | null;
  line_freeze_detected: boolean;
  sharp_soft_divergence_cents: number;
  
  asian_western_divergence_cents: number;
  asian_western_divergence_explanation: string | null;
  
  best_book: string;
  best_book_american: number;
  best_book_decimal: number;
  best_book_tier: 'sharp' | 'sharp_adjacent' | 'soft';
  
  timing_signal: 'fav_early' | 'dog_late' | 'draw_drift_value' | 'neutral';
  timing_explanation: string;
  
  market_signal_summary: string;
}
```

### Treasurer responses

```typescript
interface StakeResponse {
  approved: boolean;
  recommended_stake_cents: number | null;
  kelly_fraction_full: number;
  kelly_fraction_used: number;
  bankroll_pct: number;
  cap_reasoning: string;
  rejection_reason: string | null;
  capital_snapshot: TreasurerSnapshot;
}

interface TreasurerSnapshot {
  active_bankroll_cents: number;
  total_capital_cents: number;
  pending_wagers_cents: number;
  available_capital_cents: number;
  
  peak_bankroll_cents: number;
  peak_reached_at: string;
  drawdown_pct_from_peak: number;
  
  stop_loss_active: 'none' | 'reduced_kelly' | 'halt';
  stop_loss_reason: string | null;
  stop_loss_resumes_at: string | null;
  
  todays_bet_count: number;
  todays_bets_by_match: Map<string, number>;
  daily_bet_cap: number;
  
  this_week_clv_cents: number;
  this_month_clv_cents: number;
  rolling_30d_clv_cents: number;
  clv_classification: 'sharp' | 'marginal' | 'break_even' | 'below_replacement';
  
  current_kelly_fraction: number;
  daily_bet_cap_effective: number;
}
```

---

## SHARED UTILITY FUNCTIONS

### `/src/shared/utils/odds.ts`

```typescript
/**
 * Convert American odds to decimal odds.
 */
export function americanToDecimal(american: number): number {
  if (american === 0) throw new Error('Invalid American odds: 0');
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

/**
 * Convert decimal odds to American odds.
 */
export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) throw new Error('Invalid decimal odds: <= 1');
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

/**
 * Strip vig from a two-way market using power method.
 * Returns no-vig probabilities for each side.
 */
export function stripVigTwoWay(
  side_a_american: number, 
  side_b_american: number
): { side_a_no_vig: number; side_b_no_vig: number } {
  const a_decimal = americanToDecimal(side_a_american);
  const b_decimal = americanToDecimal(side_b_american);
  
  const a_implied = 1 / a_decimal;
  const b_implied = 1 / b_decimal;
  const total = a_implied + b_implied;
  
  return {
    side_a_no_vig: a_implied / total,
    side_b_no_vig: b_implied / total
  };
}

/**
 * Strip vig from a three-way market (soccer match outcome).
 */
export function stripVigThreeWay(
  home_american: number,
  draw_american: number,
  away_american: number
): { home_no_vig: number; draw_no_vig: number; away_no_vig: number } {
  const h_dec = americanToDecimal(home_american);
  const d_dec = americanToDecimal(draw_american);
  const a_dec = americanToDecimal(away_american);
  
  const h_imp = 1 / h_dec;
  const d_imp = 1 / d_dec;
  const a_imp = 1 / a_dec;
  const total = h_imp + d_imp + a_imp;
  
  return {
    home_no_vig: h_imp / total,
    draw_no_vig: d_imp / total,
    away_no_vig: a_imp / total
  };
}

/**
 * Calculate CLV (Closing Line Value) in cents.
 * Positive = beat the close.
 */
export function calculateCLV(bet_no_vig_prob: number, closing_no_vig_prob: number): number {
  return (closing_no_vig_prob - bet_no_vig_prob) * 100;
}
```

### `/src/shared/utils/kelly.ts`

```typescript
/**
 * Calculate quarter-Kelly stake with hard caps and floors.
 */
export function calculateKellyStake(args: {
  adjusted_win_prob: number;
  decimal_odds: number;
  bankroll_cents: number;
  fraction: number;  // 0.25 default, 0.125 in reduced state
  low_confidence_flag: boolean;
  knockout_stage: boolean;
}): { 
  stake_cents: number; 
  kelly_fraction_full: number; 
  cap_reasoning: string;
  approved: boolean;
  rejection_reason: string | null;
} {
  const b = args.decimal_odds - 1;
  const p = args.adjusted_win_prob;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  
  if (fullKelly <= 0) {
    return {
      stake_cents: 0,
      kelly_fraction_full: fullKelly,
      cap_reasoning: 'No positive Kelly fraction',
      approved: false,
      rejection_reason: 'kelly_non_positive'
    };
  }
  
  let kellyStakePct = fullKelly * args.fraction;
  
  if (args.low_confidence_flag) kellyStakePct *= 0.5;
  if (args.knockout_stage) kellyStakePct *= 0.85;
  
  const HARD_CAP_PCT = 0.03;
  const FLOOR_CENTS = 2000;
  
  let stake_cents = Math.round(kellyStakePct * args.bankroll_cents);
  let cap_reasoning = `Quarter-Kelly: ${(kellyStakePct * 100).toFixed(2)}% of bankroll`;
  
  const hardCapCents = Math.round(HARD_CAP_PCT * args.bankroll_cents);
  if (stake_cents > hardCapCents) {
    stake_cents = hardCapCents;
    cap_reasoning = `Capped at 3% hard cap ($${(hardCapCents / 100).toFixed(2)})`;
  }
  
  if (stake_cents < FLOOR_CENTS) {
    return {
      stake_cents: 0,
      kelly_fraction_full: fullKelly,
      cap_reasoning: `Stake $${(stake_cents / 100).toFixed(2)} below $20 floor`,
      approved: false,
      rejection_reason: 'stake_below_floor'
    };
  }
  
  return {
    stake_cents,
    kelly_fraction_full: fullKelly,
    cap_reasoning,
    approved: true,
    rejection_reason: null
  };
}
```

### `/src/shared/utils/geo.ts`

```typescript
/**
 * Haversine distance in kilometers between two coordinates.
 */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLng / 2) ** 2;
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Distance in miles (utility wrapper).
 */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineDistance(lat1, lng1, lat2, lng2) * 0.621371;
}
```

---

## MARKET KEY CONVENTIONS

To keep agent communication clean, use these standardized market key strings:

| Market | Key format | Examples |
|---|---|---|
| Match outcome | `match_outcome_{side}` | `match_outcome_home`, `match_outcome_draw`, `match_outcome_away` |
| Double chance | `double_chance_{combination}` | `double_chance_home_or_draw`, `double_chance_away_or_draw` |
| Draw no bet | `draw_no_bet_{side}` | `draw_no_bet_home`, `draw_no_bet_away` |
| Totals | `total_{over/under}_{line}` | `total_over_2.5`, `total_under_3.5` |
| Asian handicap | `asian_handicap_{home/away}_{line}` | `asian_handicap_home_-0.5`, `asian_handicap_away_+1.25` |
| BTTS | `btts_{yes/no}` | `btts_yes`, `btts_no` |
| HT/FT | `ht_ft_{ht_result}_{ft_result}` | `ht_ft_home_home`, `ht_ft_draw_away` |
| HT totals | `halftime_total_{over/under}_{line}` | `halftime_total_over_0.5` |

---

## BOOK NAME CONVENTIONS

Use these exact strings across all agents:

| Book | Key | Tier |
|---|---|---|
| Pinnacle | `pinnacle` | sharp |
| Sbobet | `sbobet` | sharp |
| IBC / 188bet | `ibc` | sharp |
| Bet365 (EU) | `bet365_eu` | sharp_adjacent |
| Bet365 (Ontario) | `bet365_ontario` | soft (operator-accessible) |
| Caesars (Vegas sharp) | `caesars_vegas` | sharp_adjacent |
| Caesars (retail) | `caesars` | soft |
| Stake | `stake` | sharp_adjacent |
| DraftKings | `draftkings` | soft |
| FanDuel | `fanduel` | soft |
| BetMGM | `betmgm` | soft |
| Bovada | `bovada` | soft |
| PointsBet | `pointsbet` | soft |

---

## ERROR HANDLING CONTRACT

All agent functions follow this error convention:

```typescript
type AgentResult<T> = 
  | { status: 'success'; data: T }
  | { status: 'failed_recoverable'; error: string; retry_after_ms?: number }
  | { status: 'failed_fatal'; error: string; stack?: string };
```

`failed_recoverable` triggers exponential backoff retry.
`failed_fatal` halts the pipeline and pages the operator.

---

## CONFIGURATION FILE LOCATIONS

| File | Owner | Purpose |
|---|---|---|
| `/src/shared/config/team_arenas.json` | shared | All 16 World Cup venues |
| `/src/shared/config/beat_reporters.json` | Tactician | Per-team beat reporter handles |
| `/src/agents/quant/config/model_params.yaml` | Quant | Model parameters |
| `/src/agents/tactician/config/coefficients.json` | Tactician | All 11-factor coefficients |
| `/src/agents/tactician/config/team_profiles.json` | Tactician | Tactical style per team |
| `/src/agents/wolfman/config/books.json` | Wolfman | Book tier configuration |
| `/src/agents/wolfman/config/detection_thresholds.json` | Wolfman | Steam, RLM, divergence thresholds |
| `/src/agents/treasurer/config/parameters.json` | Treasurer | Kelly, stop-loss, CLV thresholds |

All config files validated with zod at load time. Malformed config = service refuses to start.

---

## ENVIRONMENT VARIABLES

```bash
# Database
DATABASE_URL=postgresql://...

# LLM
ANTHROPIC_API_KEY=sk-ant-...

# Odds
ODDS_API_KEY=...
ODDS_API_TIER=standard

# Soccer data
FBREF_SCRAPE_ENABLED=true
ELO_RATINGS_API_URL=...

# Weather
OPENWEATHER_API_KEY=...

# Notifications
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Operator
OPERATOR_TIMEZONE=America/Edmonton
OPERATOR_CURRENCY=CAD

# System
SYSTEM_ENV=development  # or 'live'
KELLY_FRACTION_OVERRIDE=  # blank = use default
```

---

## VERSION

- **Spec version:** 1.0
- **Last updated:** Pre-tournament build
- **Status:** Complete — ready for Claude Code execution
