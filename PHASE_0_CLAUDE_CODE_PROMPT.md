# CLAUDE CODE — PHASE 0 EXECUTION PROMPT (v3 — LEAN SEEDING)

## The Pitch (World Cup 2026 Betting Intelligence)

## Copy everything below this line into Claude Code

---

You are building **The Pitch** — a personal betting intelligence system for the 2026 FIFA World Cup. The tournament kicks off today (June 11, 2026) with Mexico vs South Africa at Estadio Azteca.

This is **Phase 0 only**. Foundation work. No agent logic. No model. No LLM calls. No external API calls beyond connectivity tests.

## YOUR FIRST ACTIONS — BEFORE WRITING ANY CODE

1. Read `/docs/worldcup_prompts/README.md`
2. Read `/docs/worldcup_prompts/01_MASTER_ORCHESTRATION.md` — Build Phase Order section especially
3. Read `/docs/worldcup_prompts/07_SHARED_CONTRACTS.md` — your build spec
4. Skim the four agent files (`02_AGENT_QUANT.md`, `03_AGENT_TACTICIAN.md`, `04_AGENT_WOLFMAN.md`, `05_AGENT_CEO.md`)
5. Read `/docs/worldcup_prompts/00_WALTERS_FOR_SOCCER.md`

After reading: reply with a 4-bullet summary of Phase 0 deliverables. Wait for nothing — proceed after reporting, but the report must come first.

## ENVIRONMENT CONTEXT

- Local Claude Code build, Replit for hosting later
- Postgres via Neon — I'll provide DATABASE_URL when needed
- Separate project from The Syndicate (NHL) — do not import code

## CRITICAL ARCHITECTURAL PRINCIPLE — READ THIS TWICE

**The database is for STRUCTURAL FACTS and AGENT OUTPUTS only. It is NOT a cache of data that's available from live APIs.**

We learned a hard lesson on the NHL system: when we pre-seed data that should come from authoritative live sources (FIFA, The Odds API, FBref, Elo ratings), agents end up trusting stale or wrong seed data over the live data they should be fetching. Mock and seed data lingers, confuses agents, and produces bad bets.

**The Phase 0 rule:**

### SEED — only structural facts that don't change

These are facts that are either fixed for the tournament (group assignments) or fixed in physical reality (venue coordinates and altitudes). Safe to seed because they cannot drift.

✅ **Venues** — coordinates, altitude, timezone, surface, capacity (physical reality, fixed)
✅ **Group assignments** — which 4 teams in each group (set by FIFA draw, fixed for tournament)
✅ **Team identities only** — name, short_name, confederation (these don't change during the tournament)
✅ **Initial bankroll ledger row** — required to prevent empty-table queries
✅ **Config files** — book tiers (`books.json`), beat reporter placeholders (`beat_reporters.json`)
✅ **Schema** — all 15 tables from `07_SHARED_CONTRACTS.md`

### DO NOT SEED — fetch live from APIs at runtime

These are facts that change frequently, are computed by agents, or live in authoritative external sources. Seeding them creates stale data that confuses agents.

❌ **Team ratings** (Elo, market values, xG — Quant fetches in Phase 2)
❌ **Team stats** (rolling 8-match, club xG aggregates — Phase 2)
❌ **Team style profiles** (press intensity, possession orientation — Phase 3, populated by analysis)
❌ **Player rosters** (Phase 3, fetched from FIFA API after squad announcements)
❌ **FIFA numerical team IDs** (Phase 1, fetched from FIFA API — leave null in Phase 0)
❌ **Match fixtures** (Phase 1, fetched from FIFA/Odds API)
❌ **Referee assignments** (Phase 3, fetched ~48h pre-match)
❌ **Set-piece efficiency stats** (Phase 2, computed by Quant)
❌ **Late-game tendency stats** (Phase 2)
❌ **Recent form scores** (Phase 2)

When in doubt: **don't seed it.** A null column in Phase 0 forces the agent to fetch from the authoritative source. A pre-seeded column lets the agent skip the fetch and use stale data.

This means tables like `teams` will have many nullable columns at the end of Phase 0. That's correct and intended.

## PHASE 0 DELIVERABLES

### 1. Project structure

```
/
├── docs/worldcup_prompts/      (already exists — do not modify)
├── src/
│   ├── db/
│   │   ├── schema.ts
│   │   ├── migrations/
│   │   ├── seed.ts
│   │   └── index.ts
│   ├── shared/
│   │   ├── config/
│   │   │   ├── groups.json
│   │   │   ├── beat_reporters.json
│   │   │   └── books.json
│   │   ├── types/
│   │   └── utils/
│   │       ├── odds.ts
│   │       ├── kelly.ts
│   │       └── geo.ts
│   ├── agents/                 (skeleton folders only)
│   │   ├── quant/
│   │   ├── tactician/
│   │   ├── wolfman/
│   │   ├── ceo/
│   │   └── treasurer/
│   ├── api/
│   │   ├── health.ts
│   │   └── server.ts
│   └── scripts/
│       ├── test-connectivity.ts
│       └── seed-database.ts
├── tests/
├── .env.example
├── drizzle.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

**Note:** no `teams.json` or `venues.json` config files. The database is the source of truth for those — agents query the DB, not a JSON cache.

### 2. Postgres schema

Install Drizzle ORM + drizzle-kit + postgres-js. Implement all 15 tables from `07_SHARED_CONTRACTS.md`:

`teams`, `players`, `venues`, `referees`, `matches`, `match_contexts`, `model_predictions`, `situational_adjustments`, `odds_snapshots`, `market_intelligence`, `verdicts`, `bets`, `bankroll_ledger`, `model_versions`, `agent_runs`

Exact columns, types, indexes as specified. Migration runnable via `npm run db:migrate`.

**Important:** all the columns that aren't structural (ratings, stats, style profiles, rolling stats, recent form, etc.) must allow NULL. They populate in Phase 2/3 via agent fetches from live APIs.

### 3. Seed — 48 teams (IDENTITY ONLY)

Seed ONLY: `name`, `short_name`, `confederation`, timestamps. **All other team columns left NULL.** Agents populate them later from live sources.

Use this authoritative list — the confirmed 2026 World Cup field:

**Group A:** Mexico (MEX, CONCACAF), South Africa (RSA, CAF), Korea Republic (KOR, AFC), Czechia (CZE, UEFA)

**Group B:** Canada (CAN, CONCACAF), Bosnia and Herzegovina (BIH, UEFA), Qatar (QAT, AFC), Switzerland (SUI, UEFA)

**Group C:** Brazil (BRA, CONMEBOL), Morocco (MAR, CAF), Haiti (HAI, CONCACAF), Scotland (SCO, UEFA)

**Group D:** United States (USA, CONCACAF), Paraguay (PAR, CONMEBOL), Australia (AUS, AFC), Turkiye (TUR, UEFA)

**Group E:** Germany (GER, UEFA), Curaçao (CUW, CONCACAF), Ivory Coast (CIV, CAF), Ecuador (ECU, CONMEBOL)

**Group F:** Netherlands (NED, UEFA), Japan (JPN, AFC), Sweden (SWE, UEFA), Tunisia (TUN, CAF)

**Group G:** Belgium (BEL, UEFA), Egypt (EGY, CAF), Iran (IRN, AFC), New Zealand (NZL, OFC)

**Group H:** Spain (ESP, UEFA), Cabo Verde (CPV, CAF), Saudi Arabia (KSA, AFC), Uruguay (URU, CONMEBOL)

**Group I:** France (FRA, UEFA), Senegal (SEN, CAF), Iraq (IRQ, AFC), Norway (NOR, UEFA)

**Group J:** Argentina (ARG, CONMEBOL), Algeria (ALG, CAF), Austria (AUT, UEFA), Jordan (JOR, AFC)

**Group K:** Portugal (POR, UEFA), DR Congo (COD, CAF), Uzbekistan (UZB, AFC), Colombia (COL, CONMEBOL)

**Group L:** England (ENG, UEFA), Croatia (CRO, UEFA), Ghana (GHA, CAF), Panama (PAN, CONCACAF)

**Spelling rules (official FIFA conventions):**
- Turkiye (not Turkey)
- Korea Republic (not South Korea)
- Cabo Verde (not Cape Verde)
- Curaçao (with cedilla)
- DR Congo (short_name: COD)
- Bosnia and Herzegovina (short_name: BIH)

**Confederation counts (must verify after seed):**
CONCACAF: 6 | CONMEBOL: 6 | UEFA: 16 | CAF: 10 | AFC: 9 | OFC: 1 | **TOTAL: 48**

For each team:
- `id` (UUID auto)
- `fifa_team_id` (NULL — will be populated by Phase 1 from FIFA API)
- `name` (exactly as listed)
- `short_name` (exactly as listed)
- `confederation` (exact string from the list above)
- `created_at` / `updated_at`
- **ALL OTHER COLUMNS: NULL**

That includes (these all stay NULL in Phase 0):
- `elo_rating`, `elo_last_updated`
- `market_value_squad_eur_m`, `market_value_xi_eur_m`, `market_value_last_updated`
- `attack_rating`, `defense_rating`, `composite_z`
- `rolling_8_match`, `club_xg_aggregate`, `recent_form_score`
- `home_base_lat`, `home_base_lng`, `altitude_acclimation_meters`
- `press_intensity`, `possession_orientation`, `defensive_structure`, `set_piece_reliance`
- `style_directness_score`, `bench_quality_z`
- `set_piece_goals_per_match`, `set_piece_defense_z`

### 4. Group assignments (`/src/shared/config/groups.json`)

```json
{
  "A": ["MEX", "RSA", "KOR", "CZE"],
  "B": ["CAN", "BIH", "QAT", "SUI"],
  "C": ["BRA", "MAR", "HAI", "SCO"],
  "D": ["USA", "PAR", "AUS", "TUR"],
  "E": ["GER", "CUW", "CIV", "ECU"],
  "F": ["NED", "JPN", "SWE", "TUN"],
  "G": ["BEL", "EGY", "IRN", "NZL"],
  "H": ["ESP", "CPV", "KSA", "URU"],
  "I": ["FRA", "SEN", "IRQ", "NOR"],
  "J": ["ARG", "ALG", "AUT", "JOR"],
  "K": ["POR", "COD", "UZB", "COL"],
  "L": ["ENG", "CRO", "GHA", "PAN"]
}
```

This file is the **single source of truth for group assignments**. Read it from the seed script AND from the Tactician later (for Matchday 3 motivation logic). Do not duplicate the data.

Group assignments are structural for this tournament — won't change once the tournament starts. Safe to seed.

### 5. Seed — 16 venues (PHYSICAL FACTS ONLY)

Venue coordinates, altitude, and timezone don't change. Safe to seed.

**Mexico (3):**
- Estadio Azteca, Mexico City — 19.3029, -99.1505, altitude 2240m, natural_grass, America/Mexico_City, is_high_altitude TRUE
- Estadio Akron, Guadalajara — 20.6817, -103.4625, altitude 1550m, natural_grass, America/Mexico_City, is_high_altitude TRUE
- Estadio BBVA, Monterrey — 25.6692, -100.2444, altitude 540m, natural_grass, America/Monterrey, is_high_altitude FALSE

**Canada (2):**
- BMO Field, Toronto — 43.6328, -79.4187, altitude 76m, natural_grass, America/Toronto, is_high_altitude FALSE
- BC Place, Vancouver — 49.2768, -123.1119, altitude 5m, **natural_grass** (resurfaced for World Cup), America/Vancouver, is_high_altitude FALSE

**United States (11):**
- MetLife Stadium, East Rutherford NJ — 40.8136, -74.0744, altitude 7m, natural_grass (temp resurfaced), America/New_York [Final venue]
- AT&T Stadium, Arlington TX — 32.7473, -97.0945, altitude 158m, natural_grass (temp), America/Chicago
- SoFi Stadium, Inglewood CA — 33.9535, -118.3392, altitude 30m, natural_grass (temp), America/Los_Angeles
- Lumen Field, Seattle WA — 47.5952, -122.3316, altitude 17m, natural_grass (temp), America/Los_Angeles
- Levi's Stadium, Santa Clara CA — 37.4032, -121.9697, altitude 4m, natural_grass, America/Los_Angeles
- Hard Rock Stadium, Miami Gardens FL — 25.9580, -80.2389, altitude 2m, natural_grass, America/New_York
- NRG Stadium, Houston TX — 29.6847, -95.4107, altitude 14m, natural_grass (temp), America/Chicago
- Lincoln Financial Field, Philadelphia PA — 39.9008, -75.1675, altitude 8m, natural_grass, America/New_York
- Mercedes-Benz Stadium, Atlanta GA — 33.7553, -84.4006, altitude 320m, natural_grass (temp), America/New_York
- Gillette Stadium, Foxborough MA — 42.0909, -71.2643, altitude 67m, natural_grass (temp), America/New_York
- Arrowhead Stadium, Kansas City MO — 39.0489, -94.4839, altitude 230m, natural_grass, America/Chicago

All `is_indoor: false`, `is_outdoor: true`. `is_high_altitude: TRUE` only for Estadio Azteca and Estadio Akron.

**Do NOT seed `capacity`** — it varies by World Cup configuration and we can fetch from FIFA API. Leave as NULL.

For each venue:
- `id` (UUID)
- `fifa_venue_id` (NULL — fetched in Phase 1)
- `name`, `city`, `country`
- `latitude`, `longitude` (5+ digit precision)
- `altitude_meters`
- `surface_type` (`natural_grass`)
- `capacity` (NULL — fetched later)
- `is_indoor` (false), `is_outdoor` (true)
- `timezone` (IANA)
- `is_high_altitude` (TRUE > 1500m only)

### 6. Configuration files

**`/src/shared/config/groups.json`** — per Section 4. Group assignments only.

**`/src/shared/config/beat_reporters.json`** — empty arrays for all 48 short_names. TODO comment noting Phase 3 will populate with real handles.

```json
{
  "ALG": [],
  "ARG": [],
  "AUS": [],
  ...
}
```

**`/src/shared/config/books.json`** — copy verbatim from `04_AGENT_WOLFMAN.md`. Three-tier book config with `operator_accessible` flags.

**No `teams.json` or `venues.json` config files.** The database is the source of truth. Agents query the DB.

### 7. Initial bankroll ledger entry

One row in `bankroll_ledger`:
- `entry_type: 'adjustment'`
- `amount_cents: 0`
- `balance_after_cents: 0`
- `notes: 'World Cup bankroll initialization — awaiting allocation'`
- `source: 'manual'`
- `occurred_at: NOW()`

Required to prevent the Treasurer's balance query from crashing on empty table.

### 8. Environment variables (.env.example)

```bash
DATABASE_URL=
ANTHROPIC_API_KEY=
ODDS_API_KEY=
ODDS_API_TIER=standard
FBREF_SCRAPE_ENABLED=true
ELO_RATINGS_API_URL=https://eloratings.net/
OPENWEATHER_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
OPERATOR_TIMEZONE=America/Edmonton
OPERATOR_CURRENCY=CAD
SYSTEM_ENV=development
KELLY_FRACTION_OVERRIDE=
```

Operator populates `.env`. Do not commit it.

### 9. Shared utility functions (FULL implementations + unit tests)

**`/src/shared/utils/odds.ts`:**
- `americanToDecimal(american)`
- `decimalToAmerican(decimal)`
- `stripVigTwoWay(side_a, side_b)`
- `stripVigThreeWay(home, draw, away)` — critical for soccer 1X2
- `calculateCLV(bet_no_vig_prob, closing_no_vig_prob)`

**`/src/shared/utils/kelly.ts`:**
- `calculateKellyStake(args)` → `{ stake_cents, kelly_fraction_full, cap_reasoning, approved, rejection_reason }`
- Quarter-Kelly (0.25) default, 3% hard cap, $20 floor
- Low confidence multiplier (0.5x), knockout stage multiplier (0.85x)

**`/src/shared/utils/geo.ts`:**
- `haversineDistance(lat1, lng1, lat2, lng2)` → km
- `haversineMiles(lat1, lng1, lat2, lng2)` → miles

Unit tests for each. 95%+ coverage on money path.

### 10. Health check endpoint

`GET /health` returns 200:
```json
{
  "status": "ok",
  "timestamp": "ISO timestamp",
  "checks": {
    "database": { "status": "ok", "latency_ms": 12 },
    "teams_seeded": { "status": "ok", "count": 48, "note": "identity only — ratings/stats populated in Phase 2+" },
    "venues_seeded": { "status": "ok", "count": 16 },
    "groups_loaded": { "status": "ok", "count": 12 },
    "bankroll_initialized": { "status": "ok", "balance_cents": 0 }
  }
}
```

503 if any fails.

### 11. Connectivity test script

`/src/scripts/test-connectivity.ts` verifies env vars without burning API quota:
- DATABASE_URL connects
- ANTHROPIC_API_KEY format valid (`sk-ant-...`)
- ODDS_API_KEY present
- TELEGRAM_BOT_TOKEN format valid
- TELEGRAM_CHAT_ID numeric

`npm run test:connectivity`. Exits 1 on failure.

### 12. Documentation

Root `README.md`:
- One-paragraph description of The Pitch
- **The lean seeding philosophy** — explicitly document that the DB seeds structural facts only, and dynamic data is fetched live by agents from authoritative APIs. This protects against the "stale seed data confuses agents" failure mode.
- Setup: clone, npm install, configure .env, run migrations, run seed, start dev server
- Available scripts
- Reference to `/docs/worldcup_prompts/`
- Phase status: "Phase 0 (Foundation) — complete"
- Next: Phase 1 (Market Intelligence Skeleton)

## TECHNICAL CONSTRAINTS

- Node.js 20+
- TypeScript strict mode, zero `any` types
- BigInt cents for money — never floating point
- UTC in storage, MT for display only
- Drizzle ORM only
- zod for runtime config validation
- Proper error handling — no naked promises

## TESTING REQUIREMENTS

All must pass:

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero errors
3. `npm run test` — all unit tests pass
4. `npm run test:connectivity` — env validation passes (when .env populated)
5. `npm run db:migrate` — clean migration
6. `npm run db:seed` — successful seed of 48 teams (identity only) + 16 venues + ledger row
7. `curl localhost:3000/health` returns 200 green
8. Seed integrity: confederation counts 6 + 6 + 16 + 10 + 9 + 1 = 48

## PHASE 0 EXIT CRITERIA

1. Project structure matches
2. 15 tables created, indexed
3. 48 teams seeded with name/short_name/confederation only — all other columns NULL
4. 16 venues seeded with lat/lng/altitude/timezone/surface
5. `groups.json` config file exists and is referenced by seed script
6. Initial bankroll ledger row = 0 cents
7. Utility functions tested (95%+ on money path)
8. Health endpoint green with all checks
9. Connectivity script validates env vars
10. README documents the lean seeding philosophy explicitly
11. TypeScript strict passes, all tests pass

## RULES OF ENGAGEMENT

- **Don't pre-seed data agents should fetch.** If a piece of data lives in an external API (FIFA, Odds API, FBref, Elo, Transfermarkt), do NOT seed it. The agent fetches it at runtime. This is the most important rule.
- **Ask before scope creep.** No Quant model, no UI, no live API integration beyond connectivity tests.
- **No LLM calls in Phase 0.**
- **Use the exact team list and spellings above.** Turkiye, Korea Republic, Cabo Verde, Curaçao, DR Congo (COD), Bosnia and Herzegovina (BIH).
- **Verify a few venue coordinates** against Google Maps before committing.
- **Commit incrementally.** Conventional commits.
- **Confirm before destructive ops.**

## WHEN YOU'RE DONE

Report back:

1. One-paragraph summary
2. `npm run test` output
3. `curl localhost:3000/health` output (or expected if .env not populated)
4. Confederation counts: 6 / 6 / 16 / 10 / 9 / 1 = 48
5. List of columns left NULL across all tables (should be most of the team and venue table — confirm this is intentional)
6. Any spec deviations
7. TODOs for later phases
8. Confirmation ready for Phase 1

Do NOT proceed to Phase 1 without my approval.

## CONTEXT: THE STAKES

Tournament opener is today. Full system won't ship by then. Phase 0 goal: foundation that supports Phases 1-5 over 7-10 days, fully operational by Matchday 3 (June 22-25) when the highest-edge opportunities of the group stage hit.

**The lean seeding philosophy is the architectural insight that prevents the failure mode we hit with the NHL system.** Mock and stale seed data caused agents to trust the wrong data over live data. We don't repeat that mistake. If the data isn't structural and unchanging, it doesn't live in the DB at Phase 0 — agents fetch it from authoritative live sources at runtime.

## START HERE

Read the docs. Reply with your 4-bullet Phase 0 understanding. I'll confirm. Then proceed.
