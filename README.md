# THE PITCH — World Cup 2026 Betting Intelligence System

## What this is

A personal betting intelligence system for the 2026 FIFA World Cup, built on the same architecture and Walters discipline principles as **The Syndicate** (the NHL system), but adapted for international soccer.

Like The Syndicate, this system:
- Identifies edges, recommends bets at specific prices, and enforces sizing discipline
- Does NOT auto-place bets — the operator places manually via mobile sportsbook apps
- Is a single-operator tool, not a SaaS

Unlike The Syndicate, this system:
- Runs only during the World Cup window (June 11 - July 19, 2026)
- Uses a leaner 4-agent architecture (vs the NHL system's 6 agents)
- Operates against more efficient markets, demanding tighter edge thresholds
- Models a sport with fundamentally different scoring distribution (low-scoring, draws are first-class outcomes)

---

## The Tournament

**Dates:** June 11 - July 19, 2026 (39 days)
**Teams:** 48 (up from 32 in 2022)
**Matches:** 104 total
**Hosts:** Canada, Mexico, United States
**Format change:** 12 groups of 4 teams; top 2 + 8 best third-place teams advance to a new **Round of 32** before Round of 16. This Round of 32 has no historical precedent and represents a structural unknown for the entire market.

**Phases of the tournament:**
- Group Stage (June 11 - June 25): 72 matches across 16 days
- Round of 32 (June 28 - July 3): 16 matches
- Round of 16 (July 4 - July 7): 8 matches
- Quarterfinals (July 9 - July 11): 4 matches
- Semifinals (July 14 - July 15): 2 matches
- Third Place (July 18): 1 match
- Final (July 19): 1 match

---

## Architecture (Bloomberg Terminal Style)

```
┌─────────────────────────────────────────────────────────────┐
│           THE PITCH — INTEL TERMINAL (v1)                   │
├─────────────────────────────────────────────────────────────┤
│  External data sources                                       │
│    └─ The Odds API (live + historical odds)                  │
│    └─ FBref / Understat (xG, team stats)                     │
│    └─ Elo Ratings (eloratings.net)                           │
│    └─ Transfermarkt (player market values)                   │
│    └─ FIFA / FBref (match results, lineups)                  │
│    └─ OpenWeather (venue conditions)                         │
│    └─ Beat reporters / national team news                    │
├─────────────────────────────────────────────────────────────┤
│  Agents (orchestrated runs at T-24h, T-12h, T-2h, T-30min)  │
│                                                              │
│    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│    │ THE QUANT   │  │THE TACTICIAN│  │ THE WOLFMAN │        │
│    │ (Python)    │  │(TypeScript) │  │ (Haiku LLM) │        │
│    └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│           │                 │                 │              │
│           └─────────────────┼─────────────────┘              │
│                             │                                │
│                       ┌─────▼─────┐                          │
│                       │  THE CEO  │  (Sonnet LLM)            │
│                       │ Synthesis │                          │
│                       └─────┬─────┘                          │
│                             │                                │
│                       ┌─────▼─────┐                          │
│                       │ TREASURER │  (TypeScript)            │
│                       │  Discipline│                          │
│                       └─────┬─────┘                          │
├─────────────────────────────┼───────────────────────────────┤
│  Outputs                    │                                │
│    └─ STRIKE / PASS / WATCH verdicts                         │
│    └─ Kelly stake recommendations                            │
│    └─ Telegram alerts                                        │
│    └─ Web dashboard (terminal aesthetic)                     │
│    └─ Bet ledger + CLV tracking                              │
└─────────────────────────────────────────────────────────────┘
```

---

## The Agents

| Agent | Model | Role |
|---|---|---|
| **The Quant** | None (Python FastAPI) | Bivariate Poisson statistical model; outputs joint goal distribution and all derived market probabilities |
| **The Tactician** | None (TypeScript) | Situational adjustments: rest days, travel, altitude, weather, tactical matchup, motivation, lineups, set-piece efficiency, referee tendencies |
| **The Wolfman** | Claude Haiku 4.5 | Market intelligence: line movement, steam detection, sharp-soft divergence, Asian/Western market divergence, Walters timing signals |
| **The CEO** | Claude Sonnet 4.5 | Walters-persona synthesis; applies discipline gates; issues STRIKE/PASS verdicts with star rating |
| **The Treasurer** | None (TypeScript) | Bankroll ledger, Kelly sizing, stop-loss enforcement, CLV computation, daily reports |

---

## v1 Scope (markets)

Match-level markets only:
- Match outcome (1X2 — three-way moneyline)
- Double chance (1X, X2, 12)
- Draw No Bet
- Totals (Over/Under at 0.5, 1.5, 2.5, 3.5, 4.5)
- Asian Handicap (-2.0 to +2.0 in 0.25 increments)
- Both Teams to Score (BTTS)
- Half-time / Full-time
- Half-time totals

All derived deterministically from the same underlying joint goal distribution.

## v2 Scope (deferred — added during tournament if v1 is working)

- Player props (anytime goalscorer, first goalscorer, shots on target, cards)
- Corners, cards, throw-ins prop markets
- Tournament futures (group winner, advance to knockouts, reach R16/QF/SF/F, golden boot, winner)
- Live in-play markets (if any agent layer survives the latency requirement)

---

## File Index

| File | Purpose |
|---|---|
| `README.md` | This file |
| `00_WALTERS_FOR_SOCCER.md` | Constitutional layer — Walters principles adapted for soccer markets |
| `01_MASTER_ORCHESTRATION.md` | Run schedule, build phases, dependency graph, failure handling |
| `02_AGENT_QUANT.md` | Statistical model spec (Bivariate Poisson, Elo + market values, calibration) |
| `03_AGENT_TACTICIAN.md` | Situational engine spec (11 factor categories + lineup confirmation) |
| `04_AGENT_WOLFMAN.md` | Market intel spec (book tiers, steam detection, Asian/Western divergence) |
| `05_AGENT_CEO.md` | Walters persona, discipline gates, star rating, verdict format |
| `06_AGENT_TREASURER.md` | Adapted from NHL — bankroll, Kelly, CLV, stop-loss |
| `07_SHARED_CONTRACTS.md` | Database schema, message contracts, utility functions |

---

## Operator Information

- **Operator:** DJ (Calgary, AB, Mountain Time)
- **Starting bankroll:** Not yet allocated (to be set before live betting)
- **Goal:** Build a tournament-long edge against the closing line; positive rolling CLV by Round of 16
- **Bet placement:** Manual via mobile sportsbook apps
- **Sportsbook accounts:** DraftKings, FanDuel, BetMGM, Bet365 (Ontario), Caesars; Pinnacle as read-only anchor via The Odds API

---

## Why This Is Different From The Syndicate

Several key differences from the NHL system that bettors and builders should internalize:

### Market efficiency is higher
Soccer markets, particularly at Pinnacle, are widely considered the sharpest in all of sports betting. A study of 397,935 Pinnacle football games showed r² = 0.997 between closing lines and actual outcomes. Your edge against the closing line will be measured in tenths of a percent, not whole percentages. Discipline gates are tighter accordingly.

### Draws are first-class outcomes
Roughly 25-30% of international matches end in draws. The three-way moneyline is the standard market, not the two-way. The model produces three probabilities (home win, draw, away win) not two, and all derived markets must account for this.

### Goal scoring is low and variance is high
NHL averages ~6 goals per game. World Cup averages ~2.5. Single goals matter enormously. Empty-net dynamics don't exist, but late-game tactical lockdown ("parking the bus") does — and it materially affects totals markets.

### Sample size on national teams is tiny
National teams play 8-12 competitive matches per year against wildly varying opposition. Rolling team stats are unreliable. The model must blend national team results with **club-level player performance + market values** to compensate (the PELE / FiveThirtyEight SPI approach).

### The 48-team format is unprecedented
The Round of 32 has never existed before. Coach rotation strategies, group stage motivation dynamics, and rest patterns will be different from prior World Cups. Historical training data partially applies, partially does not. The Tactician must be willing to adjust coefficients faster than usual.

### Tournament structure creates predictable edges
Matchday 3 of the group stage is the most documented edge in World Cup betting: already-qualified teams rotate and play conservatively, while teams fighting for advancement play with maximum intensity. The Tactician explicitly tracks motivation differential as a factor.

### Asian markets matter
For soccer specifically, Asian sportsbooks (Sbobet, IBC) are influential market makers, sometimes leading Pinnacle on Asian handicap and totals. The Wolfman tracks Asian/Western market divergence as a sharp signal.

---

## Walters Integration

This spec carries forward the Walters Chapter 21 constitutional layer with soccer-specific adaptations. See `00_WALTERS_FOR_SOCCER.md` for the full mapping. Key principles unchanged:

- 1-3% bet sizing with quarter-Kelly default
- PASS is a first-class output
- CLV is the truth metric
- Pinnacle is the anchor
- Bet favorites early, dogs late
- Daily bet cap with discipline override
- Stop-loss enforcement

Key principles adapted:

- Home advantage is heavily situational (host nation, neutral venue with travel)
- Cluster injury concept extends to "double absence" (top scorer + creative midfielder)
- "Prevent" becomes "park the bus" — affects totals more than outcome
- Divisional rivalry → tournament motivation differential

---

## Version

- **Spec version:** 1.0
- **Sport scope:** International soccer (World Cup 2026 specifically)
- **Status:** Spec complete — ready for code execution
- **Tournament begins:** June 11, 2026 (Mexico vs South Africa, Estadio Azteca, 12:00 ET)
