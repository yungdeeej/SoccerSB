/**
 * Market state — the minimum viable market intel layer (Phase 1).
 * Consensus, Pinnacle/Sbobet anchors, best operator-accessible price,
 * movement since opening. NO steam/RLM/divergence/timing — Phase 3.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { odds_snapshots } from '../../db/schema';
import { americanToDecimal, decimalToAmerican, stripVigThreeWay, stripVigTwoWay } from '../../shared/utils/odds';
import { logAgentRun } from './agent_log';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface MarketState {
  match_id: string;
  market: string;

  current_consensus_american: number;
  pinnacle_current_american: number | null;
  pinnacle_no_vig_prob: number | null;
  sbobet_current_american: number | null;

  best_book: string;
  best_book_american: number;
  best_book_decimal: number;

  opening_consensus_american: number;
  total_movement_cents: number;

  no_vig_probability: number;
  computed_at: string;
}

interface SnapshotLike {
  book: string;
  market: string;
  side: string | null;
  american_odds: number;
  captured_at: Date;
}

interface BooksConfig {
  tier_1_sharp: Array<{ key: string; operator_accessible: boolean }>;
  tier_2_sharp_adjacent: Array<{ key: string; operator_accessible: boolean }>;
  tier_3_soft_retail: Array<{ key: string; operator_accessible: boolean }>;
}

let operatorBooksCache: Set<string> | null = null;

export function operatorAccessibleBooks(): Set<string> {
  if (operatorBooksCache) return operatorBooksCache;
  const raw = readFileSync(join(__dirname, '../../shared/config/books.json'), 'utf-8');
  const cfg = JSON.parse(raw) as BooksConfig;
  const all = [...cfg.tier_1_sharp, ...cfg.tier_2_sharp_adjacent, ...cfg.tier_3_soft_retail];
  operatorBooksCache = new Set(all.filter((b) => b.operator_accessible).map((b) => b.key));
  return operatorBooksCache;
}

/** Group a market key into its no-vig "family" so vig can be stripped. */
export function marketFamily(market: string): { family: string; member: string } | null {
  if (market.startsWith('match_outcome_')) {
    return { family: 'match_outcome', member: market.slice('match_outcome_'.length) };
  }
  const totalMatch = /^total_(over|under)_(.+)$/.exec(market);
  if (totalMatch) {
    return { family: `total_${totalMatch[2]}`, member: totalMatch[1] };
  }
  const ahMatch = /^asian_handicap_(home|away)_([+-].+)$/.exec(market);
  if (ahMatch) {
    // home -0.5 pairs with away +0.5 — family keyed by absolute line on home side
    const line = parseFloat(ahMatch[2]);
    const homeLine = ahMatch[1] === 'home' ? line : -line;
    return { family: `ah_${homeLine}`, member: ahMatch[1] };
  }
  return null;
}

/**
 * Pure computation from an ordered (oldest→newest) snapshot list.
 */
export function computeMarketStates(
  match_id: string,
  snapshots: SnapshotLike[],
  accessibleBooks: Set<string>
): MarketState[] {
  // market → book → { first, last }
  const series = new Map<string, Map<string, { first: SnapshotLike; last: SnapshotLike }>>();

  for (const snap of snapshots) {
    let byBook = series.get(snap.market);
    if (!byBook) {
      byBook = new Map();
      series.set(snap.market, byBook);
    }
    const entry = byBook.get(snap.book);
    if (!entry) byBook.set(snap.book, { first: snap, last: snap });
    else entry.last = snap;
  }

  // Pinnacle no-vig needs complete families — collect Pinnacle latest per family member
  const pinnacleByFamily = new Map<string, Map<string, number>>();
  for (const [market, byBook] of series) {
    const pin = byBook.get('pinnacle');
    if (!pin) continue;
    const fam = marketFamily(market);
    if (!fam) continue;
    let members = pinnacleByFamily.get(fam.family);
    if (!members) {
      members = new Map();
      pinnacleByFamily.set(fam.family, members);
    }
    members.set(fam.member, pin.last.american_odds);
  }

  function pinnacleNoVig(market: string): number | null {
    const fam = marketFamily(market);
    if (!fam) return null;
    const members = pinnacleByFamily.get(fam.family);
    if (!members) return null;

    if (fam.family === 'match_outcome') {
      const h = members.get('home'), d = members.get('draw'), a = members.get('away');
      if (h === undefined || d === undefined || a === undefined) return null;
      const { home_no_vig, draw_no_vig, away_no_vig } = stripVigThreeWay(h, d, a);
      return fam.member === 'home' ? home_no_vig : fam.member === 'draw' ? draw_no_vig : away_no_vig;
    }

    // two-way families (totals over/under, AH home/away)
    const keys = [...members.keys()];
    if (keys.length < 2) return null;
    const aKey = fam.member;
    const bKey = keys.find((k) => k !== aKey);
    if (!bKey || members.get(aKey) === undefined) return null;
    const { side_a_no_vig } = stripVigTwoWay(members.get(aKey)!, members.get(bKey)!);
    return side_a_no_vig;
  }

  const states: MarketState[] = [];
  const computed_at = new Date().toISOString();

  for (const [market, byBook] of series) {
    const latest = [...byBook.values()].map((e) => e.last);
    const earliest = [...byBook.values()].map((e) => e.first);
    if (latest.length === 0) continue;

    const avgDecimal = (rows: SnapshotLike[]): number =>
      rows.reduce((sum, r) => sum + americanToDecimal(r.american_odds), 0) / rows.length;

    const currentConsensus = decimalToAmerican(avgDecimal(latest));
    const openingConsensus = decimalToAmerican(avgDecimal(earliest));

    const pin = byBook.get('pinnacle')?.last ?? null;
    const sbo = byBook.get('sbobet')?.last ?? null;

    // Best operator-accessible price = highest decimal among accessible books
    let best: SnapshotLike | null = null;
    for (const snap of latest) {
      if (!accessibleBooks.has(snap.book)) continue;
      if (!best || americanToDecimal(snap.american_odds) > americanToDecimal(best.american_odds)) {
        best = snap;
      }
    }
    if (!best) {
      // No accessible book carries this market — fall back to consensus so the row still renders
      best = latest[0];
    }

    const pinNoVig = pin ? pinnacleNoVig(market) : null;
    const fallbackImplied = 1 / americanToDecimal(currentConsensus);

    states.push({
      match_id,
      market,
      current_consensus_american: currentConsensus,
      pinnacle_current_american: pin?.american_odds ?? null,
      pinnacle_no_vig_prob: pinNoVig,
      sbobet_current_american: sbo?.american_odds ?? null,
      best_book: best.book,
      best_book_american: best.american_odds,
      best_book_decimal: Number(americanToDecimal(best.american_odds).toFixed(4)),
      opening_consensus_american: openingConsensus,
      total_movement_cents: currentConsensus - openingConsensus,
      no_vig_probability: pinNoVig ?? fallbackImplied,
      computed_at
    });
  }

  return states;
}

/** Load snapshots for a match and compute current market states. */
export async function getMarketStates(match_id: string): Promise<MarketState[]> {
  const started = Date.now();
  const rows = await db
    .select({
      book: odds_snapshots.book,
      market: odds_snapshots.market,
      side: odds_snapshots.side,
      american_odds: odds_snapshots.american_odds,
      captured_at: odds_snapshots.captured_at
    })
    .from(odds_snapshots)
    .where(eq(odds_snapshots.match_id, match_id))
    .orderBy(asc(odds_snapshots.captured_at));

  const states = computeMarketStates(match_id, rows, operatorAccessibleBooks());

  await logAgentRun({
    agent: 'wolfman',
    run_phase: 'market_state_compute',
    status: 'success',
    duration_ms: Date.now() - started,
    match_id,
    outputs_summary: { markets_computed: states.length, snapshots_considered: rows.length }
  });

  return states;
}
