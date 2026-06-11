/**
 * Connectivity / env validation — no API quota burned.
 * Usage: npm run test:connectivity  (exits 1 on any failure)
 */
import 'dotenv/config';
import postgres from 'postgres';

type Result = { name: string; ok: boolean; detail: string };
const results: Result[] = [];

function checkFormat(name: string, value: string | undefined, validate: (v: string) => boolean, hint: string): void {
  if (!value) {
    results.push({ name, ok: false, detail: `missing (${hint})` });
  } else if (!validate(value)) {
    results.push({ name, ok: false, detail: `invalid format (${hint})` });
  } else {
    results.push({ name, ok: true, detail: 'ok' });
  }
}

async function main(): Promise<void> {
  // DATABASE_URL — actually connect
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    results.push({ name: 'DATABASE_URL', ok: false, detail: 'missing' });
  } else {
    try {
      const client = postgres(dbUrl, { max: 1, connect_timeout: 5 });
      await client`SELECT 1`;
      await client.end();
      results.push({ name: 'DATABASE_URL', ok: true, detail: 'connected' });
    } catch (err) {
      results.push({
        name: 'DATABASE_URL',
        ok: false,
        detail: `connection failed: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  checkFormat('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY,
    (v) => v.startsWith('sk-ant-'), 'expected sk-ant-...');
  checkFormat('ODDS_API_KEY', process.env.ODDS_API_KEY,
    (v) => v.length > 0, 'required for Phase 1');
  checkFormat('TELEGRAM_BOT_TOKEN', process.env.TELEGRAM_BOT_TOKEN,
    (v) => /^\d+:[A-Za-z0-9_-]+$/.test(v), 'expected <digits>:<token>');
  checkFormat('TELEGRAM_CHAT_ID', process.env.TELEGRAM_CHAT_ID,
    (v) => /^-?\d+$/.test(v), 'expected numeric chat id');

  let failed = false;
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(20)} ${r.detail}`);
    if (!r.ok) failed = true;
  }

  if (failed) {
    console.error('\nConnectivity check FAILED — populate .env (see .env.example)');
    process.exit(1);
  }
  console.log('\nAll connectivity checks passed.');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('Connectivity script crashed:', err);
  process.exit(1);
});
