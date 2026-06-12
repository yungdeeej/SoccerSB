/** Shared signal types — Phase 3 full Wolfman. */

export interface SnapshotPoint {
  book: string;
  american_odds: number;
  captured_at: Date;
}

/** book → chronological snapshots (oldest first) for one market. */
export type MarketSnapshotSeries = Map<string, SnapshotPoint[]>;

export type BookTier = 'sharp' | 'sharp_adjacent' | 'soft';

const TIER_BY_BOOK: Record<string, BookTier> = {
  pinnacle: 'sharp', sbobet: 'sharp', ibc: 'sharp',
  bet365_eu: 'sharp_adjacent', caesars_vegas: 'sharp_adjacent', stake: 'sharp_adjacent'
};

export function getBookTier(book: string): BookTier {
  return TIER_BY_BOOK[book] ?? 'soft';
}

export function latestPerBook(series: MarketSnapshotSeries): SnapshotPoint[] {
  const out: SnapshotPoint[] = [];
  for (const snapshots of series.values()) {
    if (snapshots.length > 0) out.push(snapshots[snapshots.length - 1]);
  }
  return out;
}
