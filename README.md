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
- **Next: Phase 1 (Market Intelligence Skeleton)** — The Odds API integration, odds polling, slate dashboard, best-price identification, manual bet ledger, Telegram channel. Requires operator approval + `ODDS_API_KEY` / `TELEGRAM_BOT_TOKEN`.
