ALTER TABLE "model_versions" ADD COLUMN "backtest_passed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN "backtest_brier" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "model_versions" ADD COLUMN "backtest_median_clv_cents" numeric(6, 2);