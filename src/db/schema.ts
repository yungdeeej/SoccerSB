/**
 * The Pitch — database schema (07_SHARED_CONTRACTS.md).
 *
 * Lean seeding: only structural facts are seeded in Phase 0 (team identity,
 * venue physical facts, group assignments, ledger init). Everything else is
 * nullable and populated by agents from authoritative live sources.
 */
import {
  pgTable, uuid, text, timestamp, integer, bigint, boolean,
  numeric, jsonb, index
} from 'drizzle-orm/pg-core';

// =========================================================================
// TEAMS
// =========================================================================

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  // NULL in Phase 0 — populated in Phase 1 from FIFA API (lean seeding)
  fifa_team_id: integer('fifa_team_id').unique(),
  name: text('name').notNull(),
  short_name: text('short_name').notNull(),  // 3-letter code like 'MEX'
  confederation: text('confederation').notNull(),  // 'CONCACAF', 'CONMEBOL', 'UEFA', etc.

  // Power rating signals — populated by Quant in Phase 2
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

  // Base location — populated when training camps are known
  home_base_lat: numeric('home_base_lat', { precision: 8, scale: 5 }),
  home_base_lng: numeric('home_base_lng', { precision: 9, scale: 5 }),
  altitude_acclimation_meters: integer('altitude_acclimation_meters'),

  // Style profile — populated by analysis in Phase 3
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
// PLAYERS (for cluster injury tracking) — populated in Phase 3
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
  club_xg90: numeric('club_xg90', { precision: 5, scale: 3 }),
  club_xga90: numeric('club_xga90', { precision: 5, scale: 3 }),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// VENUES
// =========================================================================

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey().defaultRandom(),
  fifa_venue_id: integer('fifa_venue_id'),  // NULL in Phase 0 — fetched in Phase 1
  name: text('name').notNull(),
  city: text('city').notNull(),
  country: text('country').notNull(),

  latitude: numeric('latitude', { precision: 8, scale: 5 }).notNull(),
  longitude: numeric('longitude', { precision: 9, scale: 5 }).notNull(),
  altitude_meters: integer('altitude_meters').notNull(),

  surface_type: text('surface_type'),  // 'natural_grass', 'hybrid', 'artificial'
  capacity: integer('capacity'),  // NULL in Phase 0 — varies by WC configuration, fetched later
  is_indoor: boolean('is_indoor').default(false),
  is_outdoor: boolean('is_outdoor').default(true),

  timezone: text('timezone').notNull(),

  is_high_altitude: boolean('is_high_altitude').default(false),  // > 1500m

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// REFEREES — populated in Phase 3 (~48h pre-match)
// =========================================================================

export const referees = pgTable('referees', {
  id: uuid('id').primaryKey().defaultRandom(),
  fifa_referee_id: integer('fifa_referee_id'),
  full_name: text('full_name').notNull(),
  nationality: text('nationality'),

  cards_per_match: numeric('cards_per_match', { precision: 4, scale: 2 }),
  penalties_per_match: numeric('penalties_per_match', { precision: 4, scale: 2 }),
  added_time_avg_minutes: numeric('added_time_avg_minutes', { precision: 4, scale: 2 }),
  home_team_card_rate: numeric('home_team_card_rate', { precision: 4, scale: 3 }),
  var_intervention_rate: numeric('var_intervention_rate', { precision: 4, scale: 3 }),

  last_updated: timestamp('last_updated', { withTimezone: true })
});

// =========================================================================
// MATCHES — fixtures fetched in Phase 1 from FIFA/Odds API
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

  home_xi_status: text('home_xi_status'),  // 'projected', 'leaked', 'confirmed'
  away_xi_status: text('away_xi_status'),
  home_xi_confidence: integer('home_xi_confidence'),  // 0-100
  away_xi_confidence: integer('away_xi_confidence'),

  home_confirmed_xi: jsonb('home_confirmed_xi'),  // [{ player_id, position }, ...]
  away_confirmed_xi: jsonb('away_confirmed_xi'),

  home_absences: jsonb('home_absences'),  // [{ player_id, reason, position_group, is_captain }]
  away_absences: jsonb('away_absences'),

  home_cluster_score: numeric('home_cluster_score', { precision: 4, scale: 2 }),
  away_cluster_score: numeric('away_cluster_score', { precision: 4, scale: 2 }),

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

  expected_goals_home: numeric('expected_goals_home', { precision: 5, scale: 3 }),
  expected_goals_away: numeric('expected_goals_away', { precision: 5, scale: 3 }),
  goal_correlation: numeric('goal_correlation', { precision: 4, scale: 3 }),

  predictions: jsonb('predictions').notNull(),

  confidence_interval: jsonb('confidence_interval'),

  rating_components: jsonb('rating_components'),

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

  raw_quant_probs: jsonb('raw_quant_probs'),  // { home_win, draw, away_win }
  adjusted_probs: jsonb('adjusted_probs'),

  home_xg_modifier: numeric('home_xg_modifier', { precision: 5, scale: 3 }),
  away_xg_modifier: numeric('away_xg_modifier', { precision: 5, scale: 3 }),
  totals_offset: numeric('totals_offset', { precision: 5, scale: 3 }),

  factor_breakdown: jsonb('factor_breakdown').notNull(),

  flags: jsonb('flags'),
  total_adjustment_capped: boolean('total_adjustment_capped').default(false),
  combined_advantage_home: numeric('combined_advantage_home', { precision: 5, scale: 3 }),

  inputs_quality_score: integer('inputs_quality_score'),

  created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

// =========================================================================
// ODDS SNAPSHOTS (Wolfman raw captures, append-only)
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

  ah_line: numeric('ah_line', { precision: 4, scale: 2 }),
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

  recommended_book: text('recommended_book'),
  recommended_odds_american: integer('recommended_odds_american'),
  recommended_stake_cents: bigint('recommended_stake_cents', { mode: 'bigint' }),
  kelly_fraction_used: numeric('kelly_fraction_used', { precision: 5, scale: 4 }),
  bankroll_pct: numeric('bankroll_pct', { precision: 5, scale: 2 }),
  star_rating: numeric('star_rating', { precision: 3, scale: 1 }),

  pass_reason: text('pass_reason'),
  watch_reason: text('watch_reason'),
  watch_for: text('watch_for'),

  raw_edge_pct: numeric('raw_edge_pct', { precision: 6, scale: 3 }),
  adjusted_edge_pct: numeric('adjusted_edge_pct', { precision: 6, scale: 3 }),
  walters_writeup: text('walters_writeup'),

  agent_inputs_snapshot: jsonb('agent_inputs_snapshot').notNull(),
  discipline_gates_passed: jsonb('discipline_gates_passed'),
  discipline_gates_failed: jsonb('discipline_gates_failed'),

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

  settlement_status: text('settlement_status').notNull().default('pending'),
  // 'pending', 'settled', 'void', 'cancelled'
  outcome: text('outcome'),  // 'win', 'loss', 'push', 'half_win', 'half_loss'
  payout_cents: bigint('payout_cents', { mode: 'bigint' }),
  pl_cents: bigint('pl_cents', { mode: 'bigint' }),
  settled_at: timestamp('settled_at', { withTimezone: true }),

  closing_line_american: integer('closing_line_american'),
  closing_line_no_vig_prob: numeric('closing_line_no_vig_prob', { precision: 5, scale: 4 }),
  bet_no_vig_prob: numeric('bet_no_vig_prob', { precision: 5, scale: 4 }),
  clv_cents: numeric('clv_cents', { precision: 6, scale: 2 }),
  clv_classification: text('clv_classification'),

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
  // 'bet_placed', 'bet_settled', 'deposit', 'withdrawal', 'adjustment'
  amount_cents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
  balance_after_cents: bigint('balance_after_cents', { mode: 'bigint' }).notNull(),
  reference_id: uuid('reference_id'),
  notes: text('notes'),
  source: text('source').notNull(),
  // 'ceo_verdict', 'manual', 'system_settlement', 'system_adjustment'

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
// AGENT RUNS (logging — no silent failures)
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
