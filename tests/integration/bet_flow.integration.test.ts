/**
 * End-to-end bet flow against the real database:
 * deposit → place bet (atomic debit) → settle (credit) → ledger reconciles.
 * Creates its own match row and cleans up everything it wrote.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../../src/db/index';
import { matches, teams, bets, bankroll_ledger } from '../../src/db/schema';
import { deposit, placeBet, settleBet, getCurrentBalanceCents, LedgerError } from '../../src/shared/ledger';

const TEST_FIFA_MATCH_ID = 2_000_000_001; // outside placeholder hash range (> 2^31-1 not allowed, use sentinel)

let matchId: string;
const createdBetIds: string[] = [];

beforeAll(async () => {
  const [esp] = await db.select({ id: teams.id }).from(teams).where(eq(teams.short_name, 'ESP'));
  const [cpv] = await db.select({ id: teams.id }).from(teams).where(eq(teams.short_name, 'CPV'));
  expect(esp).toBeDefined();
  expect(cpv).toBeDefined();

  const [match] = await db.insert(matches).values({
    fifa_match_id: TEST_FIFA_MATCH_ID,
    home_team_id: esp.id,
    away_team_id: cpv.id,
    venue_id: null,
    tournament_stage: 'group_md1',
    group_letter: 'H',
    scheduled_kickoff_utc: new Date('2026-06-14T22:00:00Z'),
    status: 'scheduled'
  }).returning({ id: matches.id });
  matchId = match.id;
});

afterAll(async () => {
  // Clean up everything this test created (test rows only — dev DB hygiene)
  if (createdBetIds.length > 0) {
    await db.delete(bankroll_ledger).where(inArray(bankroll_ledger.reference_id, createdBetIds));
    await db.delete(bets).where(inArray(bets.id, createdBetIds));
  }
  await db.delete(bankroll_ledger).where(eq(bankroll_ledger.notes, '__integration_test_deposit__'));
  await db.delete(matches).where(eq(matches.id, matchId));
  await sql.end();
});

describe('bet flow end-to-end', () => {
  it('rejects bets when bankroll is empty or insufficient', async () => {
    const balance = await getCurrentBalanceCents();
    if (balance === 0n) {
      await expect(placeBet({
        match_id: matchId, market: 'match_outcome_home', side: 'home',
        book: 'draftkings', american_odds: -380, stake_cents: 5000n
      })).rejects.toThrow(LedgerError);
    }
  });

  it('deposit → place → settle reconciles the ledger exactly', async () => {
    const before = await getCurrentBalanceCents();

    // Deposit $500
    const dep = await deposit(50_000n, '__integration_test_deposit__');
    expect(dep.balance_after_cents).toBe(before + 50_000n);

    // Place $50 on ESP ML -380
    const placed = await placeBet({
      match_id: matchId, market: 'match_outcome_home', side: 'home',
      book: 'draftkings', american_odds: -380, stake_cents: 5000n
    });
    createdBetIds.push(placed.bet_id);
    expect(placed.balance_after_cents).toBe(before + 50_000n - 5000n);

    // Verify bet row + ledger debit row exist
    const [betRow] = await db.select().from(bets).where(eq(bets.id, placed.bet_id));
    expect(betRow.settlement_status).toBe('pending');
    expect(betRow.stake_cents).toBe(5000n);

    const ledgerRows = await db.select().from(bankroll_ledger)
      .where(eq(bankroll_ledger.reference_id, placed.bet_id));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].amount_cents).toBe(-5000n);

    // Settle as win: -380 → decimal 1.2632 → payout $63.16
    const settled = await settleBet(placed.bet_id, 'win');
    expect(settled.payout_cents).toBe(6316n);
    expect(settled.pl_cents).toBe(1316n);
    expect(settled.balance_after_cents).toBe(before + 50_000n - 5000n + 6316n);

    // Ledger now has the credit row too
    const allRows = await db.select().from(bankroll_ledger)
      .where(eq(bankroll_ledger.reference_id, placed.bet_id));
    expect(allRows).toHaveLength(2);

    // Double settlement is blocked
    await expect(settleBet(placed.bet_id, 'win')).rejects.toThrow(LedgerError);

    // Current balance matches the chain exactly
    expect(await getCurrentBalanceCents()).toBe(before + 50_000n + 1316n);
  });

  it('loss settlement writes no credit row', async () => {
    const before = await getCurrentBalanceCents();
    const placed = await placeBet({
      match_id: matchId, market: 'total_over_2.5', side: 'over',
      book: 'fanduel', american_odds: -110, stake_cents: 4000n
    });
    createdBetIds.push(placed.bet_id);

    const settled = await settleBet(placed.bet_id, 'loss');
    expect(settled.payout_cents).toBe(0n);
    expect(settled.pl_cents).toBe(-4000n);

    const rows = await db.select().from(bankroll_ledger)
      .where(eq(bankroll_ledger.reference_id, placed.bet_id));
    expect(rows).toHaveLength(1);  // debit only, no credit

    expect(await getCurrentBalanceCents()).toBe(before - 4000n);
  });
});
