import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — copy .env.example to .env and configure it');
}

/** Raw postgres-js client (use for health-check latency probes). */
export const sql = postgres(DATABASE_URL, { max: 10 });

/** Drizzle ORM client — the only way agents touch the database. */
export const db = drizzle(sql, { schema });

export { schema };
