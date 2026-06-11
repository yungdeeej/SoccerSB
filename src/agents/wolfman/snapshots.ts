/**
 * Pure parsing: The Odds API event → odds_snapshots rows.
 * Market key conventions per 07_SHARED_CONTRACTS.md:
 *   match_outcome_home | match_outcome_draw | match_outcome_away
 *   total_over_2.5 | total_under_2.5
 *   asian_handicap_home_-0.5 | asian_handicap_away_+1.25
 */
import { americanToDecimal } from '../../shared/utils/odds';
import type { OddsEvent } from './odds_api';

export interface SnapshotRow {
  match_id: string;
  book: string;
  market: string;
  side: string;
  american_odds: number;
  decimal_odds: string;
  total_line: string | null;
  ah_line: string | null;
  is_closing_line: boolean;
}

function fmtLine(point: number): string {
  return point > 0 ? `+${point}` : `${point}`;
}

/** Books whose keys differ between The Odds API and our books.json convention. */
const BOOK_KEY_MAP: Record<string, string> = {
  bet365: 'bet365_eu',
  williamhill_us: 'caesars',  // Caesars runs on the William Hill key in some regions
  betonlineag: 'betonline',
  lowvig: 'lowvig'
};

export function normalizeBookKey(apiKey: string): string {
  return BOOK_KEY_MAP[apiKey] ?? apiKey;
}

/**
 * Parse one event's bookmaker odds into snapshot rows.
 * Unknown market keys are ignored (we only handle h2h_3_way, totals, spreads).
 */
export function parseEventSnapshots(
  event: OddsEvent,
  match_id: string,
  isClosing: boolean
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];

  for (const bookmaker of event.bookmakers) {
    const book = normalizeBookKey(bookmaker.key);

    for (const market of bookmaker.markets) {
      if (market.key === 'h2h_3_way' || market.key === 'h2h') {
        for (const outcome of market.outcomes) {
          if (outcome.price === 0) continue;
          let side: 'home' | 'draw' | 'away' | null = null;
          if (outcome.name === event.home_team) side = 'home';
          else if (outcome.name === event.away_team) side = 'away';
          else if (outcome.name.toLowerCase() === 'draw') side = 'draw';
          if (!side) continue;

          rows.push({
            match_id, book,
            market: `match_outcome_${side}`,
            side,
            american_odds: outcome.price,
            decimal_odds: americanToDecimal(outcome.price).toFixed(4),
            total_line: null,
            ah_line: null,
            is_closing_line: isClosing
          });
        }
      } else if (market.key === 'totals') {
        for (const outcome of market.outcomes) {
          if (outcome.point === undefined || outcome.price === 0) continue;
          const dir = outcome.name.toLowerCase();
          if (dir !== 'over' && dir !== 'under') continue;

          rows.push({
            match_id, book,
            market: `total_${dir}_${outcome.point}`,
            side: dir,
            american_odds: outcome.price,
            decimal_odds: americanToDecimal(outcome.price).toFixed(4),
            total_line: outcome.point.toFixed(2),
            ah_line: null,
            is_closing_line: isClosing
          });
        }
      } else if (market.key === 'spreads') {
        for (const outcome of market.outcomes) {
          if (outcome.point === undefined || outcome.price === 0) continue;
          let side: 'home' | 'away' | null = null;
          if (outcome.name === event.home_team) side = 'home';
          else if (outcome.name === event.away_team) side = 'away';
          if (!side) continue;

          rows.push({
            match_id, book,
            market: `asian_handicap_${side}_${fmtLine(outcome.point)}`,
            side,
            american_odds: outcome.price,
            decimal_odds: americanToDecimal(outcome.price).toFixed(4),
            total_line: null,
            ah_line: outcome.point.toFixed(2),
            is_closing_line: isClosing
          });
        }
      }
      // other market keys ignored in v1
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Polling cadence (04_AGENT_WOLFMAN.md)
// ---------------------------------------------------------------------------

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Polling interval for a match given time to kickoff.
 * Returns null when the match no longer needs scheduled polling.
 */
export function pollIntervalMs(msToKickoff: number, reducedMode: boolean): number | null {
  if (msToKickoff < -3 * HOUR) return null;          // well past kickoff — post-match poll handled separately
  if (msToKickoff <= 0) return 30 * MIN;             // in-play: light verification polling

  if (reducedMode) {
    // Quota guard: 15min minimum, 5min only in the final hour
    if (msToKickoff <= 1 * HOUR) return 5 * MIN;
    return 15 * MIN;
  }

  if (msToKickoff > 2 * DAY) return 6 * HOUR;
  if (msToKickoff > 12 * HOUR) return 2 * HOUR;
  if (msToKickoff > 3 * HOUR) return 30 * MIN;
  if (msToKickoff > 1 * HOUR) return 15 * MIN;
  if (msToKickoff > 15 * MIN) return 5 * MIN;
  return 2 * MIN;
}

/** Closing-line window: T-90s to kickoff. */
export function isClosingWindow(msToKickoff: number): boolean {
  return msToKickoff <= 90 * 1000 && msToKickoff > 0;
}
