# The Pitch — World Cup 2026 Betting Intelligence

The Pitch is a single-operator betting intelligence system for the 2026 FIFA World Cup (June 11 – July 19, 2026). Four specialist agents — the Quant (Bivariate Poisson model), the Tactician (situational adjustments), the Wolfman (market intelligence), and the CEO (Walters-discipline synthesis) — plus the Treasurer (bankroll, Kelly sizing, CLV) identify edges against the sharpest markets in sports and recommend bets at specific prices. The system never places bets; the operator places them manually. PASS is the default verdict. CLV is the truth metric.

Full specification lives in [docs/worldcup_prompts/](docs/worldcup_prompts/).

## The lean seeding philosophy

**The database stores structural facts and agent outputs only. It is never a cache of data available from live APIs.**

On the NHL system we learned the hard way: pre-seeded data that should come from authoritative live sources (FIFA, The Odds API, FBref, Elo ratings, Transfermarkt) lingers, goes stale, and agents end up trusting it over the live data they should be fetching — which produces bad bets.

Phase 0 therefore seeds **only** facts that cannot drift:

- **Venues** — coordinates, altitude, timezone, surface (physical reality)
- **Group assignments** — fixed by the FIFA draw ([src/shared/config/groups.json](src/shared/config/groups.json) is the single source of truth)
- **Team identities** — name, short_name, confederation only
- **One $0 bankroll ledger row** — prevents empty-table queries
- **Config files** — book tiers, beat-reporter placeholders

Everything else — team ratings, Elo, market values, xG, style profiles, rosters, fixtures, referee assignments, venue capacities, FIFA numeric IDs — is **NULL at the end of Phase 0, intentionally**. Agents fetch those from authoritative sources at runtime in Phases 1–3. When in doubt: don't seed it.

## Setup

```bash
# 1. Install dependencies (Node.js 20+)
npm install

# 2. Configure environment
cp .env.example .env   # then fill in DATABASE_URL (Postgres/Neon) and API keys

# 3. Create schema (15 tables)
npm run db:migrate

# 4. Lean seed: 48 teams (identity only) + 16 venues + ledger init
npm run db:seed

# 5. Start the API
npm run dev            # http://localhost:3000/health
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start API server (watch mode) |
| `npm run start` | Start API server |
| `npm run db:generate` | Generate Drizzle migrations from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Lean seed (idempotent) |
| `npm run test` | Unit tests (money-path utilities) |
| `npm run test:connectivity` | Validate env vars / DB connection without burning API quota |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |

## Project layout

```
docs/worldcup_prompts/   Full system specification (8 docs + phase prompts)
src/db/                  Drizzle schema, migrations, lean seed
src/shared/config/       groups.json, books.json, beat_reporters.json
src/shared/utils/        odds, kelly, geo (money path — fully tested)
src/agents/              quant | tactician | wolfman | ceo | treasurer (skeletons until Phases 2-4)
src/api/                 Express server + /health
src/scripts/             seed-database, test-connectivity
tests/                   Vitest unit tests
```

## Phase status

- **Phase 0 (Foundation) — complete.** Schema deployed, lean seed verified, money-path utils tested, health endpoint green.
- **Phase 1 (Market Intelligence Skeleton) — complete.** Fixtures ingestion + adaptive odds polling from The Odds API (zod-validated, quota-aware), market state computation (consensus / Pinnacle no-vig anchor / best accessible price / movement), terminal dashboard (`/` slate + edge board, `/matches/:id` detail, `/bets` ledger), atomic bet placement / deposit / settlement workflows, Telegram `/status` skeleton, full `agent_runs` logging.
  - **To go live:** set `ODDS_API_KEY` (fixtures + polling start automatically on boot) and `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` in `.env`, then restart. Without keys the server runs with manual workflows only.
- **Phase 2a (The Quant) — complete.** Python FastAPI service (`src/agents/quant/`, port 8001): Bivariate Poisson with Dixon-Coles correction + draw inflation, Elo/market-value/xG composite ratings, venue factor (host/altitude/travel), all 8 v1 markets, seeded bootstrap CIs. Data loaders: eloratings.net (daily), Transfermarkt (weekly), API-Football (needs `APIFOOTBALL_KEY`). **Backtest gate PASSED: 0.191 avg Brier across 11 major tournaments 2014-2024** (operator-approved gate definition; 2022 Qatar alone: 0.2084 — that tournament beat the bookmakers too). Dashboard shows "THE QUANT'S READ" on match pages only while a passing `model_versions` row exists.
  - Run both services: `npm run dev` + `cd src/agents/quant && uv run uvicorn main:app --port 8001` (or via `Procfile`).
- **Next: Phase 2b (The Tactician)** — situational adjustments. Requires operator approval.

## Phase 1 notes

- Polling cadence scales from 6h (>2 days out) to 2min (final 15 minutes), with the closing line captured at T-90s (`is_closing_line`). Quota guards: <50 credits → reduced cadence, <25 → Telegram alert.
- `matches.fifa_match_id` currently holds a deterministic 31-bit hash of The Odds API event ID (placeholder until FIFA IDs are backfilled). `matches.venue_id` is nullable for the same reason.
- Unit tests: `npm run test`. DB-backed flow tests: `npm run test:integration`.
