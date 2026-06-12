/** Steam detection — tier-weighted coordinated movement in a 30min window. */
import { getBookTier, type BookTier, type MarketSnapshotSeries } from './types';

export interface SteamSignal {
  detected: boolean;
  weight: number;
  books_involved: string[];
  explanation: string | null;
  window_minutes: number;
}

const WINDOW_MS = 30 * 60 * 1000;       // 30min for soccer (vs 10 for NHL)
const MIN_MOVEMENT_CENTS = 3;           // soccer lines are less noisy
const WEIGHT_THRESHOLD = 1.8;

const TIER_WEIGHTS: Record<BookTier, number> = {
  sharp: 1.0,
  sharp_adjacent: 0.6,
  soft: 0.3
};

export function detectSteam(series: MarketSnapshotSeries, now: Date = new Date()): SteamSignal {
  let signalWeight = 0;
  const movedBooks: string[] = [];

  for (const [book, snapshots] of series) {
    const recent = snapshots.filter((s) => now.getTime() - s.captured_at.getTime() < WINDOW_MS);
    if (recent.length < 2) continue;

    const movement = recent[recent.length - 1].american_odds - recent[0].american_odds;
    if (Math.abs(movement) >= MIN_MOVEMENT_CENTS) {
      signalWeight += TIER_WEIGHTS[getBookTier(book)];
      movedBooks.push(book);
    }
  }

  const detected = signalWeight >= WEIGHT_THRESHOLD;
  return {
    detected,
    weight: signalWeight,
    books_involved: movedBooks,
    explanation: detected
      ? `Steam: ${movedBooks.join(', ')} moved ≥${MIN_MOVEMENT_CENTS}¢ in 30min window (weight: ${signalWeight.toFixed(1)})`
      : null,
    window_minutes: WINDOW_MS / 60000
  };
}
