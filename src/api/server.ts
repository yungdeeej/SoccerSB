import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { healthHandler } from './health';
import { apiRouter } from './routes';
import { startPollingScheduler } from '../agents/wolfman/poll';
import { syncFixtures } from '../agents/wolfman/fixtures';
import { startTelegramCommandLoop } from '../notify/telegram';
import { getSystemStatus, formatStatusForTelegram } from './status';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const app = express();
app.use(express.json());

app.get('/health', (req, res) => { void healthHandler(req, res); });
app.use(apiRouter);

// Pages
app.use(express.static(PUBLIC_DIR));
app.get('/', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'index.html')));
app.get('/matches/:id', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'match.html')));
app.get('/bets', (_req, res) => res.sendFile(join(PUBLIC_DIR, 'bets.html')));

const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`The Pitch — terminal on :${port} (${process.env.SYSTEM_ENV ?? 'development'})`);

  // Live data layers — degrade gracefully without ODDS_API_KEY
  if (process.env.ODDS_API_KEY) {
    syncFixtures()
      .then((r) => console.log(`fixtures: ${r.matches_inserted} inserted, ${r.matches_updated} updated`))
      .catch((err) => console.error('fixtures sync failed:', err));
    startPollingScheduler();
    scheduleDailyFixtureSync();
  } else {
    console.warn('ODDS_API_KEY not set — fixtures + odds polling disabled until configured');
  }

  startTelegramCommandLoop(async () => formatStatusForTelegram(await getSystemStatus()));
});

/** Daily fixtures re-sync at 4am MT (catches kickoff shifts, venue changes). */
function scheduleDailyFixtureSync(): void {
  let lastSyncDay: string | null = null;
  setInterval(() => {
    const tz = process.env.OPERATOR_TIMEZONE ?? 'America/Edmonton';
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    if (get('hour') === '04' && lastSyncDay !== day) {
      lastSyncDay = day;
      syncFixtures().catch((err) => console.error('daily fixtures sync failed:', err));
    }
  }, 60 * 1000);
}
