# 02 — THE QUANT

## Statistical Model Service (Soccer)

**Model:** None — pure deterministic math (Python FastAPI service)
**Type:** Bivariate Poisson with draw inflation; Elo + market value power ratings
**Cadence:** T-24h initial, T-12h refresh, T-2h with confirmed XIs, nightly ratings update at 3am MT
**Owns table:** `model_predictions`
**Estimated cost:** $0 (compute only)

---

## IDENTITY

You are **The Quant**. You compute fair probabilities for every World Cup match across every market using a calibrated statistical model. You have no LLM. You have no opinion. You have no narrative.

You are the only agent allowed to originate numbers in this system. Every other agent annotates or gates your output. The CEO can downgrade your conclusions but never upgrade them.

If your inputs are bad, your outputs are bad — and the entire system fails. Your job is to be deterministic, reproducible, and honestly calibrated. Better to output a wide confidence interval than a confident wrong answer.

For soccer specifically: the draw is a first-class outcome (25-30% base rate in international football). Your model must produce three probabilities for every match (home win, draw, away win), and every derived market must respect this.

---

## CORE MODEL

### Bivariate Poisson with Draw Inflation

For each match, predict goals scored by each team:

```
λ_home = α_home_attack × β_away_defense × γ_venue × δ_situational
λ_away = α_away_attack × β_home_defense × (1/γ_venue) × δ_situational
```

Where:
- `α` = team attacking power (rolling 8-match xG-based + Elo + market value blend)
- `β` = team defensive power (rolling 8-match xGA-based + Elo + market value blend)
- `γ` = venue advantage factor (host nation gets large boost; neutral venues weighted by travel)
- `δ` = situational factor placeholder (set to 1.0 here; the Tactician applies its adjustments downstream)

Then construct the joint score distribution via bivariate Poisson grid (0-7 goals per team), with a correlation parameter to account for game-flow dependency, plus a **draw inflation parameter** that adjusts diagonal probabilities upward to match observed draw rates.

From the joint distribution, derive all market probabilities deterministically.

---

## POWER RATING SYSTEM (THE KEY INNOVATION)

International soccer has a fundamental data problem: national teams play 8-12 competitive matches per year. Pure team-level rolling stats are unreliable.

**The Pitch's solution:** blend three signals with proven independent predictive value, following the PELE/SPI approach from FiveThirtyEight.

### Signal 1: Elo Rating (from eloratings.net)

Pure result-based rating, updated after every international match. Captures recent form and head-to-head difficulty.

- Source: eloratings.net (free, daily snapshots)
- Update cadence: nightly pull
- Scale: typically 1500-2200 (Elo standard)
- Captures: recent international results, opposition strength

### Signal 2: Player Market Values (from Transfermarkt)

Aggregate market value of the starting XI as a proxy for player quality. Elite club players cost more.

- Source: Transfermarkt team page
- Update cadence: weekly (changes slowly during tournament)
- Scale: total squad value in EUR millions (typically 50M-1500M)
- Captures: underlying talent that may not show in recent international results

### Signal 3: Club-Level xG Performance

For each starter, pull their last 20 club-level xG90 and xGA90 (for defenders). Aggregate weighted by minutes played for the national team.

- Source: FBref (free scrape)
- Update cadence: weekly during regular season; weekly during the tournament for any starter still active
- Captures: actual recent on-pitch performance

### Blending formula

```python
def compute_team_rating(team):
    # Normalize each signal to z-scores against the World Cup field
    elo_z = (team.elo - field.elo_mean) / field.elo_stddev
    market_value_z = (team.market_value_log - field.market_value_log_mean) / field.market_value_log_stddev
    xg_z = (team.club_xg_aggregate - field.club_xg_mean) / field.club_xg_stddev
    
    # Weighted blend (calibrated empirically; these are starting values)
    composite_z = (
        0.45 * elo_z +
        0.30 * market_value_z +
        0.25 * xg_z
    )
    
    return {
        'attack_rating': composite_z_to_attack(composite_z, team),
        'defense_rating': composite_z_to_defense(composite_z, team)
    }
```

### Special handling for teams with low recent data

- **Newly qualified nations** (e.g., never qualified before): rely 70% on player market values, 30% on Elo
- **Teams with major roster turnover** since last competitive match: weight market values higher
- **Teams playing primary stars who don't play for top European clubs**: increase weight on Elo to compensate

---

## VENUE FACTOR (CRITICAL FOR WORLD CUP)

Unlike NHL where home-ice is a small constant, World Cup venue dynamics are huge and matchup-specific.

### Host nation playing on home soil

| Scenario | Adjustment |
|---|---|
| Mexico playing in Mexico (e.g., Estadio Azteca, Guadalajara) | +14% win probability boost to Mexico |
| USA playing in any US venue | +9% win probability boost |
| Canada playing in any Canadian venue (BMO Field, BC Place) | +8% win probability boost |

These numbers are calibrated against historical World Cup performance of host nations and account for:
- Crowd advantage (massively in favor of host)
- Familiar conditions, climate, surface
- Zero travel/jet lag
- Referee subconscious bias (well-documented in international football)

### Neutral venue (most matches)

Both teams are technically away. Adjustments are based on **travel and acclimation**:

```python
def compute_neutral_venue_advantage(home_team, away_team, venue):
    """
    For matches not involving the host nation, compute relative
    travel/acclimation advantage.
    """
    home_travel_km = haversine(home_team.recent_base.coords, venue.coords)
    away_travel_km = haversine(away_team.recent_base.coords, venue.coords)
    
    # Each team that traveled less is at an advantage
    travel_diff_km = home_travel_km - away_travel_km
    
    if abs(travel_diff_km) < 500:
        return 1.0  # no meaningful difference
    
    # ~1% boost per 1000km advantage (capped)
    travel_advantage = min(0.05, travel_diff_km / 100000)
    
    return 1.0 + travel_advantage if travel_diff_km < 0 else 1.0 - travel_advantage
```

### Altitude adjustments

Specific venues with altitude effects:

| Venue | Altitude | Adjustment |
|---|---|---|
| Estadio Azteca, Mexico City | 2,240m | +6% to acclimated team / -6% to sea-level visitor |
| BBVA Stadium, Monterrey | 540m | Negligible |
| Estadio Akron, Guadalajara | 1,550m | +3% to acclimated / -3% to visitor |
| BMO Field, Toronto | 76m | Negligible |
| BC Place, Vancouver | 5m | Negligible |
| Mile High / Empower (Denver, if used) | 1,610m | +3% acclimated / -3% visitor |

Acclimation rules:
- "Acclimated" = trained at or above 1,500m for 2+ weeks before the match
- "Sea-level visitor" = base elevation under 500m, no acclimation period

Mexico is the only team in the field genuinely acclimated to Mexico City altitude. Bolivia and Ecuador qualified, both have altitude experience. Spain and Argentina occasionally play at altitude in qualifiers.

### Outdoor weather (all World Cup venues are open-air)

Weather affects totals more than match outcome:

| Condition | Total goals adjustment |
|---|---|
| Hot daytime (>30°C / 86°F) | -0.25 to -0.40 expected goals (energy conservation) |
| Heavy rain | -0.20 expected goals |
| Light rain | -0.05 expected goals |
| Wind >25 km/h | -0.10 expected goals |
| Cold (<5°C / 41°F) | -0.10 expected goals |
| Comfortable (15-22°C / 59-72°F, calm) | baseline |

Weather adjustments are computed by the Quant if weather data is available at prediction time, otherwise passed to the Tactician.

---

## DRAW INFLATION PARAMETER

International soccer has a well-documented draw bias that pure Bivariate Poisson under-predicts. The Quant applies a draw inflation factor.

### Why this matters

Pure Bivariate Poisson predicts ~24% draws. Actual international draw rate is ~28-30%. Without correction, the model systematically over-prices win probability and under-prices the X (draw) bet.

### Implementation

```python
def apply_draw_inflation(joint_distribution, inflation_factor=1.18):
    """
    Multiply diagonal probabilities (where home_goals == away_goals) by 
    inflation factor, then renormalize.
    
    Empirically calibrated: 1.18 matches historical international draw rates.
    """
    inflated = joint_distribution.copy()
    
    for n in range(joint_distribution.shape[0]):
        inflated[n, n] *= inflation_factor
    
    # Renormalize
    inflated = inflated / inflated.sum()
    return inflated
```

### Recalibration

The inflation factor is recalibrated quarterly using rolling 200-match international data. During the World Cup itself, recalibration happens after Round of 32 (using the 88 matches by then).

---

## INPUTS

```python
class QuantInputs:
    match_id: str
    home_team_id: str
    away_team_id: str
    venue_id: str
    scheduled_kickoff_utc: str
    tournament_stage: str  # 'group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'
    
    home_team_stats: TeamStats
    away_team_stats: TeamStats
    venue_info: VenueInfo
    weather_forecast: WeatherInfo | None
    
    home_projected_xi: list[Player] | None  # available at T-24h projected
    away_projected_xi: list[Player] | None
    home_confirmed_xi: list[Player] | None  # available at T-2h
    away_confirmed_xi: list[Player] | None
```

### Team stats structure

```python
class TeamStats:
    team_id: str
    
    # Rating signals
    elo_rating: float
    elo_last_updated: str
    
    market_value_squad_eur_m: float
    market_value_starting_xi_eur_m: float  # if XI confirmed
    
    rolling_8_match: dict  # last 8 competitive internationals
    # {
    #   goals_for_per_match, goals_against_per_match,
    #   xg_for_per_match, xg_against_per_match,
    #   shots_for, shots_against, possession_avg
    # }
    
    club_xg_aggregate: dict  # weighted by minutes for starting XI
    # {
    #   xg90_attacking, xga90_defensive, weighted_minutes
    # }
    
    recent_form_score: float  # -1.0 to 1.0 based on last 5 matches results vs Elo expectation
    
    home_base_coords: tuple[float, float]  # for travel calculations
    altitude_acclimation_meters: int  # base camp altitude during prep
```

---

## OUTPUTS

The Quant writes to `model_predictions` and returns:

```python
class QuantOutput:
    match_id: str
    model_version: str
    predicted_at: str
    
    expected_goals: {
        'home': float,
        'away': float,
        'total': float,
        'correlation': float
    }
    
    predictions: {
        'match_outcome': {
            'home_win_prob': float,
            'draw_prob': float,
            'away_win_prob': float
        },
        
        'double_chance': {
            'home_or_draw': float,
            'away_or_draw': float,
            'home_or_away': float
        },
        
        'draw_no_bet': {
            'home_dnb_prob': float,  # excludes draws from sample
            'away_dnb_prob': float
        },
        
        'totals': {
            '0.5': {'over': float, 'under': float},
            '1.5': {'over': float, 'under': float},
            '2.5': {'over': float, 'under': float},
            '3.5': {'over': float, 'under': float},
            '4.5': {'over': float, 'under': float}
        },
        
        'asian_handicap': {
            '-2.0': {'home_covers': float, 'away_covers': float},
            '-1.75': {...}, '-1.5': {...}, '-1.25': {...},
            '-1.0': {...}, '-0.75': {...}, '-0.5': {...}, '-0.25': {...},
            '0': {...},
            '+0.25': {...}, '+0.5': {...}, '+0.75': {...},
            '+1.0': {...}, '+1.25': {...}, '+1.5': {...}, '+1.75': {...}, '+2.0': {...}
        },
        
        'both_teams_to_score': {
            'yes_prob': float,
            'no_prob': float
        },
        
        'halftime_fulltime': {
            'H/H': float, 'H/D': float, 'H/A': float,
            'D/H': float, 'D/D': float, 'D/A': float,
            'A/H': float, 'A/D': float, 'A/A': float
        },
        
        'halftime_totals': {
            '0.5': {'over': float, 'under': float},
            '1.5': {'over': float, 'under': float}
        }
    }
    
    confidence_interval: {
        'method': 'bootstrap',
        'iterations': int,
        'home_win_ci_width': float,
        'draw_ci_width': float,
        'away_win_ci_width': float,
        'low_confidence_flag': bool  # True if any CI width > 0.10
    }
    
    rating_components: {
        'home_elo_z': float,
        'home_market_value_z': float,
        'home_club_xg_z': float,
        'home_composite_z': float,
        'away_elo_z': float,
        'away_market_value_z': float,
        'away_club_xg_z': float,
        'away_composite_z': float,
        'venue_factor_applied': float
    }
    
    diagnostic: {
        'inputs_quality_score': int,  # 0-100
        'warnings': list[str],
        'xi_status': 'projected' | 'confirmed' | 'unknown'
    }
```

---

## BIVARIATE POISSON IMPLEMENTATION

```python
import numpy as np
from scipy import stats

def predict_match(home_stats, away_stats, venue_info, weather, model_params):
    
    # Step 1: Compute composite team ratings
    home_rating = compute_team_rating(home_stats)
    away_rating = compute_team_rating(away_stats)
    
    # Step 2: Compute expected goals for each team
    lambda_home = (
        home_rating.attack_rating
        * (away_rating.defense_rating / field.defense_mean)
        * venue_info.home_advantage_factor
        * weather_factor(weather, 'home')
    )
    
    lambda_away = (
        away_rating.attack_rating
        * (home_rating.defense_rating / field.defense_mean)
        * (1.0 / venue_info.home_advantage_factor)  # inverse for away
        * weather_factor(weather, 'away')
    )
    
    # Clip lambdas to reasonable range (preventing extreme tail blowups)
    lambda_home = max(0.3, min(4.5, lambda_home))
    lambda_away = max(0.3, min(4.5, lambda_away))
    
    # Step 3: Build joint distribution
    max_goals = 7
    joint_dist = np.zeros((max_goals + 1, max_goals + 1))
    
    correlation = model_params['goal_correlation']  # ~0.08 for soccer
    
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            p_h = stats.poisson.pmf(h, lambda_home)
            p_a = stats.poisson.pmf(a, lambda_away)
            
            # Add correlation
            joint_dist[h, a] = p_h * p_a * (
                1 + correlation * 
                ((h - lambda_home) * (a - lambda_away)) / 
                (np.sqrt(lambda_home * lambda_away) + 0.01)
            )
    
    # Step 4: Apply draw inflation
    joint_dist = apply_draw_inflation(joint_dist, model_params['draw_inflation'])
    
    # Step 5: Derive all market probabilities
    return derive_market_probabilities(joint_dist, lambda_home, lambda_away)


def derive_market_probabilities(joint_dist, lambda_home, lambda_away):
    """
    Compute every market we care about from the joint goal distribution.
    """
    
    # Match outcome (1X2)
    home_win = np.tril(joint_dist, k=-1).sum()
    away_win = np.triu(joint_dist, k=1).sum()
    draw = np.diag(joint_dist).sum()
    
    # Double chance
    home_or_draw = home_win + draw
    away_or_draw = away_win + draw
    home_or_away = home_win + away_win
    
    # Draw No Bet (excluding draws from sample)
    home_dnb = home_win / (home_win + away_win)
    away_dnb = away_win / (home_win + away_win)
    
    # Totals
    totals = {}
    for line in [0.5, 1.5, 2.5, 3.5, 4.5]:
        over = sum(joint_dist[h, a] for h in range(joint_dist.shape[0])
                                       for a in range(joint_dist.shape[1])
                                       if (h + a) > line)
        totals[str(line)] = {'over': over, 'under': 1 - over}
    
    # Asian Handicap (more complex due to quarter lines = half stake on each)
    ah = {}
    for line in np.arange(-2.0, 2.25, 0.25):
        ah[str(line)] = compute_asian_handicap_probs(joint_dist, line, lambda_home, lambda_away)
    
    # Both Teams to Score
    bts_yes = sum(joint_dist[h, a] for h in range(1, joint_dist.shape[0])
                                       for a in range(1, joint_dist.shape[1]))
    
    # Halftime/Fulltime — requires modeling first-half goals separately
    # Approximation: ~45% of goals in first half
    halftime_lambda_home = lambda_home * 0.45
    halftime_lambda_away = lambda_away * 0.45
    halftime_outcomes = compute_halftime_outcomes(halftime_lambda_home, halftime_lambda_away)
    
    return {
        'match_outcome': {'home_win_prob': home_win, 'draw_prob': draw, 'away_win_prob': away_win},
        'double_chance': {'home_or_draw': home_or_draw, 'away_or_draw': away_or_draw, 'home_or_away': home_or_away},
        'draw_no_bet': {'home_dnb_prob': home_dnb, 'away_dnb_prob': away_dnb},
        'totals': totals,
        'asian_handicap': ah,
        'both_teams_to_score': {'yes_prob': bts_yes, 'no_prob': 1 - bts_yes},
        'halftime_fulltime': halftime_outcomes
    }


def compute_asian_handicap_probs(joint_dist, line, lambda_home, lambda_away):
    """
    Asian handicap with quarter-line support.
    Lines of -1.0, +1.0 etc are single bets (push if exact).
    Lines of -0.25, +0.75 etc are quarter bets — half stake on -0 / -0.5 etc.
    """
    if line == int(line) or line * 2 == int(line * 2):
        # Whole or half line - single bet
        if line >= 0:
            home_covers = sum(joint_dist[h, a] for h in range(joint_dist.shape[0])
                                                  for a in range(joint_dist.shape[1])
                                                  if (h - a) > -line)
        else:
            home_covers = sum(joint_dist[h, a] for h in range(joint_dist.shape[0])
                                                  for a in range(joint_dist.shape[1])
                                                  if (h - a) > -line)
        return {'home_covers': home_covers, 'away_covers': 1 - home_covers}
    else:
        # Quarter line - split bet across two adjacent half lines
        # e.g., -0.75 = half on -0.5, half on -1.0
        lower = line - 0.25
        upper = line + 0.25
        lower_probs = compute_asian_handicap_probs(joint_dist, lower, lambda_home, lambda_away)
        upper_probs = compute_asian_handicap_probs(joint_dist, upper, lambda_home, lambda_away)
        return {
            'home_covers': (lower_probs['home_covers'] + upper_probs['home_covers']) / 2,
            'away_covers': (lower_probs['away_covers'] + upper_probs['away_covers']) / 2
        }
```

---

## BOOTSTRAP CONFIDENCE INTERVALS

The model has uncertainty. The Quant must quantify it.

```python
def bootstrap_confidence(home_stats, away_stats, n_iterations=1000):
    """
    Resample team rating signals with noise based on their underlying
    sample sizes. Re-run model. Report distribution of outcomes.
    """
    bootstrap_outcomes = {
        'home_win': [],
        'draw': [],
        'away_win': []
    }
    
    for _ in range(n_iterations):
        # Resample with noise scaled to confidence
        home_resampled = resample_team_with_noise(home_stats)
        away_resampled = resample_team_with_noise(away_stats)
        
        result = predict_match(home_resampled, away_resampled, ...)
        bootstrap_outcomes['home_win'].append(result['match_outcome']['home_win_prob'])
        bootstrap_outcomes['draw'].append(result['match_outcome']['draw_prob'])
        bootstrap_outcomes['away_win'].append(result['match_outcome']['away_win_prob'])
    
    return {
        'home_win_ci_width': np.percentile(bootstrap_outcomes['home_win'], 95) - np.percentile(bootstrap_outcomes['home_win'], 5),
        'draw_ci_width': np.percentile(bootstrap_outcomes['draw'], 95) - np.percentile(bootstrap_outcomes['draw'], 5),
        'away_win_ci_width': np.percentile(bootstrap_outcomes['away_win'], 95) - np.percentile(bootstrap_outcomes['away_win'], 5),
        'low_confidence_flag': any(width > 0.10 for width in [...])
    }
```

**Critical rule:** If any market CI width > 10%, set `low_confidence_flag = true`. CEO doubles the edge threshold for low-confidence predictions.

---

## CALIBRATION & VALIDATION

### Initial calibration (pre-tournament)

Train and validate on historical international football data:
1. **Train on 2014, 2018, 2022 World Cups + Euros 2016, 2020, 2024 + Copa America 2016, 2019, 2021, 2024**
2. **Validate on Nations League matches Q4 2024 + UEFA/CONMEBOL qualifying 2025**
3. **Required calibration metric: Brier score on 3-way outcome**
   - Target: Brier score < 0.20 on out-of-sample (lower is better)
   - Compare against Pinnacle's no-vig probabilities

### In-tournament recalibration

Soccer benefits from rapid in-tournament recalibration because the field is small and self-contained.

- After Matchday 1 (16 matches): light recalibration of venue factors
- After Matchday 2 (32 matches): recalibrate draw inflation parameter
- After Matchday 3 (48 matches): full calibration review, weight rolling tournament data
- After Round of 32: heavier weight on tournament-specific patterns

### Calibration metrics tracked

| Metric | Target | Action if breached |
|---|---|---|
| Brier score (3-way) | < 0.20 rolling 30-match | Investigate factor weights |
| Calibration plot deviation | < 5% per bucket | Recalibrate composite weights |
| Pinnacle agreement | Within ±3% on 90% of markets | Investigate model bias |
| Draw rate vs prediction | Within ±3% | Adjust draw inflation parameter |

---

## BEHAVIORAL RULES

1. **Never call an LLM.** This service is pure math. No Claude API. No Gemma. No GPT. Period.

2. **Inputs must be fresh.** Elo from last 24h, market values from last 7 days, club xG from last 14 days. If stale, refuse to predict.

3. **Confidence intervals are mandatory.** Never output a point estimate without CI.

4. **Draws are first-class.** Every market that doesn't explicitly exclude draws must account for them.

5. **Reproducibility.** Same inputs → same outputs, always. Seed random number generators in bootstrap. Log model_version with every prediction.

6. **Never modify outputs based on "feel."** If your math says home team has 33% win probability, you write 33%. The Tactician adjusts for situational factors. The CEO can downgrade. You do not pre-adjust.

7. **Lambda clipping.** Expected goals are clipped to [0.3, 4.5] range. Beyond this, model uncertainty exceeds calibrated bounds.

8. **Tournament stage awareness.** Knockout matches have different scoring dynamics (lower scoring on average, fewer goals in extra time per minute). Apply stage-specific adjustments.

9. **XI status matters.** Predictions with projected XIs flag `inputs_quality_score` lower than predictions with confirmed XIs. CEO can use this to defer betting until T-2h.

---

## CADENCE & TRIGGERS

### T-24h before match (initial baseline)
- Pull latest team stats (Elo, market values, club xG aggregate)
- Project XIs from beat reporter intelligence
- Compute prediction with projected starters
- Write to `model_predictions` table with `xi_status = 'projected'`

### T-12h before match (refresh)
- Re-pull beat reporter feeds for any breaking news
- Recompute if any starter change projected
- Write new row (don't mutate)

### T-2h before match (with confirmed XIs)
- XIs typically announced 60-90 min before kickoff
- Recompute with confirmed XIs once available
- Set `xi_status = 'confirmed'`
- This is the prediction the CEO uses for primary verdict

### Nightly 3am MT (ratings update)
- Pull yesterday's match results
- Update Elo using standard formula (K=32 for World Cup matches per eloratings.net convention)
- Refresh rolling 8-match team stats
- Recompute league averages
- Log to `model_versions` if any parameter shift

### Post-Matchday recalibration (manual trigger or scheduled)
- After Matchdays 1, 2, 3 of group stage
- After completion of Round of 32
- Full re-fit of venue factors, draw inflation, composite weights
- Manual review before deploying new coefficients

---

## FAILURE MODES

### FBref data unreachable
- Fallback: alternative scrapers (worldfootball.net, sofascore)
- If all fail: use Elo + market values only (drop club xG signal, weight others higher)
- Flag `inputs_quality_score` down

### Elo ratings stale
- Use last cached version (max 48h)
- Beyond 48h: refuse to predict, return error

### Confirmed XIs not available by T-30min
- Use projected XIs
- Flag `xi_status = 'projected_late'`
- CEO will likely PASS on starter-dependent bets

### Bootstrap fails to converge
- Catch, log full stack trace
- Return prediction with `low_confidence_flag = true` and CI widths set to 0.20 (max)

### Model version mismatch
- If `current_model_version` doesn't match deployed code: refuse to predict
- Force manual investigation

---

## WORKED EXAMPLES

### Example 1: Group stage, standard match

**Inputs:**
- France vs Senegal, June 16, MetLife Stadium (neutral)
- France: Elo 2050, market value €1,150M, rolling xG 2.1
- Senegal: Elo 1810, market value €280M, rolling xG 1.4
- Venue: MetLife (neutral, both teams ~6,000km travel)
- Weather: 22°C, sunny, light wind

**Computation:**
```
Composite ratings:
  France: composite_z = +1.85 (very strong)
  Senegal: composite_z = +0.42 (above average)

Expected goals:
  λ_france = 2.1 × (Senegal_def/league_avg) × 1.0 × 1.0 = 2.3
  λ_senegal = 1.4 × (France_def/league_avg) × 1.0 × 1.0 = 0.95

Joint distribution computed, draw inflation applied (1.18).

Outcomes:
  France win: 64.2%
  Draw: 22.8%
  Senegal win: 13.0%
```

**Output (truncated):**
```json
{
  "expected_goals": {"home": 2.3, "away": 0.95, "total": 3.25},
  "predictions": {
    "match_outcome": {"home_win_prob": 0.642, "draw_prob": 0.228, "away_win_prob": 0.130},
    "totals": {
      "2.5": {"over": 0.61, "under": 0.39},
      "3.5": {"over": 0.38, "under": 0.62}
    },
    "asian_handicap": {
      "-1.0": {"home_covers": 0.49, "away_covers": 0.51},
      "-1.5": {"home_covers": 0.38, "away_covers": 0.62}
    },
    "both_teams_to_score": {"yes_prob": 0.45, "no_prob": 0.55}
  },
  "confidence_interval": {
    "home_win_ci_width": 0.07,
    "low_confidence_flag": false
  }
}
```

### Example 2: Host nation at altitude

**Inputs:**
- Mexico vs Argentina, group stage, Estadio Azteca, Mexico City
- Mexico: Elo 1820, market value €310M, fully acclimated to altitude
- Argentina: Elo 2120, market value €820M, sea-level base
- Venue: Azteca (Mexico home + 2,240m altitude)

**Computation:**
```
Composite ratings:
  Mexico: composite_z = +0.55
  Argentina: composite_z = +1.95 (would normally dominate)

Venue factor:
  Host nation Mexico: +14% advantage
  Altitude penalty for Argentina (no acclimation): -6%
  Combined: ~20% swing to Mexico from venue

Expected goals (with venue):
  λ_mexico = 1.8 (boosted by venue)
  λ_argentina = 1.6 (suppressed by altitude)

Outcomes (after draw inflation):
  Mexico win: 38%
  Draw: 30%
  Argentina win: 32%
```

Without venue/altitude effects, Argentina would win ~58% of matches against Mexico. The venue factor genuinely closes the gap to near coin-flip. This is the kind of edge international soccer betting can exploit when models account for it and books don't.

### Example 3: Cluster injury scenario

**Inputs:**
- England vs Croatia, knockout
- England missing starting goalkeeper + captain (Maguire, both top-pair CB equivalent)
- Croatia healthy
- Pre-cluster: England favored 55/22/23

**What Quant does:**
- Recompute England starting XI ratings with backups
- Backup GK rating significantly lower (-0.4 z on defense)
- Backup CB rating lower (-0.3 z on defense)
- Cluster effect: both absences at related positions → exponential penalty applied by Tactician downstream

**Quant output:** baseline probabilities updated with backup XI ratings.
**Tactician will then add:** cluster-injury exponential adjustment on top.

This is how the agents stack: Quant computes baseline with whatever XI is available, Tactician applies the situational layer including injury cluster exponentialization.

---

## TESTING CRITERIA

The Quant is "working" when:

1. **Deterministic:** Same inputs produce identical outputs across 100 runs
2. **Calibration:** Brier score < 0.20 on out-of-sample 2024 qualifier set
3. **Backtest CLV:** Hypothetical bets using Quant predictions show positive CLV vs closing lines on 2022 World Cup backtest
4. **Performance:** Single match prediction completes in <3 seconds (including bootstrap)
5. **Robustness:** No crashes on 1000 simulated edge-case matches (missing data, extreme values, etc.)
6. **Draw calibration:** Predicted draw rate within ±3% of actual draw rate on training data

### Backtest requirement before live mode

Before any real bets are placed on World Cup matches:

1. Run model on 2022 Qatar World Cup full tournament (64 matches)
2. For each match, compute model prediction vs actual closing line
3. Calculate hypothetical CLV
4. **Required threshold: median CLV ≥ 0¢ across 64 matches** (note: this is lower than NHL because soccer markets are sharper; positive CLV is itself a win)

If model fails this gate: do not proceed to live mode. Retune coefficients.

---

## PYTHON SERVICE ARCHITECTURE

```
/agents/quant/
├── main.py                    # FastAPI app
├── model/
│   ├── bivariate_poisson.py
│   ├── draw_inflation.py
│   ├── venue_factor.py
│   ├── composite_rating.py
│   └── bootstrap.py
├── data/
│   ├── elo_loader.py
│   ├── transfermarkt_loader.py
│   ├── fbref_loader.py
│   └── weather_loader.py
├── markets/
│   ├── match_outcome.py
│   ├── totals.py
│   ├── asian_handicap.py
│   ├── btts.py
│   └── halftime_fulltime.py
├── calibration/
│   ├── post_matchday_recal.py
│   ├── draw_inflation_calibrate.py
│   └── validation.py
├── api/
│   ├── predict.py
│   ├── ratings.py
│   └── health.py
└── tests/
    ├── test_model.py
    ├── test_markets.py
    └── test_backtest.py
```

### API endpoints

```
POST /predict
  Body: { match_id: string }
  Returns: QuantOutput (writes to DB, also returns)

GET /ratings/{team_id}
  Returns current composite rating components

POST /ratings/update
  Body: { date: 'YYYY-MM-DD' }
  Runs Elo update for all teams using matches on that date

POST /backtest
  Body: { tournament: '2022_world_cup' }
  Runs full backtest, returns CLV and Brier score

POST /calibration/recalibrate
  Body: { trigger: 'matchday_1' | 'matchday_2' | 'matchday_3' | 'post_r32' }
  Triggers re-fitting of model parameters
```

---

## CONFIGURATION

### `/agents/quant/config/model_params.yaml`

```yaml
model_version: "1.0.0"

bivariate_poisson:
  goal_correlation: 0.08         # game-flow dependency
  max_goals_grid: 7              # smaller than NHL because soccer is lower-scoring
  
draw_inflation:
  factor: 1.18                   # empirically calibrated
  recalibrate_after_matches: 32

composite_rating:
  elo_weight: 0.45
  market_value_weight: 0.30
  club_xg_weight: 0.25
  
  # Special case weights for low-data teams
  low_data_elo_weight: 0.30
  low_data_market_value_weight: 0.70
  low_data_club_xg_weight: 0.00

venue_factor:
  host_mexico_boost: 0.14
  host_usa_boost: 0.09
  host_canada_boost: 0.08
  altitude_2000plus_acclimated_boost: 0.06
  altitude_2000plus_unacclimated_penalty: 0.06
  altitude_1500_2000_acclimated_boost: 0.03
  altitude_1500_2000_unacclimated_penalty: 0.03
  travel_advantage_per_1000km: 0.01
  travel_advantage_cap: 0.05

weather_xg_modifier:
  hot_above_30c: -0.30
  hot_25_30c: -0.10
  comfortable: 0.0
  cold_below_5c: -0.10
  heavy_rain: -0.20
  light_rain: -0.05
  high_wind_above_25kph: -0.10

bootstrap:
  iterations: 1000
  ci_width_threshold: 0.10       # above this → low_confidence_flag

calibration:
  brier_target: 0.20
  validation_window_matches: 30

lambda_bounds:
  min: 0.3
  max: 4.5

tournament_stage_adjustments:
  group: 1.00              # baseline
  r32: 0.95                # slightly more cautious (less data on format)
  r16: 1.00
  qf: 1.00
  sf: 0.92                 # historically lower-scoring
  final: 0.90              # historically lowest-scoring
```

---

## RELATED FILES

- `01_MASTER_ORCHESTRATION.md` — when Quant runs
- `03_AGENT_TACTICIAN.md` — applies adjustments to Quant output
- `05_AGENT_CEO.md` — consumes Quant predictions
- `07_SHARED_CONTRACTS.md` — `model_predictions` schema, QuantOutput interface
