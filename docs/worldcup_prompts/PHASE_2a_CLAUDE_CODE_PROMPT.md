# CLAUDE CODE — PHASE 2a EXECUTION PROMPT

## The Pitch — The Quant (Statistical Model)

## Copy everything below this line into Claude Code

---

You are continuing the build of **The Pitch**. Phases 0 (foundation) and 1 (market intelligence skeleton) are complete. The slate view is live, odds are streaming, manual bet placement works.

Phase 2a is **The Quant** — the statistical model that produces fair probabilities for every World Cup market. This is the engine. Every other agent in the system either feeds The Quant data or acts on its outputs.

Phase 2b (The Tactician) is a separate prompt we'll do after this ships. Do not build the Tactician in this phase.

## YOUR FIRST ACTIONS — BEFORE WRITING ANY CODE

1. Inspect actual Phase 0 + Phase 1 implementation:
   - `/src/db/schema.ts` — exact column names for `teams`, `matches`, `model_predictions`, `agent_runs`
   - `/src/shared/utils/odds.ts` — function signatures
   - `/src/agents/wolfman/` — how the existing TypeScript agent is structured (you'll mirror the patterns)
   - `/src/api/server.ts` — how the existing API is wired
   - Test setup in `/tests/`

2. Read `/docs/worldcup_prompts/02_AGENT_QUANT.md` in full. This is your build spec.

3. Read `/docs/worldcup_prompts/00_WALTERS_FOR_SOCCER.md` — Walters principles around model discipline.

4. Skim `/docs/worldcup_prompts/03_AGENT_TACTICIAN.md` — you don't build this, but you need to know what data the Tactician will consume from your Quant output, so the contract is right.

5. **Report drift first.** Reply with:
   - Schema differences between spec and Phase 0/1 actual
   - Phase 1 patterns I should follow (cron scheduling, error handling, agent_runs logging, etc.)
   - Your Phase 2a build plan

Wait for nothing — proceed after reporting.

## ARCHITECTURAL DECISION: PYTHON FASTAPI MICROSERVICE

The Quant runs as a separate Python FastAPI service that the TypeScript orchestrator calls via HTTP. This is the right architecture because:

- Scientific Python (numpy, scipy.stats, scipy.optimize, pandas) is genuinely superior for Bivariate Poisson, bootstrap CIs, and calibration
- Isolation: math bugs in Python don't crash the TypeScript backend
- Easier model versioning and deployment

**Inter-service contract:**
- TypeScript orchestrator calls Python via internal HTTP (e.g., `http://localhost:8001/predict`)
- Python service writes results directly to Postgres (shared DB)
- Python service ALSO returns results to caller so TypeScript can react immediately
- Both services log to `agent_runs` table

**Replit deployment:** use a `Procfile` or equivalent to run both processes concurrently:
```
web: npm run start
quant: cd src/agents/quant && uvicorn main:app --port 8001
```

## CRITICAL — INHERIT THE LEAN PHILOSOPHY

Phase 0 established: DB stores structural facts and agent outputs only. Phase 1 added match fixtures and odds snapshots from live APIs.

Phase 2a layers in:

**Fetched live (not seeded):**
- Elo ratings from eloratings.net (nightly scrape)
- Market values from Transfermarkt (weekly scrape)
- Team xG and rolling stats from API-Football (paid fallback for FBref blocks)
- Recent match results from FIFA / The Odds API

**Written by The Quant:**
- `model_predictions` table — every prediction the model makes
- `model_versions` table — version snapshots when parameters change
- `agent_runs` — every run logged with duration, status, outputs summary

**NEVER seed:**
- Specific Elo values
- Specific market values
- Specific xG aggregates
- Specific composite ratings

The model fetches these from authoritative sources at runtime. Stale seed data causes the failure mode we're avoiding.

## ENVIRONMENT CONTEXT

- You'll need API-Football account ($25/month entry tier). I'll provide `APIFOOTBALL_KEY` in `.env`. Sign up endpoint: rapidapi.com/api-sports/api/api-football
- Python 3.11+ for the Quant service
- Existing TypeScript backend stays as Phase 0/1 left it — you're adding the Quant alongside, not replacing

## PHASE 2a DELIVERABLES

### 1. Python service skeleton

Create `/src/agents/quant/`:

```
/src/agents/quant/
├── main.py                       # FastAPI app entry
├── pyproject.toml                # Python dependencies (use poetry or uv)
├── README.md                     # service-specific docs
├── config/
│   ├── model_params.yaml         # all model parameters
│   └── confederation_strength.yaml  # base strength priors per confederation
├── model/
│   ├── __init__.py
│   ├── bivariate_poisson.py      # core model
│   ├── draw_inflation.py         # draw correction
│   ├── venue_factor.py           # host nation + altitude
│   ├── composite_rating.py       # Elo + market value + xG blend
│   ├── bootstrap.py              # CI computation
│   └── markets.py                # derive all market probabilities from joint dist
├── data/
│   ├── __init__.py
│   ├── elo_loader.py             # eloratings.net scraper
│   ├── transfermarkt_loader.py   # market value scraper
│   ├── api_football_loader.py    # paid API client
│   ├── results_loader.py         # match results from FIFA/Odds API
│   └── db.py                     # Postgres connection (psycopg or sqlalchemy)
├── calibration/
│   ├── __init__.py
│   ├── backtest.py               # 2022 Qatar World Cup backtest
│   ├── validation.py             # weekly Brier score check
│   └── recalibrate.py            # post-matchday recalibration logic
├── api/
│   ├── __init__.py
│   ├── routes.py                 # FastAPI routes
│   └── schemas.py                # pydantic models matching TS contracts
└── tests/
    ├── test_model.py
    ├── test_markets.py
    ├── test_data_loaders.py
    └── test_backtest.py
```

Use **uv** for Python dependency management (faster than poetry). Required packages:
- fastapi, uvicorn
- numpy, scipy, pandas
- psycopg[binary] (Postgres driver)
- httpx (HTTP client for data loaders)
- beautifulsoup4 + lxml (for scrapers)
- pydantic, pydantic-settings (config)
- pytest, pytest-asyncio (testing)
- ruff (linting)
- mypy (type checking)

### 2. Data ingestion layer

Three loaders, each with fallback logic.

**`/src/agents/quant/data/elo_loader.py`:**
- Scrape eloratings.net team pages
- Parse current Elo rating for each of our 48 teams
- Map eloratings.net team names to our short_names (alias map similar to Phase 1)
- Write to `teams.elo_rating` and `teams.elo_last_updated`
- Daily cadence at 3am MT
- Failure mode: log error, keep using cached value (max 7 days stale)

**`/src/agents/quant/data/transfermarkt_loader.py`:**
- Scrape Transfermarkt national team pages
- Parse total squad market value (EUR millions)
- Parse market value of starting XI when available (uses most recent national team match XI)
- Map team names to short_names
- Write to `teams.market_value_squad_eur_m`, `teams.market_value_xi_eur_m`, `teams.market_value_last_updated`
- Weekly cadence (Mondays at 4am MT)
- Failure mode: log error, keep cached value (max 30 days stale during tournament — market values change slowly)
- **Anti-bot considerations:** use realistic User-Agent, respect robots.txt, sleep 2-3 seconds between requests. If Cloudflare blocks, fall back to API-Football's team metadata.

**`/src/agents/quant/data/api_football_loader.py`:**
- Primary fallback for team stats (xG, rolling form, results)
- Endpoint base: `https://v3.football.api-sports.io`
- Required endpoints:
  - `/teams/statistics?league={WC_LEAGUE_ID}&season=2026&team={team_id}` — team-level tournament stats
  - `/fixtures?league={WC_LEAGUE_ID}&season=2026` — fixtures and results
  - `/predictions?fixture={fixture_id}` — their model's prediction (we don't use this directly, but capture for comparison)
- Authentication: `x-rapidapi-key` header
- Rate limit on entry tier: 100 requests/day. Budget aggressively.
- Cache responses for at least 6 hours
- Write team stats to `teams.rolling_8_match` (JSON), `teams.club_xg_aggregate` (JSON)

**Critical for all loaders:** every fetch logs to `agent_runs` with source, status, duration, records updated. If something stops working mid-tournament, we need to see it immediately.

### 3. The composite rating system

Implement `/src/agents/quant/model/composite_rating.py`:

Per the spec, blend three signals:
- 45% weight: Elo rating
- 30% weight: Player market values (log-scaled to normalize)
- 25% weight: Club xG aggregate

Each signal converted to z-score against the World Cup field (the 48 teams), then weighted, then mapped to attack and defense ratings.

```python
def compute_composite_rating(team: Team, field_stats: FieldStats) -> CompositeRating:
    elo_z = (team.elo - field_stats.elo_mean) / field_stats.elo_stddev
    
    market_value_log = math.log(max(team.market_value_squad_eur_m, 1.0))
    market_value_z = (market_value_log - field_stats.market_value_log_mean) / field_stats.market_value_log_stddev
    
    # Club xG handling - some teams have minimal club data (small federations)
    if team.club_xg_aggregate is None or team.club_xg_aggregate.get('weighted_minutes', 0) < 1000:
        # Low data scenario: rely more on Elo + market value
        composite_z = 0.55 * elo_z + 0.45 * market_value_z
    else:
        xg_z = compute_xg_z(team.club_xg_aggregate, field_stats)
        composite_z = 0.45 * elo_z + 0.30 * market_value_z + 0.25 * xg_z
    
    return CompositeRating(
        composite_z=composite_z,
        attack_rating=composite_z_to_attack(composite_z),
        defense_rating=composite_z_to_defense(composite_z),
        elo_z=elo_z,
        market_value_z=market_value_z,
        xg_z=xg_z if club_xg_present else None
    )
```

Write computed ratings to `teams.attack_rating`, `teams.defense_rating`, `teams.composite_z`.

Refresh ratings nightly via cron, plus immediately after any match completes (results update Elo, which cascades).

### 4. Bivariate Poisson with draw inflation

Implement `/src/agents/quant/model/bivariate_poisson.py`:

Per spec section "BIVARIATE POISSON IMPLEMENTATION":

```python
import numpy as np
from scipy import stats

def predict_match(
    home_team: TeamRating,
    away_team: TeamRating,
    venue: Venue,
    weather: WeatherInfo | None,
    field_stats: FieldStats,
    model_params: ModelParams
) -> MatchPrediction:
    
    # 1. Expected goals
    lambda_home = (
        home_team.attack_rating
        * (away_team.defense_rating / field_stats.defense_mean)
        * venue_factor(venue, home_team, away_team)
        * weather_factor(weather, 'home') if weather else 1.0
    )
    lambda_away = (
        away_team.attack_rating
        * (home_team.defense_rating / field_stats.defense_mean)
        * (1.0 / venue_factor(venue, home_team, away_team))
        * weather_factor(weather, 'away') if weather else 1.0
    )
    
    # Clip to reasonable range
    lambda_home = np.clip(lambda_home, 0.3, 4.5)
    lambda_away = np.clip(lambda_away, 0.3, 4.5)
    
    # 2. Build joint distribution
    max_goals = 7
    joint = np.zeros((max_goals + 1, max_goals + 1))
    correlation = model_params.goal_correlation  # ~0.08
    
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            p_h = stats.poisson.pmf(h, lambda_home)
            p_a = stats.poisson.pmf(a, lambda_away)
            joint[h, a] = p_h * p_a * (
                1 + correlation * 
                ((h - lambda_home) * (a - lambda_away)) / 
                (np.sqrt(lambda_home * lambda_away) + 0.01)
            )
    
    # 3. Apply draw inflation
    joint = apply_draw_inflation(joint, model_params.draw_inflation)  # default 1.18
    
    # Renormalize
    joint = joint / joint.sum()
    
    return derive_market_probabilities(joint, lambda_home, lambda_away)
```

### 5. Venue factor

Per spec, this is critical for World Cup. Implement `/src/agents/quant/model/venue_factor.py`:

```python
def venue_factor(venue: Venue, home_team: Team, away_team: Team) -> float:
    factor = 1.0
    
    # Host nation playing on home soil
    if is_host_nation_match(venue, home_team):
        if home_team.short_name == 'MEX' and venue.country == 'MX':
            factor *= 1.14
        elif home_team.short_name == 'USA' and venue.country == 'US':
            factor *= 1.09
        elif home_team.short_name == 'CAN' and venue.country == 'CA':
            factor *= 1.08
    
    # Altitude effects (Estadio Azteca, Estadio Akron)
    if venue.is_high_altitude:
        home_acclimated = is_acclimated_to_altitude(home_team, venue)
        away_acclimated = is_acclimated_to_altitude(away_team, venue)
        
        if venue.altitude_meters >= 2000:
            if home_acclimated and not away_acclimated:
                factor *= 1.06
            elif away_acclimated and not home_acclimated:
                factor *= 0.94
        elif venue.altitude_meters >= 1500:
            if home_acclimated and not away_acclimated:
                factor *= 1.03
            elif away_acclimated and not home_acclimated:
                factor *= 0.97
    
    # Neutral venue with travel asymmetry
    if not is_host_nation_match(venue, home_team) and not is_host_nation_match(venue, away_team):
        home_travel = haversine(home_team.home_base, venue.coords)
        away_travel = haversine(away_team.home_base, venue.coords)
        diff_km = away_travel - home_travel
        
        # 1% per 1000km, capped at 5%
        travel_advantage = min(0.05, abs(diff_km) / 100000)
        if diff_km > 0:
            factor *= (1.0 + travel_advantage)  # home traveled less
        else:
            factor *= (1.0 - travel_advantage)
    
    return factor
```

**Note:** team `home_base` coordinates aren't populated yet (they're nullable per Phase 0). For Phase 2a, use the capital city of each team's nation as a proxy. Add a helper that looks up coordinates per `confederation` and team `short_name`. We can refine these to actual training base locations in a later phase.

### 6. Draw inflation

`/src/agents/quant/model/draw_inflation.py`:

```python
def apply_draw_inflation(joint_dist: np.ndarray, inflation_factor: float = 1.18) -> np.ndarray:
    """
    International soccer draw rate is ~28-30%. Pure Bivariate Poisson predicts ~24%.
    Multiply diagonal probabilities by inflation factor, then renormalize.
    """
    inflated = joint_dist.copy()
    for n in range(joint_dist.shape[0]):
        inflated[n, n] *= inflation_factor
    return inflated / inflated.sum()
```

Inflation factor is recalibrated quarterly from rolling 200-match international data. In-tournament: recalibrate after Matchday 2 (32 matches available).

### 7. Market derivation

`/src/agents/quant/model/markets.py`:

From the joint distribution, derive every v1 market deterministically:

- Match outcome (1X2)
- Double chance (1X, X2, 12)
- Draw no bet
- Totals (over/under at 0.5, 1.5, 2.5, 3.5, 4.5)
- Asian handicap (-2.0 to +2.0 in 0.25 increments)
- BTTS
- Halftime/fulltime (uses 45% of total xG for HT lambdas)
- Halftime totals

Full implementation per spec section "MARKET DERIVATION" — pay special attention to Asian handicap quarter-line logic (half-stake split between adjacent half-lines).

### 8. Bootstrap confidence intervals

`/src/agents/quant/model/bootstrap.py`:

```python
def bootstrap_confidence(
    home_team: TeamRating, 
    away_team: TeamRating,
    venue: Venue,
    weather: WeatherInfo | None,
    field_stats: FieldStats,
    model_params: ModelParams,
    n_iterations: int = 1000
) -> ConfidenceInterval:
    """
    Resample team rating signals with noise scaled to underlying data quality.
    Re-run model. Report distribution.
    """
    home_win_samples = []
    draw_samples = []
    away_win_samples = []
    
    for _ in range(n_iterations):
        home_resampled = resample_team_rating(home_team)
        away_resampled = resample_team_rating(away_team)
        
        prediction = predict_match(home_resampled, away_resampled, venue, weather, field_stats, model_params)
        
        home_win_samples.append(prediction.match_outcome.home_win_prob)
        draw_samples.append(prediction.match_outcome.draw_prob)
        away_win_samples.append(prediction.match_outcome.away_win_prob)
    
    return ConfidenceInterval(
        home_win_ci_width=np.percentile(home_win_samples, 95) - np.percentile(home_win_samples, 5),
        draw_ci_width=np.percentile(draw_samples, 95) - np.percentile(draw_samples, 5),
        away_win_ci_width=np.percentile(away_win_samples, 95) - np.percentile(away_win_samples, 5),
        low_confidence_flag=any([
            np.percentile(home_win_samples, 95) - np.percentile(home_win_samples, 5) > 0.10,
            np.percentile(draw_samples, 95) - np.percentile(draw_samples, 5) > 0.10,
            np.percentile(away_win_samples, 95) - np.percentile(away_win_samples, 5) > 0.10,
        ])
    )
```

Seed RNG for reproducibility. Same inputs → same CI, always.

### 9. FastAPI service routes

`/src/agents/quant/api/routes.py`:

```python
@app.post("/predict")
async def predict(match_id: str, force_refresh: bool = False) -> MatchPrediction:
    """
    Compute prediction for a single match. Writes to model_predictions table.
    """
    # Load match, teams, venue from DB
    # Load weather if available
    # Compute composite ratings (use cached if < 24h, else refetch)
    # Run bivariate Poisson + draw inflation + market derivation + bootstrap
    # Write to model_predictions
    # Log to agent_runs
    # Return prediction

@app.post("/ratings/update")
async def update_ratings(date: str | None = None) -> RatingUpdateSummary:
    """
    Refresh all 48 team ratings using latest data sources.
    Triggered nightly by TypeScript cron.
    """

@app.post("/backtest")
async def run_backtest(tournament: str = "2022_world_cup") -> BacktestResult:
    """
    Run full backtest against historical tournament.
    Returns Brier score, calibration plot data, hypothetical CLV.
    """

@app.get("/health")
async def health() -> HealthStatus:
    """
    Service health: DB connection, last successful rating update, model version.
    """
```

All endpoints return pydantic models. All write operations atomic via DB transactions.

### 10. Backtest harness (THE GATE)

**This is the hard requirement.** No model predictions are shown in the UI until backtest passes.

`/src/agents/quant/calibration/backtest.py`:

```python
def run_backtest(tournament: str) -> BacktestResult:
    """
    Replay a historical tournament through the model.
    For each match: compute prediction using only data available BEFORE that match.
    Compare predictions to actual outcomes.
    Compute Brier score, calibration plot, hypothetical CLV vs Pinnacle closing.
    """
    matches = load_historical_tournament(tournament)  # 64 matches for 2022 Qatar
    
    predictions = []
    actuals = []
    
    for match in matches:
        # Use only data available BEFORE this match's kickoff
        snapshot_date = match.kickoff_date - timedelta(days=1)
        home_team_state = load_team_state_at(match.home_team_id, snapshot_date)
        away_team_state = load_team_state_at(match.away_team_id, snapshot_date)
        
        prediction = predict_match(home_team_state, away_team_state, match.venue, ...)
        actual = (match.home_score, match.away_score)
        
        predictions.append(prediction)
        actuals.append(actual)
    
    brier = compute_brier_score(predictions, actuals)
    clv = compute_hypothetical_clv(predictions, [m.pinnacle_closing for m in matches])
    
    return BacktestResult(
        tournament=tournament,
        n_matches=len(matches),
        brier_score=brier,
        median_clv_cents=clv.median,
        calibration_buckets=compute_calibration(predictions, actuals),
        passed=brier < 0.20 and clv.median >= 0
    )
```

**Backtest gate enforcement:**

The TypeScript orchestrator checks for a `model_versions` row with `backtest_passed=true` before displaying any model predictions in the UI. If no passing version exists, dashboard shows "Model not yet validated" instead of probabilities.

To run the backtest, you need 2022 Qatar data. Options:
- Download from football-data.co.uk (free CSV exports of historical matches)
- Use API-Football historical endpoints (counts against quota)
- Use kaggle datasets

Pick whichever is fastest. Cache the historical data locally — don't re-download every backtest run.

**If the backtest fails (Brier > 0.20):** do not panic, do not lower the threshold to pass. Investigate. The most likely cause is bad input data (wrong Elo ratings, missing market values). Fix the data, re-run. If the model is genuinely wrong, the right answer is to tune coefficients or change the venue factor, NOT to weaken the gate.

### 11. TypeScript orchestrator integration

In the existing TypeScript backend, add `/src/agents/orchestrator/quant_client.ts`:

```typescript
export class QuantClient {
  constructor(private baseUrl: string = process.env.QUANT_SERVICE_URL || 'http://localhost:8001') {}
  
  async predict(matchId: string): Promise<MatchPrediction> {
    const response = await fetch(`${this.baseUrl}/predict`, {
      method: 'POST',
      body: JSON.stringify({ match_id: matchId })
    });
    return MatchPredictionSchema.parse(await response.json());
  }
  
  async updateRatings(date?: string): Promise<RatingUpdateSummary> { /* ... */ }
  async runBacktest(tournament: string): Promise<BacktestResult> { /* ... */ }
  async checkHealth(): Promise<HealthStatus> { /* ... */ }
}
```

Validate Python service responses with zod (mirror the pydantic schemas). Never trust the response without validation.

### 12. Dashboard integration (CONDITIONAL ON BACKTEST PASS)

If backtest passed, update the slate view and match detail page to show Quant predictions alongside live odds.

Match detail page additions:

```
┌─────────────────────────────────────────────────────────────┐
│ THE QUANT'S READ                                             │
│  Model fair: ESP 28% / Draw 30% / CPV 42%                   │
│  Expected goals: ESP 0.8 / CPV 0.6                          │
│  CI width: ±8%                                              │
│  Inputs quality: 78/100 (low club xG data for CPV)         │
│  Model version: v1.0.0 · backtest Brier 0.187              │
└─────────────────────────────────────────────────────────────┘
```

**Do not show edge percentage yet.** That requires:
- Tactician adjustments (Phase 2b) — to get adjusted probability
- CEO synthesis (Phase 3) — to compare to market and gate on discipline

Phase 2a's dashboard contribution is the raw model output, clearly labeled as "model fair" probabilities. Operator can mentally compare to market prices but the system doesn't recommend bets yet.

If backtest hasn't passed: show "Model not yet validated — predictions hidden" in this section.

### 13. Agent runs and health checks

Every Quant operation logs to `agent_runs`:
- `agent: 'quant'`
- `match_id`: if applicable
- `run_phase`: 'predict' | 'rating_update' | 'backtest' | 'data_load_elo' | 'data_load_transfermarkt' | 'data_load_apifootball'
- `status`: success / failed_recoverable / failed_fatal
- `duration_ms`
- `outputs_summary`: structured info about what got computed/written

Update the `/health` endpoint to include Quant service status:

```json
{
  "checks": {
    "database": { ... },
    "wolfman": { ... },
    "quant_service": {
      "status": "ok",
      "url": "http://localhost:8001",
      "last_rating_update": "2026-06-13T03:14:00Z",
      "model_version": "v1.0.0",
      "backtest_passed": true,
      "backtest_brier": 0.187
    }
  }
}
```

If `backtest_passed: false`, health check still returns 200 (system is operational), but the field signals to the dashboard not to show model predictions.

## SCOPE BOUNDARIES — DO NOT BUILD THESE IN PHASE 2a

- ❌ The Tactician — that's Phase 2b
- ❌ Situational adjustments (rest days, motivation gap, etc.) — Phase 2b
- ❌ Lineup confirmation / cluster injuries — Phase 2b
- ❌ The CEO / STRIKE/PASS/WATCH verdicts — Phase 3
- ❌ Discipline gates — Phase 3
- ❌ Steam detection, sharp signals (full Wolfman LLM synthesis) — Phase 3
- ❌ Treasurer / Kelly sizing / CLV automation — Phase 4
- ❌ Player-level data — Phase 3
- ❌ Live in-play predictions — v2

If you find yourself wanting to build one of these, STOP and ask.

## TECHNICAL CONSTRAINTS

- Python 3.11+, type-hint everything, pass mypy strict
- TypeScript still strict, zero `any`
- All money still BigInt cents in TS
- UTC everywhere
- Drizzle ORM in TS, psycopg with explicit SQL in Python (no ORM in Python — keep it simple)
- pydantic v2 for Python schemas, zod for TS validation of Python responses
- Match existing patterns from Phase 0/1

## TESTING REQUIREMENTS

1. `npm run typecheck` + `mypy src/agents/quant` — zero errors
2. `npm run lint` + `ruff check src/agents/quant` — zero errors
3. `npm run test` (TypeScript) — all pass
4. `pytest src/agents/quant/tests/` — all pass, including:
   - Bivariate Poisson math validation (compare against known fixtures)
   - Draw inflation correctness
   - Venue factor calculations
   - Market derivation for all 8 v1 market types
   - Asian handicap quarter-line logic
   - Bootstrap reproducibility (same seed → same CI)
   - Data loader error handling (mock 500s, timeouts, malformed responses)
5. End-to-end: predict for one real upcoming WC match, verify it writes to `model_predictions`, verify TS client can parse the response
6. **Backtest passes:** Brier < 0.20 on 2022 Qatar World Cup out-of-sample

## PHASE 2a EXIT CRITERIA

1. Python FastAPI service deployed, accessible at `http://localhost:8001`
2. Both services running concurrently via Procfile or equivalent
3. Data loaders functional: Elo, Transfermarkt, API-Football
4. All 48 teams have populated `elo_rating`, `market_value_squad_eur_m`, `composite_z`, `attack_rating`, `defense_rating`
5. `predict` endpoint returning valid predictions for upcoming matches
6. `model_predictions` table receiving writes
7. Bootstrap CI computation working with reproducible seeds
8. **Backtest gate satisfied: Brier < 0.20 on 2022 Qatar**
9. `model_versions` table has a row with `backtest_passed=true`
10. Dashboard shows model probabilities on match detail page (only because backtest passed)
11. Health check includes Quant service status
12. Agent runs logged for every operation
13. All tests passing

## RULES OF ENGAGEMENT

- **Report drift first.** Before any code.
- **Backtest gate is non-negotiable.** Do not weaken the threshold to make it pass. If it fails, investigate the data first.
- **Don't expand scope.** No Tactician. No CEO. No verdicts.
- **Lean philosophy still applies.** Fetch data live from authoritative sources. Don't seed Elo or market values.
- **API quota awareness.** API-Football entry tier is 100 requests/day. Cache aggressively.
- **Anti-scraping defensiveness.** Use realistic User-Agents, respect robots.txt, sleep between requests, handle 403s gracefully.
- **Atomicity for DB writes.** Every prediction is a transaction. Don't leave half-written rows.
- **Validate every external response.** pydantic for Python, zod for TS. Never trust the wire.

## WHEN YOU'RE DONE

Report back:

1. One-paragraph summary
2. `npm run test` + `pytest` output
3. Output of `curl localhost:8001/health` and `curl localhost:3000/health`
4. Backtest result: Brier score, median CLV, calibration summary
5. Sample prediction for one upcoming match (curl `POST /predict`)
6. Number of teams with populated ratings (should be all 48)
7. API quota consumed for initial data load
8. Any spec deviations and why
9. TODOs for Phase 2b
10. Confirmation ready for Phase 2b (The Tactician)

Do NOT proceed to Phase 2b without my approval. The backtest gate must pass before any Tactician work begins — if the underlying Quant is wrong, layering Tactician adjustments on top makes the system worse, not better.

## CONTEXT

By the end of Phase 2a (target: 3-4 days from start), the system:
- Has a calibrated statistical model producing fair probabilities
- Shows model probabilities on the dashboard alongside market prices
- Lets the operator manually compare model vs market and make informed bets
- Has a backtest pedigree (Brier score visible on dashboard) so trust is earned, not assumed

Phase 2b (Tactician) then adds situational adjustments. Phase 3 (CEO) adds STRIKE/PASS/WATCH discipline gates. Phase 4 (Treasurer) adds automatic Kelly sizing and CLV tracking.

For Matchday 3 of group stage (June 22-25 — the highest-edge window), we need at minimum Phase 2a + 2b + 3 operational. That's tight but achievable if Phase 2a ships clean.

## START HERE

Inspect Phase 0 + Phase 1 implementation. Re-read `02_AGENT_QUANT.md`. Then reply with drift report and Phase 2a build plan before writing any code.
