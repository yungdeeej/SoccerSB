# CLAUDE CODE — PHASE 1 EXECUTION PROMPT

## The Pitch — Market Intelligence Skeleton

## Copy everything below this line into Claude Code

---

You are continuing the build of **The Pitch** — a personal World Cup betting intelligence system. Phase 0 (foundation) is complete: schema deployed, 48 teams seeded with identity only, 16 venues seeded with physical facts only, utility functions tested, health check green.

Phase 1 is **Market Intelligence Skeleton**. By the end of Phase 1, you have a working live-odds dashboard. No predictive model yet (that's Phase 2). No discipline gates (that's Phase 3). What you have is:

- Live odds streaming from The Odds API for every World Cup match
- Match fixtures populated from authoritative source
- A web dashboard showing today's slate with live prices, Pinnacle anchor, and best operator-accessible price
- A manual bet placement workflow that writes to the ledger
- Telegram bot configured (no STRIKE alerts yet — those come in Phase 3)

This is the smallest possible *useful* system. The operator can use it to identify stale lines and place informed bets manually, even without any model edge identification.

## YOUR FIRST ACTIONS — BEFORE WRITING CODE

1. Inspect the actual Phase 0 implementation. Specifically:
   - `/src/db/schema.ts` — note the EXACT column names and types
   - `/src/shared/utils/odds.ts` — note function signatures (you'll use stripVigThreeWay heavily)
   - `/src/shared/utils/geo.ts` — note signatures
   - `/src/shared/config/groups.json` — confirm 12 groups loaded
   - `/src/shared/config/books.json` — confirm three-tier book configuration
   - `/src/api/server.ts` — note the patterns used
   - Test setup in `/tests/` — match existing patterns

2. Re-read `/docs/worldcup_prompts/04_AGENT_WOLFMAN.md` in full. This is your build spec for the Wolfman skeleton.

3. Skim `/docs/worldcup_prompts/01_MASTER_ORCHESTRATION.md` Phase 1 section.

4. **Report drift before coding.** Reply with: (a) any differences between the spec's assumed schema and actual Phase 0 schema, (b) actual signatures of utility functions, (c) your Phase 1 build plan. Wait for nothing — proceed after reporting.

## CRITICAL — INHERIT THE LEAN PHILOSOPHY

Phase 0 established that the DB is for structural facts and agent outputs only. Phase 1 must respect this:

**Fetched live (not seeded):**
- Match fixtures (from FIFA API or The Odds API — populates `matches` table)
- Live odds (from The Odds API — populates `odds_snapshots` continuously)
- FIFA team IDs (when fetching fixtures, backfill into `teams.fifa_team_id`)
- FIFA venue IDs (similar)

**Continuously updated:**
- `odds_snapshots` grows append-only with every poll
- `matches.status` updates as games go from scheduled → live → finished

**Computed at runtime:**
- Best available price across operator-accessible books
- Pinnacle no-vig probability
- Line movement since opening

Phase 1 does NOT compute model probabilities (Phase 2). Does NOT issue verdicts (Phase 3). Does NOT compute CLV automatically (Phase 4). It's the raw market intelligence layer.

## PHASE 1 DELIVERABLES

### 1. Fixtures ingestion

Build `/src/agents/wolfman/fixtures.ts`:

- Fetch all 2026 World Cup match fixtures from The Odds API endpoint:
  ```
  GET https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds
    ?apiKey={ODDS_API_KEY}
    &regions=us,us2,uk,eu
    &markets=h2h_3_way,totals,spreads
    &oddsFormat=american
  ```
- Parse the response — each event includes: id, sport_key, sport_title, commence_time, home_team, away_team, bookmakers[]
- Map team names from The Odds API to our `teams` table by name match (with fallback alias logic for spelling variations: "USA" / "United States", "Korea Republic" / "South Korea", etc.)
- **Build a team alias map** in code (not in DB) for cases where The Odds API uses different naming than FIFA:
  - "South Korea" → KOR (Korea Republic)
  - "United States" → USA
  - "Czech Republic" → CZE (Czechia)
  - "Turkey" → TUR (Turkiye)
  - "Cape Verde" → CPV (Cabo Verde)
  - "DR Congo" / "Congo DR" / "Democratic Republic of Congo" → COD
- For each unique match, upsert into `matches`:
  - `fifa_match_id` — placeholder if not yet known (sequential or hash-based)
  - `home_team_id`, `away_team_id` from team lookup
  - `scheduled_kickoff_utc` from `commence_time`
  - `tournament_stage` — infer from date (June 11-25 = group stages md1-3; June 27-July 3 = r32; etc.)
  - `group_letter` — look up from `groups.json` if both teams are in same group, else null
  - `venue_id` — null for now (The Odds API doesn't always provide venue; can be backfilled from FIFA API in a separate task)
  - `status: 'scheduled'`

- Schedule: this script runs once on Phase 1 deployment, then daily at 4am MT to catch any fixture changes (kickoff time shifts, venue changes).

- **Important:** if a team name in The Odds API response doesn't match any of our 48 teams (including aliases), log an error and skip the match. Do NOT create a new team — that's a sign of a name mismatch we need to fix manually.

### 2. Odds polling

Build `/src/agents/wolfman/poll.ts`:

The polling cadence varies by time-to-kickoff per `04_AGENT_WOLFMAN.md`:

| Time before kickoff | Polling frequency |
|---|---|
| > 2 days | Every 6 hours |
| 2 days to 12h | Every 2 hours |
| 12h to 3h | Every 30 minutes |
| 3h to 1h | Every 15 minutes |
| 1h to 15min | Every 5 minutes |
| 15min to 1min | Every 2 minutes |
| T-1min (closing) | Once |
| Post-match (verification) | Once |

Implementation:
- A scheduler that runs every 2 minutes and decides which matches need polling based on time-to-kickoff
- For each match needing a poll, fetch current odds from The Odds API (batch by sport key — single API call returns all WC matches)
- Parse each book's prices for each market:
  - `h2h_3_way` → match outcome (home / draw / away)
  - `totals` → totals (over/under at each line)
  - `spreads` → Asian handicap (home/away at each line)
- Write to `odds_snapshots` (append-only) with:
  - `match_id`, `captured_at`, `book`, `market`, `side`
  - `american_odds`, `decimal_odds`
  - `total_line` (for totals markets), `ah_line` (for Asian handicap)
  - `is_closing_line: true` only for the T-1min snapshot

- **Idempotency:** if a poll runs and the same prices are still there (no change since last snapshot for that match/book/market), still write the row. This gives us a complete time series and lets us measure how long a line held vs moved.

- **API quota awareness:**
  - The Odds API standard tier has ~500 credits/month
  - Each poll of all WC matches counts as ~1-3 credits depending on markets requested
  - During group stage with 4-6 matches/day at peak polling, this could burn through quota quickly
  - Implement a daily quota tracker — log every API call to `agent_runs` with credits used (from response headers `x-requests-used`)
  - If quota drops below 50, switch to reduced polling (every 15min minimum, every 5min in final hour only)
  - Alert operator via Telegram if quota < 25

### 3. Market state computation

Build `/src/agents/wolfman/market_state.ts`:

For each match + market combination, compute the current "market state" used by the dashboard. This is NOT the full Wolfman synthesis from the spec (no LLM, no steam detection, no Asian/Western divergence — those come in Phase 3). This is the minimum viable market intel layer:

For each market (match_outcome, totals at each line, Asian handicap at each line), produce:

```typescript
interface MarketState {
  match_id: string;
  market: string;  // e.g., "match_outcome_home" or "total_over_2.5"
  
  // Current consensus across all books
  current_consensus_american: number;
  
  // Sharp anchors
  pinnacle_current_american: number | null;
  pinnacle_no_vig_prob: number | null;
  sbobet_current_american: number | null;  // if available, often is for soccer
  
  // Best operator-accessible price
  best_book: string;
  best_book_american: number;
  best_book_decimal: number;
  
  // Movement since opening (first snapshot we have)
  opening_consensus_american: number;
  total_movement_cents: number;
  
  // Computed
  no_vig_probability: number;  // from Pinnacle if available, else consensus
  
  computed_at: string;
}
```

Compute this on-demand when the dashboard requests it, OR pre-compute every 10 minutes and cache. Either works for Phase 1. Performance optimization can come later.

**No steam detection.** No RLM. No timing signals. No Asian/Western divergence. Those layers are explicitly Phase 3 (full Wolfman with LLM synthesis).

### 4. Dashboard — Slate view

Build a web dashboard. **Use the Bloomberg-terminal aesthetic** from the NHL Syndicate UI — dense, dark mode, monospace, no fluff. The operator will compare this directly to that system.

Tech stack: Express/Fastify backend (already exists) + simple static HTML + minimal JS frontend, OR React if you want to be fancier. Either works.

`GET /` returns the **Slate view**:

```
┌──────────────────────────────────────────────────────────────────┐
│ THE PITCH                       WORLD CUP 2026 · INTEL · v0.1    │
│ NHL · INTEL TERMINAL · MATCHDAY {N}                              │
├──────────────────────────────────────────────────────────────────┤
│ A1 TODAY'S SLATE · {N} MATCHES                       ◆ RUN POLL  │
│                                                                   │
│  CAR @ VGK    12:00 ET    Group A · Matchday 1    [● LIVE]      │
│  ESP vs CPV   15:00 ET    Group H · Matchday 1    [in 3h]       │
│  ...                                                              │
├──────────────────────────────────────────────────────────────────┤
│ B1 EDGE BOARD (no model edges yet — market view only)            │
│                                                                   │
│  MATCHUP   MKT    SIDE     BOOK       ODDS    PIN   MOVEMENT     │
│  CAR @ VGK  ML    home     fanduel    +210    +195  ↑ 15¢       │
│  CAR @ VGK  ML    draw     fanduel    +260    +250  flat        │
│  ...                                                              │
├──────────────────────────────────────────────────────────────────┤
│ C1 BANKROLL                       AGENT HEALTH                    │
│  ACTIVE: $0.00                    wolfman: success · 234ms        │
│  PEAK: $0.00                      odds_sync: 4m ago               │
│  TODAY'S BETS: 0/5                api_credits: 387/500           │
└──────────────────────────────────────────────────────────────────┘
```

Real implementation details:

- **Sorted by kickoff time** ascending (next match first)
- **Status indicators:** "LIVE" (in progress), "in {hours}h" (upcoming), "FT" (finished)
- **Click on a match** → goes to `/matches/{match_id}` detail view (Section 5)
- **Footer bar** shows: bankroll, today's bets count, API credits remaining, last odds sync time, last Wolfman run time, system status
- **Edge Board section** shows every market across every upcoming match, with:
  - Best operator-accessible price
  - Pinnacle anchor
  - Line movement (↑ X¢ toward home, ↓ X¢ toward away, flat)
  - **NO edge percentage** — we don't have a model yet
  - **NO STRIKE/PASS/WATCH** — those are Phase 3
  - Just market state, sorted by largest movement first

- **Auto-refresh** every 60 seconds via JavaScript fetch (don't reload page, just update data)
- **Manual "RUN POLL" button** triggers an immediate poll, useful when operator wants fresh data right now

### 5. Match detail view

`GET /matches/{match_id}` returns:

```
┌──────────────────────────────────────────────────────────────────┐
│ ← SLATE     SPAIN vs CABO VERDE · GROUP H · MATCHDAY 1           │
├──────────────────────────────────────────────────────────────────┤
│  Kickoff: June 14, 18:00 ET (Hard Rock Stadium, Miami Gardens)   │
│  Status: in 4h 23m                                               │
├──────────────────────────────────────────────────────────────────┤
│ MATCH OUTCOME (1X2)                                              │
│         BEST    PIN     MOVEMENT    BOOK                         │
│  ESP    -380    -395    ↑ 5¢       fanduel                       │
│  Draw   +540    +520    flat       draftkings                    │
│  CPV   +1050   +1100    ↓ 50¢      bet365_ontario                │
├──────────────────────────────────────────────────────────────────┤
│ TOTALS                                                            │
│  Line  Over    Under   Pin (no-vig)   Best Over    Best Under   │
│  1.5   -350    +275    O 82% / U 18%  -340 fanduel  +285 dk     │
│  2.5   -135    +110    O 56% / U 44%  -132 mgm      +115 dk     │
│  3.5   +185    -230    O 35% / U 65%  +195 fanduel  -220 mgm    │
├──────────────────────────────────────────────────────────────────┤
│ ASIAN HANDICAP (selected lines)                                   │
│  -2.5   ESP +145  /  CPV -175                                    │
│  -1.5   ESP -130  /  CPV +110                                    │
│  -0.5   ESP -360  /  CPV +290                                    │
├──────────────────────────────────────────────────────────────────┤
│ LINE MOVEMENT (last 24h)                                          │
│  ESP ML opened -340, current -395 (sharp toward Spain)           │
│  O 2.5 opened -120, current -135 (toward over)                   │
│  CPV +1.5 opened -120, current -135 (no movement)               │
├──────────────────────────────────────────────────────────────────┤
│ [PLACE BET]                                                       │
└──────────────────────────────────────────────────────────────────┘
```

- All available markets shown
- Best operator-accessible price highlighted per market
- Pinnacle no-vig probability shown for context
- Line movement since opening
- "Place Bet" button → opens modal (Section 6)

### 6. Manual bet placement workflow

The most important feature in Phase 1. Without this, the ledger drifts from reality.

`POST /bets/place` — operator submits a bet they placed externally.

Modal flow from match detail page:

```
┌──────────────────────────────────────┐
│  PLACE BET                            │
├──────────────────────────────────────┤
│  Match: ESP vs CPV (Spain)            │
│  Market: [dropdown of available]     │
│  Side: [dropdown - home/draw/away]   │
│  Book: [dropdown - DK, FD, MGM, ...] │
│  Odds (American): [-380]              │
│  Stake ($): [50.00]                   │
│                                       │
│  [CANCEL]            [CONFIRM BET]    │
└──────────────────────────────────────┘
```

On confirm:
1. Validate inputs (stake > 0, valid book, valid market+side combination)
2. Convert stake to cents (BigInt)
3. Compute decimal odds from American
4. Compute potential payout (stake × decimal odds)
5. Insert row into `bets` table with `settlement_status: 'pending'`, `verdict_id: null` (no verdict — manual placement)
6. Insert row into `bankroll_ledger`:
   - `entry_type: 'bet_placed'`
   - `amount_cents: -stake_cents` (debit)
   - `balance_after_cents: prior_balance - stake_cents`
   - `reference_id: bet.id`
   - `notes: '{market} {side} @ {book} {american_odds}'`
   - `source: 'manual'`
7. Atomic transaction — bet insert + ledger insert must succeed together or both fail

If bankroll is 0 (no deposits yet), block the bet and surface a clear error: "Bankroll is $0. Add a deposit before placing bets."

### 7. Manual deposit workflow

The operator needs to be able to fund the bankroll. Without this they can't actually use the system.

`POST /bankroll/deposit`

Modal:

```
┌──────────────────────────────────────┐
│  ADD DEPOSIT                          │
├──────────────────────────────────────┤
│  Amount ($): [500.00]                 │
│  Note: [World Cup bankroll allocation]│
│                                       │
│  [CANCEL]            [CONFIRM]        │
└──────────────────────────────────────┘
```

On confirm:
1. Validate amount > 0
2. Convert to cents
3. Insert into `bankroll_ledger`:
   - `entry_type: 'deposit'`
   - `amount_cents: +deposit_cents`
   - `balance_after_cents: prior_balance + deposit_cents`
   - `reference_id: null`
   - `notes: operator-provided note`
   - `source: 'manual'`

### 8. Bet settlement workflow

When matches finish, operator needs to settle bets to update the ledger.

`POST /bets/{bet_id}/settle`

Modal:

```
┌──────────────────────────────────────┐
│  SETTLE BET                           │
├──────────────────────────────────────┤
│  Match: ESP vs CPV                    │
│  Final: 4-0 Spain                     │
│  Bet: ESP ML @ -380 ($50.00)         │
│                                       │
│  Outcome: [dropdown]                  │
│    - Win                              │
│    - Loss                             │
│    - Push                             │
│    - Half Win (AH)                    │
│    - Half Loss (AH)                   │
│    - Void                             │
│                                       │
│  [CANCEL]            [CONFIRM]        │
└──────────────────────────────────────┘
```

On confirm:
1. Update `bets` row: `settlement_status: 'settled'`, `outcome`, `settled_at`
2. Compute P&L based on outcome:
   - Win: `payout_cents = stake_cents * decimal_odds`, `pl_cents = payout_cents - stake_cents`
   - Loss: `payout_cents = 0`, `pl_cents = -stake_cents`
   - Push: `payout_cents = stake_cents`, `pl_cents = 0`
   - Half Win: `payout_cents = stake * (1 + (decimal-1)/2)`, `pl_cents = payout - stake_cents`
   - Half Loss: `payout_cents = stake_cents / 2`, `pl_cents = -stake_cents / 2`
   - Void: `payout_cents = stake_cents`, `pl_cents = 0`
3. If payout > 0, insert ledger row:
   - `entry_type: 'bet_settled'`
   - `amount_cents: +payout_cents`
   - `balance_after_cents: prior_balance + payout_cents`
   - `reference_id: bet_id`
   - `notes: '{match} {outcome}'`
   - `source: 'system_settlement'` (even though triggered manually)

CLV computation is **deferred to Phase 4 (Treasurer)**. In Phase 1 we capture closing lines via Wolfman polling but don't compute CLV automatically. We can backfill CLV later from the captured `odds_snapshots`.

### 9. Bets list view

`GET /bets` shows all bets, sortable by date / outcome / P&L:

```
┌──────────────────────────────────────────────────────────────────┐
│ BETS · ALL                                                        │
├──────────────────────────────────────────────────────────────────┤
│  Date       Match        Market   Side   Book   Stake   Result   │
│  Jun 14    ESP-CPV       ML       ESP    FD     $50    WIN +$13  │
│  Jun 13    BRA-MAR       O 2.5   -        DK     $40    LOSS -$40│
│  ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

Each row clickable to a bet detail view. Settle button on unsettled bets.

### 10. Telegram bot setup (skeleton only)

Wire up the Telegram bot with one command:

`/status` — returns current bankroll, today's bet count, last odds sync time, last fixture sync, API credits remaining

Don't build STRIKE alerts yet (no verdicts yet). Don't build daily reports yet (no aggregated performance yet). Just confirm the bot is connected and can send/receive messages.

### 11. Agent runs logging

Every poll, every fixtures sync, every market state computation logs to `agent_runs`:
- `agent`: 'wolfman'
- `ran_at`: now
- `match_id`: if applicable
- `run_phase`: 'fixtures_sync' | 'odds_poll' | 'market_state_compute'
- `status`: success / failed_recoverable / failed_fatal
- `duration_ms`
- `error_message`, `error_stack` if failed
- `outputs_summary`: `{ matches_synced: 12, odds_snapshots_written: 234, api_credits_used: 3 }`

This is the foundation for Phase 5's agent health dashboard.

## SCOPE BOUNDARIES — DO NOT BUILD THESE IN PHASE 1

- ❌ No predictive model (no Quant) — that's Phase 2
- ❌ No situational adjustments (no Tactician) — that's Phase 2
- ❌ No STRIKE/PASS/WATCH verdicts (no CEO) — that's Phase 3
- ❌ No discipline gates — Phase 3
- ❌ No automatic CLV computation — Phase 4
- ❌ No stop-loss enforcement — Phase 4
- ❌ No Kelly stake recommendations — Phase 3 (CEO output) + Phase 4 (Treasurer)
- ❌ No steam detection, RLM, Asian/Western divergence — Phase 3 (full Wolfman)
- ❌ No LLM calls anywhere — Phase 3+
- ❌ No agent run scheduling beyond the polling cron — Phase 3+
- ❌ No player rosters / lineups — Phase 3 (Tactician)
- ❌ No referee assignments — Phase 3
- ❌ No weather data — Phase 3
- ❌ No backtest harness — Phase 2

If you find yourself wanting to build one of these, STOP and ask. The discipline of phased delivery is what gets us a working system by Matchday 3.

## TECHNICAL CONSTRAINTS (UNCHANGED FROM PHASE 0)

- Node.js 20+, TypeScript strict mode, zero `any`
- All money is BigInt cents — never floating point
- All timestamps UTC in storage, MT for display
- Drizzle ORM only
- zod for runtime validation of API responses (The Odds API responses must be validated before insertion)
- Proper error handling, no naked promises
- Match existing test patterns from Phase 0

## TESTING REQUIREMENTS

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero errors
3. `npm run test` — all unit tests pass including new ones for:
   - Fixtures parsing (mock The Odds API response)
   - Team alias resolution
   - Odds parsing per market type
   - Market state computation
   - Bet placement transaction integrity (debit + bet insert atomic)
   - Bet settlement payout math (win, loss, push, half-win, half-loss)
   - Ledger integrity after 100 simulated bet placements + settlements
4. `npm run test:integration` — at least one test against The Odds API (or recorded fixture) verifying we can parse a real response
5. Dashboard loads at `localhost:3000/` and shows mock or live data
6. Bet placement modal works end-to-end with database verification
7. Settlement modal works end-to-end

## PHASE 1 EXIT CRITERIA

1. The Odds API integration working — fixtures + odds polling
2. `matches` table populated with all upcoming World Cup matches
3. `odds_snapshots` table receiving polling writes
4. Slate view at `/` showing all upcoming matches with current odds and best prices
5. Match detail view at `/matches/{id}` showing all markets
6. Bet placement workflow writing to `bets` + `bankroll_ledger` atomically
7. Deposit workflow writing to `bankroll_ledger`
8. Settlement workflow updating bets + writing payout to ledger
9. Bets list view at `/bets`
10. Telegram bot responding to `/status`
11. All polls and syncs logging to `agent_runs`
12. API quota tracker working, alerting at threshold
13. All tests passing
14. README updated with Phase 1 setup

## RULES OF ENGAGEMENT

- **Report drift first.** Before coding, identify any spec/implementation mismatches from Phase 0.
- **Don't expand scope.** Phase 1 is market intel + manual workflows. Nothing else.
- **The lean philosophy still applies.** Fetch live data from APIs, don't seed it. The only data flowing INTO the DB in Phase 1 is: match fixtures (from API), odds snapshots (from API), manually-entered bets, manually-entered deposits/settlements.
- **API quota matters.** Be defensive about The Odds API usage. Log every credit used. Implement adaptive polling.
- **Validate API responses with zod.** The Odds API can return surprising shapes — never trust the response without validation.
- **Atomicity matters.** Bet placement = transaction. Settlement = transaction. Deposit = single insert. No half-states.
- **Match the NHL Syndicate aesthetic.** Bloomberg terminal style. Dense, dark mode, monospace, no fluff.

## WHEN YOU'RE DONE

Report back:

1. One-paragraph summary
2. `npm run test` output
3. Screenshot or description of the Slate view rendering live data
4. Number of matches fetched from The Odds API
5. Number of odds_snapshots after first poll cycle
6. Telegram `/status` command working
7. End-to-end test of bet placement → ledger update → settlement → ledger update
8. API credits used so far this month
9. Any spec deviations and why
10. TODOs for later phases
11. Confirmation ready for Phase 2 (Quant + Tactician — predictive model layer)

Do NOT proceed to Phase 2 without my approval.

## CONTEXT

The tournament is live. The system is not yet model-driven, but with Phase 1 complete, the operator can:
- See all live World Cup odds in one terminal
- Identify stale lines at soft books (Pinnacle vs DraftKings gaps)
- Place bets manually with full ledger integrity
- Track bankroll properly

This is enough to be useful starting today. The model layers (Phases 2-4) sharpen the edge identification, but Phase 1 alone is already better than betting from a browser with sportsbook apps open in tabs.

## START HERE

Inspect the Phase 0 implementation. Re-read `04_AGENT_WOLFMAN.md`. Then reply with your drift report and Phase 1 build plan before writing any code.
