/**
 * CLI entry point for the Phase 0 lean seed.
 * Usage: npm run db:seed
 */
import { seed } from '../db/seed';
import { sql } from '../db/index';

seed()
  .then(async () => {
    await sql.end();
    console.log('Seed complete.');
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    console.error('Seed failed:', err);
    await sql.end();
    process.exit(1);
  });
