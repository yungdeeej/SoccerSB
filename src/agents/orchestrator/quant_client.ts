/**
 * QuantClient — TypeScript orchestrator's HTTP client for the Python Quant
 * service. Every response is zod-validated (never trust the wire).
 */
import { z } from 'zod';

const MatchOutcomeSchema = z.object({
  home_win_prob: z.number(),
  draw_prob: z.number(),
  away_win_prob: z.number()
});

export const QuantPredictionSchema = z.object({
  prediction_id: z.string(),
  match_id: z.string(),
  model_version: z.string(),
  predicted_at: z.string(),
  expected_goals: z.object({ home: z.number(), away: z.number(), total: z.number() }),
  predictions: z.object({
    match_outcome: MatchOutcomeSchema,
    double_chance: z.record(z.string(), z.number()),
    draw_no_bet: z.record(z.string(), z.number()),
    totals: z.record(z.string(), z.object({ over: z.number(), under: z.number() })),
    asian_handicap: z.record(z.string(), z.object({ home_covers: z.number(), away_covers: z.number() })),
    both_teams_to_score: z.object({ yes_prob: z.number(), no_prob: z.number() }),
    halftime_fulltime: z.record(z.string(), z.number()),
    halftime_totals: z.record(z.string(), z.object({ over: z.number(), under: z.number() }))
  }),
  confidence_interval: z.object({
    method: z.string(),
    iterations: z.number(),
    home_win_ci_width: z.number(),
    draw_ci_width: z.number(),
    away_win_ci_width: z.number(),
    low_confidence_flag: z.boolean()
  }),
  rating_components: z.record(z.string(), z.number().nullable()),
  diagnostic: z.object({
    inputs_quality_score: z.number(),
    warnings: z.array(z.string()),
    xi_status: z.string()
  })
});

export type QuantPrediction = z.infer<typeof QuantPredictionSchema>;

export const QuantHealthSchema = z.object({
  model_version: z.string(),
  database: z.string(),
  teams_with_elo: z.number().optional(),
  last_rating_update: z.string().nullable().optional(),
  backtest_passed: z.boolean(),
  backtest_brier: z.number().nullable().optional()
});

export type QuantHealth = z.infer<typeof QuantHealthSchema>;

export class QuantClient {
  constructor(private baseUrl: string = process.env.QUANT_SERVICE_URL ?? 'http://localhost:8001') {}

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Quant service ${path} returned ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }

  async predict(matchId: string): Promise<QuantPrediction> {
    const json = await this.post('/predict', { match_id: matchId });
    return QuantPredictionSchema.parse(json);
  }

  async updateRatings(includeMarketValues = false): Promise<unknown> {
    return this.post('/ratings/update', { include_market_values: includeMarketValues });
  }

  async runBacktest(tournament = 'all_majors'): Promise<unknown> {
    return this.post('/backtest', { tournament, calibrate: false });
  }

  async checkHealth(): Promise<QuantHealth | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      return QuantHealthSchema.parse(await res.json());
    } catch {
      return null;
    }
  }
}

export const quantClient = new QuantClient();
