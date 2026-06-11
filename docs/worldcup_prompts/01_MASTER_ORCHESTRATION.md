# 01 — MASTER ORCHESTRATION

## Execution Schedule, Build Phases, and Dependency Graph

---

## TOURNAMENT SCHEDULE

The Pitch operates against the 2026 FIFA World Cup, June 11 - July 19, 2026.

### Daily match volume
- **Group stage (June 11-25):** 4-6 matches per day
- **Round of 32 (June 28 - July 3):** 2-3 matches per day
- **Round of 16 (July 4-7):** 2 matches per day
- **Quarterfinals (July 9-11):** 1-2 matches per day
- **Semifinals (July 14, July 15):** 1 match per day
- **Final week (July 18-19):** 1 match per day

### Typical kickoff times (local US/Canada/Mexico)
- 12:00 / 15:00 / 18:00 / 21:00 ET in most US/Canada venues
- 12:00 / 15:00 / 19:00 / 21:00 CT for Mexico City matches
- 12:00 / 16:00 / 19:00 PT for west coast venues

### Operator's home timezone
Mountain Time (MT). All Telegram alerts and dashboard displays render in MT.

---

## PER-MATCH AGENT PIPELINE

For every World Cup match, the system executes the following pipeline at four scheduled checkpoints before kickoff:

### Pipeline order

```
1. The Quant         → computes match probabilities (Bivariate Poisson)
2. The Tactician     → applies situational adjustments to Quant output
3. The Wolfman       → captures market state, identifies sharp signals
4. The CEO           → synthesizes outputs, applies discipline gates, issues verdict
5. The Treasurer     → on STRIKE: computes stake; on settled bet: computes CLV
```

Each agent must complete before the next one runs. Agents communicate only through the Postgres database — never direct calls.

### Checkpoint schedule

| Checkpoint | Time before kickoff | Purpose |
|---|---|---|
| T-24h | 24 hours | Initial baseline prediction with projected XIs |
| T-12h | 12 hours | Refinement after pre-match press conferences |
| T-2h | 2 hours | Primary verdict — most actionable timing |
| T-30min | 30 minutes | Lock verdict — final word, no further updates |

After T-30min, no new verdicts are issued for the match. The Wolfman continues capturing odds until kickoff for closing-line capture (T-1min snapshot).

---

## DAILY OPERATIONS

### Nightly batch (3:00 AM MT)
- Pull all yesterday's match results
- Compute CLV for any settled bets (Treasurer)
- Update Elo ratings using yesterday's results (Quant)
- Refresh team xG rolling stats (Quant)
- Generate overnight intelligence summary
- Pre-compute T-24h baseline predictions for all matches kicking off in next 24 hours

### Morning report (8:00 AM MT)
- Treasurer generates daily summary: bankroll, CLV, today's matches
- Telegram alert with summary to operator
- Dashboard updated with day's slate

### Pre-match cycles (per match)
- Trigger pipeline at T-24h, T-12h, T-2h, T-30min
- Telegram alerts on STRIKE verdicts (priority HIGH)
- Telegram alerts on STRIKE downgrades after operator may have bet (priority CRITICAL)

### Post-match (within 1 hour of final whistle)
- Capture final result from FBref / FIFA / ESPN
- Settle any pending bets on this match
- Compute CLV using closing line snapshot
- Update model calibration metrics

---

## BUILD PHASE ORDER

Given the tournament starts June 11 and we cannot ship a full system by then, build in this order. Each phase delivers usable capability before the next phase begins.

### Phase 0 — Foundation (Days 1-2)
**Deliverable:** Working database, project scaffolding, deployable to Replit
- Postgres provisioned (Neon or Replit DB)
- Drizzle ORM schema deployed (see `07_SHARED_CONTRACTS.md`)
- Seed data: 48 World Cup teams, 16 host cities/venues, beat reporters config
- Health check endpoint
- Environment variables configured

### Phase 1 — Market Intelligence Skeleton (Days 2-3)
**Deliverable:** Live odds capture and display, no predictive model
- The Odds API integration for World Cup
- Odds polling cron (Wolfman skeleton — capture only, no analysis yet)
- Basic web dashboard showing today's slate with live odds
- Best price identification across configured books
- Pinnacle no-vig probability computed and displayed
- Bet placement workflow (manual via dashboard, writes to ledger)
- Telegram bot configured (alerts on STRIKEs not firing yet, but channel is live)

After Phase 1, the operator has a Bloomberg-terminal style view of all World Cup matches with live odds and Pinnacle anchoring, and can record bets to the ledger manually. **No model edge identification yet.**

### Phase 2 — Quant + Tactician (Days 3-5)
**Deliverable:** Predictive model producing fair probabilities
- Quant Python service deployed
- Elo rating integration (eloratings.net)
- xG data integration (FBref scraper or paid API)
- Bivariate Poisson implementation with draw handling
- Tactician TypeScript service deployed
- All 11 Tactician factor modules implemented
- Composition engine with ±12% cap
- Quant + Tactician outputs visible on game detail page
- **First STRIKEs theoretically possible (but CEO not built yet)**

### Phase 3 — Wolfman + CEO (Days 5-7)
**Deliverable:** Full STRIKE/PASS verdicts with discipline gates
- Wolfman full implementation (LLM synthesis, steam detection, divergence)
- CEO full implementation (Walters persona, 7 discipline gates, star rating)
- End-to-end pipeline: STRIKE/PASS verdicts produced for every match
- Telegram alerts firing on STRIKEs
- **First real betting recommendations**

### Phase 4 — Treasurer (Day 7-8)
**Deliverable:** Bankroll discipline and CLV tracking
- Treasurer port from NHL system (largely unchanged — sport-agnostic)
- Kelly calculator wired to CEO output
- Stop-loss state machine
- CLV computation on settled bets
- Daily reports
- **Full system operational**

### Phase 5 — Dashboard Refinement (Day 8-10)
**Deliverable:** Production-grade UI
- Slate view (all today's matches)
- Edge Board (all candidate markets across the slate)
- Game detail page with full agent reasoning
- Verdict detail page (post-mortem capability)
- Treasurer panel
- Agent health view
- Match through to v2 features (props/futures) as tournament progresses

### Realistic timeline summary

| Date | Phase | What works |
|---|---|---|
| June 11 (opener) | Pre-Phase 0 | Nothing built yet |
| June 13-14 | Phase 1 done | Live odds dashboard, manual bet entry |
| June 16-17 | Phase 2 done | Quant + Tactician producing probabilities (no verdicts) |
| June 19-20 | Phase 3 done | Full system producing STRIKE/PASS verdicts |
| June 21-22 | Phase 4 done | Treasurer wired, CLV tracking, ready for Matchday 3 |
| June 22-25 | Phase 5 ongoing | Polish during the highest-edge betting window (Matchday 3) |

**Critical:** by Matchday 3 (June 22-25) the system must be complete enough to identify the motivation-gap edges that are the most documented opportunities in World Cup betting.

---

## DEPENDENCY GRAPH

The pipeline for a single match:

```
                  ┌──────────────┐
                  │   The Odds   │
                  │   API + xG   │
                  │   sources    │
                  └──────┬───────┘
                         │
            ┌────────────┼────────────┐
            ▼            ▼            ▼
      ┌─────────┐  ┌──────────┐  ┌──────────┐
      │  Quant  │  │Tactician │  │ Wolfman  │
      │ (model) │  │(situat.) │  │ (market) │
      └────┬────┘  └─────┬────┘  └─────┬────┘
           │             │              │
           └─────────────┼──────────────┘
                         │
                  ┌──────▼──────┐
                  │     CEO     │
                  │  (synthesis │
                  │  + gates)   │
                  └──────┬──────┘
                         │
                    if STRIKE
                         │
                  ┌──────▼──────┐
                  │  Treasurer  │
                  │   (stake)   │
                  └──────┬──────┘
                         │
                  ┌──────▼──────┐
                  │  Operator   │
                  │  (manual    │
                  │   bet)      │
                  └─────────────┘
```

### Critical dependencies
- Tactician requires Quant output to exist (it applies adjustments to Quant probabilities)
- Wolfman runs independently and in parallel with Quant + Tactician
- CEO requires Quant, Tactician, and Wolfman outputs to all be present
- Treasurer is called only when CEO issues STRIKE
- If any required upstream agent fails, CEO automatically returns PASS with reason "upstream agent failure: {agent}"

---

## FAILURE HANDLING

### Agent failure
- All agent failures logged to `agent_runs` with status `failed_recoverable` or `failed_fatal`
- Recoverable failures: retry with exponential backoff (30s, 2min, 10min)
- Fatal failures: alert operator via Telegram, halt pipeline for this match
- After 3 retries: mark as failed, CEO auto-PASSes

### External data source failures

| Source | Primary | Fallback | If both fail |
|---|---|---|---|
| The Odds API | Standard tier | DonBest scraping | Manual entry, flag bets for caution |
| FBref data | Scrape | Alternative scrape (worldfootball.net) | Use prior cached data (max 48h stale) |
| Elo ratings | eloratings.net | Stale local cache | Use FIFA rankings as proxy |
| Lineup news | Multiple sources | Beat reporter Twitter | Flag lineup as unconfirmed |
| Weather | OpenWeather | AccuWeather | Use seasonal historical |

### Closing line capture missed
- T-1min capture fails → retry at T+30s
- If still missed, use last captured snapshot as closing line proxy
- Flag affected bets for manual CLV review

### Database connection lost
- CEO cannot issue verdicts → pipeline halts
- Telegram alert CRITICAL
- All new bet placement blocked until restored

---

## TELEGRAM NOTIFICATION POLICY

The Telegram bot is the primary operator interface for time-sensitive events.

### Priority levels

| Priority | Trigger | Example |
|---|---|---|
| CRITICAL | Stop-loss halt, database failure, STRIKE downgrade after potential bet | "🛑 STOP-LOSS HALT TRIGGERED" |
| HIGH | New STRIKE issued, late-game scratch detected, agent failure | "🎯 STRIKE: France ML -135 @ DK" |
| MEDIUM | Lineup change detected, weather alert, line freeze | "⚠️ Mbappé scratched from France XI" |
| LOW | Daily reports, agent activity summaries | "📊 Daily summary: bankroll $X, CLV +0.5¢" |

### Alert format

```
[PRIORITY] [STAGE]
{Brief headline}
{Detail line 1}
{Detail line 2}

{Optional dashboard link}
```

### Notification frequency limits
- Maximum 1 STRIKE alert per match per checkpoint (no spam if model re-runs)
- Maximum 1 daily report per day
- No notifications between 12am-7am MT unless CRITICAL

---

## ENVIRONMENT VARIABLES

```bash
# Database
DATABASE_URL=postgresql://...

# LLM
ANTHROPIC_API_KEY=sk-ant-...

# Odds data
ODDS_API_KEY=...
ODDS_API_TIER=standard  # or pro

# Soccer data
FBREF_SCRAPE_ENABLED=true
ELO_RATINGS_API_URL=https://eloratings.net/...

# Weather
OPENWEATHER_API_KEY=...

# Notifications
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Operator
OPERATOR_TIMEZONE=America/Edmonton
OPERATOR_CURRENCY=CAD

# System mode
SYSTEM_ENV=development  # or 'live'
KELLY_FRACTION_OVERRIDE=  # blank uses default 0.25, set 0.125 for half-Kelly during testing
```

---

## OPERATING PRINCIPLES (UNIVERSAL)

Every agent enforces these. See `00_WALTERS_FOR_SOCCER.md` for full constitutional treatment.

1. The LLM never invents numbers
2. PASS is a first-class output
3. CLV is the truth metric
4. Append-only ledger
5. Fail-safe to PASS on upstream failure
6. Log every agent run
7. Discipline gates are un-bypassable
8. Integer cents only
9. UTC everywhere
10. Pinnacle is the anchor

---

## CRITICAL HUMAN-IN-THE-LOOP CHECKPOINTS

The operator must explicitly approve before each phase transition:

| Checkpoint | Required Approval |
|---|---|
| Phase 0 → 1 | Database operational, schemas deployed |
| Phase 1 → 2 | Manual odds capture confirmed working for 24h |
| Phase 2 → 3 | Quant predictions look reasonable on first 8-10 games |
| Phase 3 → 4 | First STRIKE/PASS verdicts reviewed for voice quality |
| Phase 4 → 5 | Treasurer Kelly math verified manually on 3-5 test cases |
| Live betting | First 7 days at half-Kelly sizing minimum |

No automated phase transitions. The operator decides when the system has earned more capital exposure.

---

## TWO ADDITIONAL CHECKPOINTS UNIQUE TO WORLD CUP

### Pre-Round-of-32 review (June 25-26)
Before the new untested format begins, manual review of:
- All Matchday 3 results vs system predictions
- Calibration drift on totals (often the first signal of model issues)
- Tactician coefficient sanity check

### Pre-Final week review (July 12-13)
Before the final-week high-stakes matches:
- Full system audit
- Bankroll review (likely time to compound or withdraw)
- Stop-loss state confirmation
