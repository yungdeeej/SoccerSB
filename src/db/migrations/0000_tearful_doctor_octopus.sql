CREATE TABLE IF NOT EXISTS "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"match_id" uuid,
	"run_phase" text,
	"status" text NOT NULL,
	"duration_ms" integer,
	"error_message" text,
	"error_stack" text,
	"outputs_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bankroll_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_type" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"reference_id" uuid,
	"notes" text,
	"source" text NOT NULL,
	"peak_bankroll_at_entry_cents" bigint,
	"drawdown_pct_at_entry" numeric(5, 2),
	"stop_loss_state_at_entry" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verdict_id" uuid,
	"match_id" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market" text NOT NULL,
	"side" text NOT NULL,
	"book" text NOT NULL,
	"stake_cents" bigint NOT NULL,
	"american_odds" integer NOT NULL,
	"decimal_odds" numeric(8, 4) NOT NULL,
	"potential_payout_cents" bigint,
	"settlement_status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"payout_cents" bigint,
	"pl_cents" bigint,
	"settled_at" timestamp with time zone,
	"closing_line_american" integer,
	"closing_line_no_vig_prob" numeric(5, 4),
	"bet_no_vig_prob" numeric(5, 4),
	"clv_cents" numeric(6, 2),
	"clv_classification" text,
	"stop_loss_state_at_placement" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_intelligence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"markets" jsonb NOT NULL,
	"cross_market_observations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "match_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"run_phase" text NOT NULL,
	"home_xi_status" text,
	"away_xi_status" text,
	"home_xi_confidence" integer,
	"away_xi_confidence" integer,
	"home_confirmed_xi" jsonb,
	"away_confirmed_xi" jsonb,
	"home_absences" jsonb,
	"away_absences" jsonb,
	"home_cluster_score" numeric(4, 2),
	"away_cluster_score" numeric(4, 2),
	"beat_reporter_signals" jsonb,
	"flagged_concerns" jsonb,
	"source_failures" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fifa_match_id" integer NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"referee_id" uuid,
	"tournament_stage" text NOT NULL,
	"group_letter" text,
	"scheduled_kickoff_utc" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"home_score_ht" integer,
	"away_score_ht" integer,
	"went_to_extra_time" boolean DEFAULT false,
	"went_to_penalties" boolean DEFAULT false,
	"penalty_winner" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_fifa_match_id_unique" UNIQUE("fifa_match_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"predicted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model_version" text NOT NULL,
	"xi_status" text NOT NULL,
	"expected_goals_home" numeric(5, 3),
	"expected_goals_away" numeric(5, 3),
	"goal_correlation" numeric(4, 3),
	"predictions" jsonb NOT NULL,
	"confidence_interval" jsonb,
	"rating_components" jsonb,
	"inputs_quality_score" integer,
	"warnings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"version" text NOT NULL,
	"deployed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config_snapshot" jsonb,
	"change_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "odds_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"book" text NOT NULL,
	"market" text NOT NULL,
	"side" text,
	"american_odds" integer NOT NULL,
	"decimal_odds" numeric(8, 4),
	"ah_line" numeric(4, 2),
	"total_line" numeric(4, 2),
	"is_closing_line" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fifa_player_id" integer,
	"full_name" text NOT NULL,
	"team_id" uuid,
	"position" text NOT NULL,
	"position_group" text NOT NULL,
	"is_captain" boolean DEFAULT false,
	"is_alternate_captain" boolean DEFAULT false,
	"market_value_eur_m" numeric(6, 2),
	"club" text,
	"club_xg90" numeric(5, 3),
	"club_xga90" numeric(5, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fifa_referee_id" integer,
	"full_name" text NOT NULL,
	"nationality" text,
	"cards_per_match" numeric(4, 2),
	"penalties_per_match" numeric(4, 2),
	"added_time_avg_minutes" numeric(4, 2),
	"home_team_card_rate" numeric(4, 3),
	"var_intervention_rate" numeric(4, 3),
	"last_updated" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "situational_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"coefficient_version" text NOT NULL,
	"raw_quant_probs" jsonb,
	"adjusted_probs" jsonb,
	"home_xg_modifier" numeric(5, 3),
	"away_xg_modifier" numeric(5, 3),
	"totals_offset" numeric(5, 3),
	"factor_breakdown" jsonb NOT NULL,
	"flags" jsonb,
	"total_adjustment_capped" boolean DEFAULT false,
	"combined_advantage_home" numeric(5, 3),
	"inputs_quality_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fifa_team_id" integer,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"confederation" text NOT NULL,
	"elo_rating" numeric(6, 1),
	"elo_last_updated" timestamp with time zone,
	"market_value_squad_eur_m" numeric(8, 2),
	"market_value_xi_eur_m" numeric(8, 2),
	"market_value_last_updated" timestamp with time zone,
	"attack_rating" numeric(5, 3),
	"defense_rating" numeric(5, 3),
	"composite_z" numeric(5, 3),
	"rolling_8_match" jsonb,
	"club_xg_aggregate" jsonb,
	"recent_form_score" numeric(4, 3),
	"home_base_lat" numeric(8, 5),
	"home_base_lng" numeric(9, 5),
	"altitude_acclimation_meters" integer,
	"press_intensity" text,
	"possession_orientation" text,
	"defensive_structure" text,
	"set_piece_reliance" text,
	"style_directness_score" numeric(4, 3),
	"bench_quality_z" numeric(4, 3),
	"set_piece_goals_per_match" numeric(4, 3),
	"set_piece_defense_z" numeric(4, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_fifa_team_id_unique" UNIQUE("fifa_team_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fifa_venue_id" integer,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"latitude" numeric(8, 5) NOT NULL,
	"longitude" numeric(9, 5) NOT NULL,
	"altitude_meters" integer NOT NULL,
	"surface_type" text,
	"capacity" integer,
	"is_indoor" boolean DEFAULT false,
	"is_outdoor" boolean DEFAULT true,
	"timezone" text NOT NULL,
	"is_high_altitude" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verdicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"run_phase" text NOT NULL,
	"market" text NOT NULL,
	"side" text NOT NULL,
	"decision" text NOT NULL,
	"recommended_book" text,
	"recommended_odds_american" integer,
	"recommended_stake_cents" bigint,
	"kelly_fraction_used" numeric(5, 4),
	"bankroll_pct" numeric(5, 2),
	"star_rating" numeric(3, 1),
	"pass_reason" text,
	"watch_reason" text,
	"watch_for" text,
	"raw_edge_pct" numeric(6, 3),
	"adjusted_edge_pct" numeric(6, 3),
	"walters_writeup" text,
	"agent_inputs_snapshot" jsonb NOT NULL,
	"discipline_gates_passed" jsonb,
	"discipline_gates_failed" jsonb,
	"superseded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_verdict_id_verdicts_id_fk" FOREIGN KEY ("verdict_id") REFERENCES "public"."verdicts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bets" ADD CONSTRAINT "bets_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_intelligence" ADD CONSTRAINT "market_intelligence_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "match_contexts" ADD CONSTRAINT "match_contexts_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "matches" ADD CONSTRAINT "matches_referee_id_referees_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."referees"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_predictions" ADD CONSTRAINT "model_predictions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "players" ADD CONSTRAINT "players_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "situational_adjustments" ADD CONSTRAINT "situational_adjustments_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "verdicts" ADD CONSTRAINT "verdicts_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_agent" ON "agent_runs" USING btree ("agent");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_status" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_runs_ran" ON "agent_runs" USING btree ("ran_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ledger_occurred" ON "bankroll_ledger" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ledger_reference" ON "bankroll_ledger" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bets_match" ON "bets" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bets_settlement" ON "bets" USING btree ("settlement_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bets_placed" ON "bets" USING btree ("placed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_matches_kickoff" ON "matches" USING btree ("scheduled_kickoff_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_matches_status" ON "matches" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_predictions_match" ON "model_predictions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_predictions_predicted" ON "model_predictions" USING btree ("predicted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_odds_match_market" ON "odds_snapshots" USING btree ("match_id","market","side");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_odds_captured" ON "odds_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_odds_closing" ON "odds_snapshots" USING btree ("is_closing_line");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verdicts_match" ON "verdicts" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verdicts_decision" ON "verdicts" USING btree ("decision");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_verdicts_issued" ON "verdicts" USING btree ("issued_at");