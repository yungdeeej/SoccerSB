/**
 * Asian/Western divergence — the signature soccer signal. Only meaningful on
 * totals and Asian handicap; for 1X2, Pinnacle is the sole anchor.
 */
import { americanToDecimal } from '../../../shared/utils/odds';
import { latestPerBook, type MarketSnapshotSeries } from './types';

export interface AsianWesternDivergence {
  detected: boolean;
  magnitude_cents: number;
  asian_implied_pct: number | null;
  western_implied_pct: number | null;
  actionable_side: 'asian_aligned' | 'western_aligned' | null;
  explanation: string | null;
}

const ASIAN_BOOKS = ['sbobet', 'ibc', '188bet'];
const WESTERN_SHARP_BOOKS = ['pinnacle', 'bet365_eu'];
const ACTIONABLE_THRESHOLD_CENTS = 4;

const NOT_DETECTED: AsianWesternDivergence = {
  detected: false, magnitude_cents: 0, asian_implied_pct: null,
  western_implied_pct: null, actionable_side: null, explanation: null
};

export function appliesTo(market: string): boolean {
  return market.startsWith('total_') || market.startsWith('asian_handicap_');
}

export function detectAsianWesternDivergence(
  market: string,
  series: MarketSnapshotSeries
): AsianWesternDivergence {
  if (!appliesTo(market)) return NOT_DETECTED;

  const latest = latestPerBook(series);
  const asian = latest.filter((s) => ASIAN_BOOKS.includes(s.book));
  const western = latest.filter((s) => WESTERN_SHARP_BOOKS.includes(s.book));
  if (asian.length === 0 || western.length === 0) return NOT_DETECTED;

  const avgImplied = (snaps: typeof latest): number =>
    snaps.reduce((sum, s) => sum + 1 / americanToDecimal(s.american_odds), 0) / snaps.length;

  const asianImplied = avgImplied(asian);
  const westernImplied = avgImplied(western);
  const divergenceCents = (asianImplied - westernImplied) * 100;

  if (Math.abs(divergenceCents) < ACTIONABLE_THRESHOLD_CENTS) {
    return {
      ...NOT_DETECTED,
      magnitude_cents: divergenceCents,
      asian_implied_pct: asianImplied * 100,
      western_implied_pct: westernImplied * 100
    };
  }

  return {
    detected: true,
    magnitude_cents: divergenceCents,
    asian_implied_pct: asianImplied * 100,
    western_implied_pct: westernImplied * 100,
    actionable_side: divergenceCents > 0 ? 'asian_aligned' : 'western_aligned',
    explanation:
      `Asian/Western divergence: Asian books implying ${(asianImplied * 100).toFixed(1)}%, ` +
      `Western implying ${(westernImplied * 100).toFixed(1)}%. Gap ${divergenceCents.toFixed(1)}¢.`
  };
}
