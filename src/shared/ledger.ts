/**
 * Bankroll ledger operations — append-only, BigInt cents, atomic transactions.
 * Phase 1: manual bet placement, deposits, manual settlement.
 * (Full Treasurer — Kelly, stop-loss, CLV — arrives in Phase 4.)
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { bankroll_ledger, bets } from '../db/schema';
import { americanToDecimal } from './utils/odds';
import { computeSettlement, type BetOutcome } from './utils/settlement';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function latestBalanceCents(tx: Tx): Promise<bigint> {
  const [row] = await tx
    .select({ balance: bankroll_ledger.balance_after_cents })
    .from(bankroll_ledger)
    .orderBy(desc(bankroll_ledger.occurred_at), desc(bankroll_ledger.created_at))
    .limit(1);
  return row?.balance ?? 0n;
}

export async function getCurrentBalanceCents(): Promise<bigint> {
  const [row] = await db
    .select({ balance: bankroll_ledger.balance_after_cents })
    .from(bankroll_ledger)
    .orderBy(desc(bankroll_ledger.occurred_at), desc(bankroll_ledger.created_at))
    .limit(1);
  return row?.balance ?? 0n;
}

export class LedgerError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

// ---------------------------------------------------------------------------
// Deposit
// ---------------------------------------------------------------------------

export async function deposit(amount_cents: bigint, note: string): Promise<{ balance_after_cents: bigint }> {
  if (amount_cents <= 0n) throw new LedgerError('Deposit must be positive', 'invalid_amount');

  return db.transaction(async (tx) => {
    const prior = await latestBalanceCents(tx);
    const balance_after = prior + amount_cents;
    await tx.insert(bankroll_ledger).values({
      entry_type: 'deposit',
      amount_cents,
      balance_after_cents: balance_after,
      reference_id: null,
      notes: note,
      source: 'manual'
    });
    return { balance_after_cents: balance_after };
  });
}

// ---------------------------------------------------------------------------
// Bet placement (atomic: bet insert + ledger debit)
// ---------------------------------------------------------------------------

export interface PlaceBetArgs {
  match_id: string;
  market: string;
  side: string;
  book: string;
  american_odds: number;
  stake_cents: bigint;
}

export async function placeBet(args: PlaceBetArgs): Promise<{ bet_id: string; balance_after_cents: bigint }> {
  if (args.stake_cents <= 0n) throw new LedgerError('Stake must be positive', 'invalid_stake');
  const decimal = americanToDecimal(args.american_odds);

  return db.transaction(async (tx) => {
    const prior = await latestBalanceCents(tx);
    if (prior === 0n) {
      throw new LedgerError('Bankroll is $0. Add a deposit before placing bets.', 'bankroll_empty');
    }
    if (args.stake_cents > prior) {
      throw new LedgerError(
        `Stake $${(Number(args.stake_cents) / 100).toFixed(2)} exceeds bankroll $${(Number(prior) / 100).toFixed(2)}`,
        'insufficient_funds'
      );
    }

    const potential_payout = BigInt(Math.round(Number(args.stake_cents) * decimal));

    const [bet] = await tx.insert(bets).values({
      verdict_id: null,  // manual placement — no CEO verdict in Phase 1
      match_id: args.match_id,
      market: args.market,
      side: args.side,
      book: args.book,
      stake_cents: args.stake_cents,
      american_odds: args.american_odds,
      decimal_odds: decimal.toFixed(4),
      potential_payout_cents: potential_payout,
      settlement_status: 'pending'
    }).returning({ id: bets.id });

    const balance_after = prior - args.stake_cents;
    await tx.insert(bankroll_ledger).values({
      entry_type: 'bet_placed',
      amount_cents: -args.stake_cents,
      balance_after_cents: balance_after,
      reference_id: bet.id,
      notes: `${args.market} ${args.side} @ ${args.book} ${args.american_odds > 0 ? '+' : ''}${args.american_odds}`,
      source: 'manual'
    });

    return { bet_id: bet.id, balance_after_cents: balance_after };
  });
}

// ---------------------------------------------------------------------------
// Settlement (atomic: bet update + ledger credit when payout > 0)
// ---------------------------------------------------------------------------

export async function settleBet(
  bet_id: string,
  outcome: BetOutcome
): Promise<{ payout_cents: bigint; pl_cents: bigint; balance_after_cents: bigint }> {
  return db.transaction(async (tx) => {
    const [bet] = await tx.select().from(bets).where(eq(bets.id, bet_id)).limit(1);
    if (!bet) throw new LedgerError(`Bet ${bet_id} not found`, 'bet_not_found');
    if (bet.settlement_status !== 'pending') {
      throw new LedgerError(`Bet already ${bet.settlement_status}`, 'already_settled');
    }

    const { payout_cents, pl_cents } = computeSettlement(
      outcome,
      bet.stake_cents,
      Number(bet.decimal_odds)
    );

    await tx.update(bets).set({
      settlement_status: outcome === 'void' ? 'void' : 'settled',
      outcome,
      payout_cents,
      pl_cents,
      settled_at: new Date()
    }).where(eq(bets.id, bet_id));

    let balance_after = await latestBalanceCents(tx);
    if (payout_cents > 0n) {
      balance_after += payout_cents;
      await tx.insert(bankroll_ledger).values({
        entry_type: 'bet_settled',
        amount_cents: payout_cents,
        balance_after_cents: balance_after,
        reference_id: bet_id,
        notes: `${bet.market} ${bet.side} ${outcome}`,
        source: 'system_settlement'
      });
    }

    return { payout_cents, pl_cents, balance_after_cents: balance_after };
  });
}
