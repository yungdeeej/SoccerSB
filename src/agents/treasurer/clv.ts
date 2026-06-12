/**
 * CLV engine — closing line value computed automatically on settlement.
 * Three-way strip for 1X2, two-way for totals/AH/BTTS. Degrades gracefully
 * when the closing line wasn't captured (retry 5min → 30min → give up).
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { bets, odds_snapshots } from '../../db/schema';
import { stripVigThreeWay, stripVigTwoWay } from '../../shared/utils/odds';
import { logAgentRun } from '../wolfman/agent_log';

export type CLVBetClassification = 'beat_close' | 'matched_close' | 'lost_to_close';

export interface CLVResult {
  clv_cents: number;
  classification: CLVBetClassification;
  bet_no_vig_prob: number;
  closing_no_vig_prob: number;
  closing_line_american: number;
}

export function classifyBetCLV(clv_cents: number): CLVBetClassification {
  if (clv_cents > 0.5) return 'beat_close';
  if (clv_cents < -0.5) return 'lost_to_close';
  return 'matched_close';
}

/** Pure: two-way CLV from bet odds + closing odds (same side) + closing opposing odds. */
export function computeTwoWayCLV(
  bet_american: number,
  closing_american: number,
  closing_opposing_american: number
): Omit<CLVResult, 'closing_line_american'> {
  const bet_no_vig = stripVigTwoWay(bet_american, closing_opposing_american).side_a_no_vig;
  const closing_no_vig = stripVigTwoWay(closing_american, closing_opposing_american).side_a_no_vig;
  const clv_cents = (closing_no_vig - bet_no_vig) * 100;
  return { clv_cents, classification: classifyBetCLV(clv_cents), bet_no_vig_prob: bet_no_vig, closing_no_vig_prob: closing_no_vig };
}

/** Pure: three-way CLV (1X2) — both other sides at close are needed to strip. */
export function computeThreeWayCLV(
  side: 'home' | 'draw' | 'away',
  bet_american: number,
  closing: { home: number; draw: number; away: number }
): Omit<CLVResult, 'closing_line_american'> {
  const betStrip = stripVigThreeWay(
    side === 'home' ? bet_american : closing.home,
    side === 'draw' ? bet_american : closing.draw,
    side === 'away' ? bet_american : closing.away
  );
  const closeStrip = stripVigThreeWay(closing.home, closing.draw, closing.away);

  const pick = (s: typeof betStrip): number =>
    side === 'home' ? s.home_no_vig : side === 'draw' ? s.draw_no_vig : s.away_no_vig;

  const bet_no_vig = pick(betStrip);
  const closing_no_vig = pick(closeStrip);
  const clv_cents = (closing_no_vig - bet_no_vig) * 100;
  return { clv_cents, classification: classifyBetCLV(clv_cents), bet_no_vig_prob: bet_no_vig, closing_no_vig_prob: closing_no_vig };
}

export function opposingMarketKey(market: string): string | null {
  let m = /^total_(over|under)_(.+)$/.exec(market);
  if (m) return `total_${m[1] === 'over' ? 'under' : 'over'}_${m[2]}`;
  m = /^asian_handicap_(home|away)_([+-].+)$/.exec(market);
  if (m) {
    const line = parseFloat(m[2]);
    const oppLine = -line;
    const oppKey = oppLine > 0 ? `+${oppLine}` : String(oppLine);
    return `asian_handicap_${m[1] === 'home' ? 'away' : 'home'}_${oppKey}`;
  }
  if (market === 'btts_yes') return 'btts_no';
  if (market === 'btts_no') return 'btts_yes';
  return null;
}

async function closingSnapshot(match_id: string, market: string): Promise<{ american_odds: number } | null> {
  // Prefer flagged closing line; fall back to last pre-kickoff snapshot
  const [flagged] = await db
    .select({ american_odds: odds_snapshots.american_odds })
    .from(odds_snapshots)
    .where(and(
      eq(odds_snapshots.match_id, match_id),
      eq(odds_snapshots.market, market),
      eq(odds_snapshots.is_closing_line, true)
    ))
    .orderBy(desc(odds_snapshots.captured_at))
    .limit(1);
  if (flagged) return flagged;

  const [last] = await db
    .select({ american_odds: odds_snapshots.american_odds })
    .from(odds_snapshots)
    .where(and(eq(odds_snapshots.match_id, match_id), eq(odds_snapshots.market, market)))
    .orderBy(desc(odds_snapshots.captured_at))
    .limit(1);
  return last ?? null;
}

/**
 * Compute + persist CLV for a settled bet. Returns null when closing data is
 * missing (caller retries). Never throws into the settlement path.
 */
export async function computeCLVForBet(bet_id: string): Promise<CLVResult | null> {
  const [bet] = await db.select().from(bets).where(eq(bets.id, bet_id)).limit(1);
  if (!bet || bet.settlement_status !== 'settled') return null;

  let result: Omit<CLVResult, 'closing_line_american'> | null = null;
  let closingAmerican: number | null = null;

  if (bet.market.startsWith('match_outcome_')) {
    const [home, draw, away] = await Promise.all([
      closingSnapshot(bet.match_id, 'match_outcome_home'),
      closingSnapshot(bet.match_id, 'match_outcome_draw'),
      closingSnapshot(bet.match_id, 'match_outcome_away')
    ]);
    if (!home || !draw || !away) return null;
    const side = bet.market.replace('match_outcome_', '') as 'home' | 'draw' | 'away';
    closingAmerican = side === 'home' ? home.american_odds : side === 'draw' ? draw.american_odds : away.american_odds;
    result = computeThreeWayCLV(side, bet.american_odds, {
      home: home.american_odds, draw: draw.american_odds, away: away.american_odds
    });
  } else {
    const oppKey = opposingMarketKey(bet.market);
    if (!oppKey) return null;
    const [same, opp] = await Promise.all([
      closingSnapshot(bet.match_id, bet.market),
      closingSnapshot(bet.match_id, oppKey)
    ]);
    if (!same || !opp) return null;
    closingAmerican = same.american_odds;
    result = computeTwoWayCLV(bet.american_odds, same.american_odds, opp.american_odds);
  }

  await db.update(bets).set({
    bet_no_vig_prob: result.bet_no_vig_prob.toFixed(4),
    closing_line_american: closingAmerican,
    closing_line_no_vig_prob: result.closing_no_vig_prob.toFixed(4),
    clv_cents: result.clv_cents.toFixed(2),
    clv_classification: result.classification
  }).where(eq(bets.id, bet_id));

  return { ...result, closing_line_american: closingAmerican };
}

/** Settlement hook: compute now; retry at 5min and 30min if closing data missing. */
export function scheduleCLVComputation(bet_id: string): void {
  const attempt = async (label: string): Promise<boolean> => {
    try {
      const result = await computeCLVForBet(bet_id);
      if (result) {
        await logAgentRun({
          agent: 'treasurer', run_phase: 'clv_compute', status: 'success', duration_ms: 0,
          outputs_summary: { bet_id, clv_cents: result.clv_cents, classification: result.classification, attempt: label }
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error(`CLV computation failed (${label}) for bet ${bet_id}:`, err);
      return false;
    }
  };

  void (async () => {
    if (await attempt('immediate')) return;
    setTimeout(() => {
      void (async () => {
        if (await attempt('retry_5min')) return;
        setTimeout(() => {
          void (async () => {
            if (await attempt('retry_30min')) return;
            await logAgentRun({
              agent: 'treasurer', run_phase: 'clv_compute', status: 'failed_recoverable', duration_ms: 0,
              outputs_summary: { bet_id, reason: 'closing line never captured — manual CLV review needed' }
            });
          })();
        }, 25 * 60 * 1000);
      })();
    }, 5 * 60 * 1000);
  })();
}
