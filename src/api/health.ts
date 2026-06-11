/**
 * GET /health — Phase 0 system health.
 * 200 when all checks pass, 503 when any fails.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { count, desc } from 'drizzle-orm';
import { db, sql } from '../db/index';
import { teams, venues, bankroll_ledger } from '../db/schema';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CheckOk {
  status: 'ok';
  [key: string]: unknown;
}
interface CheckFail {
  status: 'fail';
  error: string;
}
type Check = CheckOk | CheckFail;

async function runChecks(): Promise<{ healthy: boolean; checks: Record<string, Check> }> {
  const checks: Record<string, Check> = {};

  // Database connectivity + latency
  try {
    const started = Date.now();
    await sql`SELECT 1`;
    checks.database = { status: 'ok', latency_ms: Date.now() - started };
  } catch (err) {
    checks.database = { status: 'fail', error: err instanceof Error ? err.message : String(err) };
    return { healthy: false, checks };
  }

  // Teams seeded (identity only in Phase 0)
  try {
    const [row] = await db.select({ n: count() }).from(teams);
    checks.teams_seeded = row.n === 48
      ? { status: 'ok', count: row.n, note: 'identity only — ratings/stats populated in Phase 2+' }
      : { status: 'fail', error: `expected 48 teams, found ${row.n}` };
  } catch (err) {
    checks.teams_seeded = { status: 'fail', error: err instanceof Error ? err.message : String(err) };
  }

  // Venues seeded
  try {
    const [row] = await db.select({ n: count() }).from(venues);
    checks.venues_seeded = row.n === 16
      ? { status: 'ok', count: row.n }
      : { status: 'fail', error: `expected 16 venues, found ${row.n}` };
  } catch (err) {
    checks.venues_seeded = { status: 'fail', error: err instanceof Error ? err.message : String(err) };
  }

  // Groups config
  try {
    const raw = readFileSync(join(__dirname, '../shared/config/groups.json'), 'utf-8');
    const groups = JSON.parse(raw) as Record<string, string[]>;
    const n = Object.keys(groups).length;
    checks.groups_loaded = n === 12
      ? { status: 'ok', count: n }
      : { status: 'fail', error: `expected 12 groups, found ${n}` };
  } catch (err) {
    checks.groups_loaded = { status: 'fail', error: err instanceof Error ? err.message : String(err) };
  }

  // Bankroll ledger initialized
  try {
    const [latest] = await db
      .select({ balance: bankroll_ledger.balance_after_cents })
      .from(bankroll_ledger)
      .orderBy(desc(bankroll_ledger.occurred_at))
      .limit(1);
    checks.bankroll_initialized = latest !== undefined
      ? { status: 'ok', balance_cents: Number(latest.balance) }
      : { status: 'fail', error: 'bankroll_ledger is empty — run db:seed' };
  } catch (err) {
    checks.bankroll_initialized = { status: 'fail', error: err instanceof Error ? err.message : String(err) };
  }

  const healthy = Object.values(checks).every((c) => c.status === 'ok');
  return { healthy, checks };
}

export async function healthHandler(_req: Request, res: Response): Promise<void> {
  try {
    const { healthy, checks } = await runChecks();
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
