/**
 * The Odds API client — the Wolfman's only external data source in Phase 1.
 * Every response is zod-validated before anything touches the database.
 * Quota headers are surfaced on every call so polling can adapt.
 */
import { z } from 'zod';

export const SPORT_KEY = 'soccer_fifa_world_cup';
const BASE_URL = 'https://api.the-odds-api.com/v4';

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

const OutcomeSchema = z.object({
  name: z.string(),
  price: z.number(),
  point: z.number().optional()
});

const MarketSchema = z.object({
  key: z.string(),  // 'h2h_3_way' | 'h2h' | 'totals' | 'spreads' | others we ignore
  last_update: z.string().optional(),
  outcomes: z.array(OutcomeSchema)
});

const BookmakerSchema = z.object({
  key: z.string(),
  title: z.string(),
  last_update: z.string().optional(),
  markets: z.array(MarketSchema)
});

export const OddsEventSchema = z.object({
  id: z.string(),
  sport_key: z.string(),
  commence_time: z.string(),  // ISO UTC
  home_team: z.string(),
  away_team: z.string(),
  bookmakers: z.array(BookmakerSchema).default([])
});

export const OddsResponseSchema = z.array(OddsEventSchema);

export type OddsEvent = z.infer<typeof OddsEventSchema>;
export type OddsBookmaker = z.infer<typeof BookmakerSchema>;
export type OddsMarket = z.infer<typeof MarketSchema>;
export type OddsOutcome = z.infer<typeof OutcomeSchema>;

export interface OddsApiResult {
  events: OddsEvent[];
  /** From x-requests-used response header */
  creditsUsed: number | null;
  /** From x-requests-remaining response header */
  creditsRemaining: number | null;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class OddsApiError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'OddsApiError';
  }
}

export async function fetchWorldCupOdds(opts?: {
  markets?: string;
  regions?: string;
}): Promise<OddsApiResult> {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    throw new OddsApiError('ODDS_API_KEY is not set — populate .env to enable live odds');
  }

  const params = new URLSearchParams({
    apiKey,
    regions: opts?.regions ?? 'us,us2,uk,eu',
    markets: opts?.markets ?? 'h2h_3_way,totals,spreads',
    oddsFormat: 'american'
  });

  const url = `${BASE_URL}/sports/${SPORT_KEY}/odds?${params.toString()}`;

  let response: globalThis.Response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new OddsApiError(
      `Network error reaching The Odds API: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new OddsApiError(
      `The Odds API returned ${response.status}: ${body.slice(0, 300)}`,
      response.status
    );
  }

  const json: unknown = await response.json();
  const parsed = OddsResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new OddsApiError(`The Odds API response failed validation: ${parsed.error.message.slice(0, 500)}`);
  }

  const used = response.headers.get('x-requests-used');
  const remaining = response.headers.get('x-requests-remaining');

  return {
    events: parsed.data,
    creditsUsed: used !== null ? Number(used) : null,
    creditsRemaining: remaining !== null ? Number(remaining) : null
  };
}
