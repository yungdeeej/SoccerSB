# 03 — THE TACTICIAN

## Situational Engine + Lineup Intel (Soccer)

**Model:** None — deterministic rules engine + light scraping (TypeScript)
**Type:** Multi-factor situational modifier with lineup confirmation
**Cadence:** T-24h initial, T-12h refresh, T-2h with confirmed XIs, T-30min final
**Owns tables:** `situational_adjustments`, `match_contexts` (lineup data)
**Estimated cost:** $0 (compute + light scraping)

---

## IDENTITY

You are **The Tactician**. You see what the math model can't see.

The Quant looks at team strength. You look at *whether the team can express that strength tonight*. Travel, fatigue, altitude, schedule density, weather, referees, motivation, set-piece efficiency, tactical matchups, cluster injuries — all the factors that move outcomes 2-12% but often aren't fully priced into the line.

You are deterministic where possible. Lineup confirmation requires scraping but no LLM judgment. Given the same inputs, you produce the same adjustments every time.

This is where the edge lives for soccer. Public lines partially price obvious factors (everyone knows about altitude, everyone knows about travel). Public lines rarely price the *combinations* — a team on game 3 of group stage with star striker out, against a team that already qualified and is rotating, at 35°C afternoon kickoff in Texas, with their key central midfielder coming off a 120-minute knockout match. That's a 5-9% adjustment the market routinely under-prices.

Your job is to find those gaps and quantify them.

---

## ELEVEN FACTOR CATEGORIES

The Tactician computes 11 categories of situational adjustment. Each is independent, calibrated, and capped. They combine additively up to a ±12% total cap.

### 1. Rest days

International soccer has FIFA's mandated 72-hour minimum rest between matches. Coaches and players consider 4+ days optimal. Differences matter.

| Rest difference | Adjustment to better-rested team |
|---|---|
| Equal rest | 0% |
| +1 day | +1.5% win probability |
| +2 days | +3.0% |
| +3 days | +4.5% (max practical in tournament) |

For matches where one team played 120 minutes (extra time) in their previous match:
- Add additional -1.5% penalty to fatigued team
- Add additional -1.0% if previous match went to penalty shootout (mental fatigue)

### 2. Travel & timezone burden

Soccer is more travel-sensitive than club leagues because national team players come from multiple clubs and time zones.

```typescript
function computeTravelAdjustment(team, venue) {
  const home_base_coords = team.recent_base_coords;  // training camp location
  const venue_coords = venue.coords;
  
  const distance_km = haversine(home_base_coords, venue_coords);
  const timezone_diff = Math.abs(venue.timezone_offset - team.base_timezone_offset);
  
  let adjustment = 0;
  
  // Travel distance
  if (distance_km > 8000) adjustment -= 0.03;
  else if (distance_km > 5000) adjustment -= 0.02;
  else if (distance_km > 2500) adjustment -= 0.01;
  
  // Timezone shifts
  if (timezone_diff >= 6) adjustment -= 0.025;
  else if (timezone_diff >= 4) adjustment -= 0.015;
  else if (timezone_diff >= 2) adjustment -= 0.005;
  
  // Acclimation: did the team arrive 4+ days in advance?
  if (team.days_at_venue >= 4) {
    adjustment *= 0.5;  // halve the penalty
  } else if (team.days_at_venue >= 2) {
    adjustment *= 0.75;
  }
  
  return adjustment;
}
```

### 3. Altitude effects (extending Quant base)

The Quant applies altitude in its venue factor. The Tactician adds more granular adjustments for partial acclimation and crossover effects.

| Venue | Base altitude | Acclimated bonus | Unacclimated penalty | Notes |
|---|---|---|---|---|
| Estadio Azteca | 2,240m | Already in Quant | Already in Quant | n/a |
| Akron (Guadalajara) | 1,550m | +1.5% (additive) | -1.5% | Smaller cousin of Azteca |
| BBVA (Monterrey) | 540m | 0 | 0 | Negligible |

The Tactician's additional contribution is for teams that have *partial* acclimation:
- Trained at altitude for 5-10 days: get half the acclimated bonus
- Played a match at altitude recently in qualifying: get 30% of acclimated bonus

### 4. Weather (heat, rain, wind)

The Quant handles weather in its lambda computation, but the Tactician handles tactical implications.

Weather affects more than xG:
- **Hot afternoon games (>32°C / 90°F):** teams that lack physical depth suffer more. Adjustment based on bench quality, not just expected goals
- **Wet field:** increased corners, fouls, and BTTS probability (passing breaks down, more set pieces)
- **High wind:** crosses and long balls disrupted — favors short-passing teams over direct teams

```typescript
function weatherTacticalAdjustment(weather, home, away) {
  if (weather.temp_c > 32) {
    // Heat favors deeper benches
    const home_depth = home.bench_quality_z;
    const away_depth = away.bench_quality_z;
    return {
      home_effect: 0.01 * (home_depth - away_depth),
      away_effect: -0.01 * (home_depth - away_depth)
    };
  }
  
  if (weather.is_heavy_rain) {
    // Wet conditions: small boost to physical/long-ball teams
    const home_style = home.style_directness_score;
    const away_style = away.style_directness_score;
    return {
      home_effect: 0.005 * (home_style - away_style),
      away_effect: 0,
      btts_adjustment: 0.02  // increased BTTS in wet conditions
    };
  }
  
  return { home_effect: 0, away_effect: 0 };
}
```

### 5. Motivation differential (Matchday 3 + knockouts)

Per Walters, this is the single most reliable edge in tournament soccer.

```typescript
function motivationAdjustment(home, away, tournament_stage, group_standings) {
  if (tournament_stage !== 'group_matchday_3') return { home: 0, away: 0 };
  
  const home_status = computeQualificationStatus(home, group_standings);
  const away_status = computeQualificationStatus(away, group_standings);
  
  // Statuses: 'guaranteed_first', 'guaranteed_advance', 'fighting', 'eliminated'
  
  if (home_status === 'fighting' && away_status === 'guaranteed_advance') {
    return { home: 0.05, away: -0.02 };  // motivation gap favors home
  }
  if (home_status === 'guaranteed_advance' && away_status === 'fighting') {
    return { home: -0.02, away: 0.05 };
  }
  if (home_status === 'fighting' && away_status === 'fighting') {
    return { home: 0, away: 0 };  // both motivated, no edge
  }
  if (home_status === 'guaranteed_first' && away_status === 'guaranteed_first') {
    return { home: 0, away: 0, ci_widening: 0.15 };  // both rotating, high variance
  }
  if (home_status === 'eliminated' && away_status === 'fighting') {
    return { home: 0, away: 0.03 };  // smaller edge — eliminated teams sometimes play with pride
  }
  
  return { home: 0, away: 0 };
}
```

In knockout rounds, motivation is universal — no adjustment needed.

### 6. Squad rotation prediction

Tied to motivation. Teams that have already qualified often rotate aggressively in Matchday 3. Teams that need to win rarely rotate.

Squad rotation reduces predicted strength below the model baseline.

```typescript
function squadRotationAdjustment(team, qualification_status) {
  if (qualification_status === 'guaranteed_first') {
    // High rotation expected (3-5 starters changed)
    return -0.04;  // team plays at ~96% of baseline strength
  }
  if (qualification_status === 'guaranteed_advance') {
    return -0.02;  // moderate rotation (1-3 starters)
  }
  // 'fighting' or 'eliminated_but_playing': no rotation expected
  return 0;
}
```

### 7. Tactical matchup

Some team styles are kryptonite for others.

Style dimensions tracked per team:
- **Press intensity** (high press / mid block / low block)
- **Possession orientation** (possession / direct / transition)
- **Defensive structure** (high line / mid block / deep block)
- **Set piece reliance** (heavy / moderate / light)

```typescript
function tacticalMatchupAdjustment(home, away) {
  let adjustment = { home: 0, away: 0 };
  
  // High-press team vs deep-block team
  // Press teams struggle when opponents commit fully behind ball
  if (home.press_intensity === 'high' && away.defensive_structure === 'deep_block') {
    adjustment.home -= 0.015;
    adjustment.away += 0.015;
  }
  
  // Direct attacking team vs high-line defense
  // Direct teams thrive against high lines
  if (home.possession_orientation === 'direct' && away.defensive_structure === 'high_line') {
    adjustment.home += 0.02;
    adjustment.away -= 0.02;
  }
  
  // Set-piece reliant team vs poor set-piece defender
  if (home.set_piece_reliance === 'heavy' && away.set_piece_defense_z < -0.5) {
    adjustment.home += 0.015;
  }
  
  // Possession team vs transition team (favors transition team in tournament soccer)
  if (home.possession_orientation === 'possession' && away.possession_orientation === 'transition') {
    adjustment.home -= 0.01;
    adjustment.away += 0.01;
  }
  
  return adjustment;
}
```

### 8. Set-piece efficiency

A significant percentage of international tournament goals come from set pieces. Teams with elite set-piece efficiency on either side of the ball get edge.

Track per team:
- `set_piece_goals_for_per_match` (rolling 20 matches)
- `set_piece_goals_against_per_match`
- `corner_conversion_rate`
- `defending_corner_conceded_rate`

Adjustment is small but real:
```typescript
function setPieceAdjustment(home, away) {
  const home_sp_edge = (home.set_piece_goals_for - away.set_piece_goals_against) / 2;
  const away_sp_edge = (away.set_piece_goals_for - home.set_piece_goals_against) / 2;
  
  return {
    home_xg_modifier: 0.5 * home_sp_edge,
    away_xg_modifier: 0.5 * away_sp_edge,
    // affects totals more than outcome
    totals_modifier: 0.3 * (home_sp_edge + away_sp_edge)
  };
}
```

### 9. Referee tendency

Like NHL, soccer referees vary. FIFA assigns referees ~2 days before each match.

Track per referee:
- `cards_per_match` (rolling 30 matches)
- `penalties_per_match`
- `added_time_avg_minutes`
- `home_team_card_rate` (subconscious bias)
- `var_intervention_rate`

When ref is assigned:

```typescript
function refereeAdjustment(referee, home, away) {
  const ref = lookupReferee(referee);
  if (!ref) return { home: 0, away: 0 };  // unknown referee
  
  let adjustment = { home: 0, away: 0, cards_total: 0, penalty_prob: 0 };
  
  // High-card referee
  if (ref.cards_per_match > 5.0) {
    // Teams with low discipline get penalized
    if (home.cards_per_match > 3.5) adjustment.home -= 0.01;
    if (away.cards_per_match > 3.5) adjustment.away -= 0.01;
    
    // Affects cards prop (deferred to v2)
    adjustment.cards_total = +1.5;
  }
  
  // Home-biased referee
  if (ref.home_team_card_rate < 0.40) {  // < 40% cards to home = home-biased
    adjustment.home += 0.01;
  }
  
  // High-penalty referee
  if (ref.penalties_per_match > 0.4) {
    adjustment.penalty_prob = +0.10;  // BTTS implications
  }
  
  return adjustment;
}
```

### 10. Cluster injury (per Walters exponentialization)

The Tactician owns lineup confirmation (absorbing the NHL Reader's role) and computes cluster scores.

```typescript
function computeClusterScore(team) {
  const absences = team.confirmed_absences;  // injured, suspended, ill
  
  let cluster_score = 0;
  
  // Position groups to track
  const groups = {
    starting_xi_attackers: absences.filter(a => a.role === 'CF' || a.role === 'LW' || a.role === 'RW'),
    starting_xi_midfield: absences.filter(a => a.role === 'CM' || a.role === 'DM' || a.role === 'AM'),
    starting_xi_defense: absences.filter(a => a.role === 'CB' || a.role === 'LB' || a.role === 'RB'),
    starting_xi_goalkeeper: absences.filter(a => a.role === 'GK')
  };
  
  // Score base impact
  for (const [group, missing] of Object.entries(groups)) {
    cluster_score += baseGroupImpact(group, missing.length);
  }
  
  // Apply exponential clustering for combinations (per Walters)
  if (groups.starting_xi_goalkeeper.length > 0 && groups.starting_xi_attackers.length > 0) {
    // Lost starting GK + lost top scorer: catastrophic
    cluster_score *= 1.5;
  }
  
  if (groups.starting_xi_defense.length >= 2) {
    // Lost 2+ defenders: severe (defensive structure compromised)
    cluster_score *= 1.4;
  }
  
  if (groups.starting_xi_midfield.length >= 2) {
    // Lost 2+ midfielders: severe (control of game compromised)
    cluster_score *= 1.3;
  }
  
  // Captain absence adds leadership factor
  if (absences.some(a => a.is_captain)) {
    cluster_score += 0.5;
  }
  
  return cluster_score;
}

function clusterImpactAdjustment(cluster_score) {
  if (cluster_score === 0) return 0;
  if (cluster_score < 1.5) return -0.01;
  if (cluster_score < 3) return -0.03;
  if (cluster_score < 5) return -0.06;
  if (cluster_score < 7) return -0.09;
  return -0.12;  // capped
}
```

### 11. Recent form / streaks

International teams have form, like clubs. Recent positive results matter, but should not over-weight (Elo already captures most of this).

```typescript
function recentFormAdjustment(team) {
  // Last 5 competitive results vs Elo expectation
  const expected_points = team.last_5.reduce((sum, m) => sum + m.expected_pts, 0);
  const actual_points = team.last_5.reduce((sum, m) => sum + m.actual_pts, 0);
  
  const delta = actual_points - expected_points;
  
  // Small momentum adjustment, capped to avoid over-weighting
  if (delta > 4) return +0.015;
  if (delta > 2) return +0.008;
  if (delta < -4) return -0.015;
  if (delta < -2) return -0.008;
  return 0;
}
```

---

## LINEUP CONFIRMATION (THE TACTICIAN'S READER ROLE)

The Tactician absorbs the NHL Reader's lineup confirmation function. For soccer this is simpler because soccer XIs are typically announced as a single block 60-90 min before kickoff.

### Sources (in priority order)

1. **Team official channels** (national federation Twitter/X, official websites)
2. **FIFA pre-match data** (official tournament feed)
3. **Beat reporter feeds** (configured per team)
4. **Sky Sports / ESPN pre-match coverage** (~75 min before kickoff)
5. **FBref live match feed**

### Confirmation states

```python
class XIStatus:
    PROJECTED = 'projected'        # T-24h to T-2h, based on press conferences and recent matches
    LEAKED = 'leaked'              # T-3h to T-90min, unofficial leak from beat reporter
    OFFICIALLY_CONFIRMED = 'confirmed'  # T-90min onwards, from official source
    KICKED_OFF = 'kicked_off'      # Used for post-match data
```

### Confidence score (similar to NHL Reader)

Start at 100. Deduct:
- -25 if home XI not confirmed at T-2h
- -25 if away XI not confirmed at T-2h
- -10 if any source contradicts official
- -10 per critical concern (max -30)
- -15 if multiple primary sources unreachable

CEO refuses to STRIKE on XI-dependent markets if confidence < 70.

---

## INPUTS

```typescript
interface TacticianInputs {
  match_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_kickoff_utc: string;
  current_time_utc: string;
  tournament_stage: string;
  venue_id: string;
  
  // From Quant
  raw_quant_predictions: QuantOutput;
  
  // From schedule data
  home_team_recent_schedule: Match[];  // last 14 days
  away_team_recent_schedule: Match[];
  home_team_upcoming_schedule: Match[];
  away_team_upcoming_schedule: Match[];
  
  // From group stage tracking
  group_standings: GroupStanding[] | null;  // null for knockout
  
  // From external sources
  referee_assignment: RefereeInfo | null;
  weather_conditions: WeatherInfo | null;
  
  // Team profile data
  home_team_profile: TeamProfile;
  away_team_profile: TeamProfile;
  
  // Lineup data (Tactician's own scraping)
  // These may be null at T-24h, partial at T-2h
  home_xi_status: XIStatus;
  away_xi_status: XIStatus;
  home_confirmed_xi: Player[] | null;
  away_confirmed_xi: Player[] | null;
  home_confirmed_absences: PlayerAbsence[];
  away_confirmed_absences: PlayerAbsence[];
  
  run_phase: 'T-24h' | 'T-12h' | 'T-2h' | 'T-30min';
}
```

---

## OUTPUTS

```typescript
interface TacticianOutput {
  match_id: string;
  computed_at: string;
  coefficient_version: string;
  
  // Lineup confirmation data (for CEO + dashboard)
  home_xi_status: XIStatus;
  away_xi_status: XIStatus;
  home_xi_confidence_score: number;
  away_xi_confidence_score: number;
  home_cluster_score: number;
  away_cluster_score: number;
  flagged_lineup_concerns: string[];
  
  // Probability adjustments
  raw_quant_probs: {
    home_win: number;
    draw: number;
    away_win: number;
  };
  adjusted_probs: {
    home_win: number;
    draw: number;
    away_win: number;
  };
  
  xg_modifiers: {
    home: number;
    away: number;
    totals_offset: number;  // applied to all over/under markets
  };
  
  factor_breakdown: {
    rest_days: FactorEffect;
    travel: FactorEffect;
    altitude: FactorEffect;
    weather: FactorEffect;
    motivation: FactorEffect;
    squad_rotation: FactorEffect;
    tactical_matchup: FactorEffect;
    set_piece: FactorEffect;
    referee: FactorEffect;
    cluster_injury: FactorEffect;
    recent_form: FactorEffect;
  };
  
  flags: string[];  // human-readable summary for CEO writeup
  total_adjustment_capped: boolean;
  combined_advantage_home: number;
  
  inputs_quality_score: number;  // 0-100
}
```

---

## ADJUSTMENT COMPOSITION

```typescript
function combineAdjustments(factors: FactorBreakdown): CombinedAdjustment {
  let home_total = 0;
  let away_total = 0;
  
  // Sum all factor effects
  for (const factor of Object.values(factors)) {
    home_total += factor.home_effect;
    away_total += factor.away_effect;
  }
  
  // Apply ±12% cap (slightly wider than NHL's 10% — soccer has bigger situational swings)
  const MAX = 0.12;
  
  const home_capped = Math.max(-MAX, Math.min(MAX, home_total));
  const away_capped = Math.max(-MAX, Math.min(MAX, away_total));
  
  return {
    home_total: home_capped,
    away_total: away_capped,
    capped: (home_capped !== home_total) || (away_capped !== away_total),
    net_advantage_home: home_capped - away_capped
  };
}
```

### Applying adjustments to Quant output

For three-way outcome markets, adjustments are applied to the win probability differential, then redistributed maintaining draw probability proportionally:

```typescript
function applyToQuant(quant: QuantOutput, adj: CombinedAdjustment): AdjustedPredictions {
  const raw_home = quant.predictions.match_outcome.home_win_prob;
  const raw_draw = quant.predictions.match_outcome.draw_prob;
  const raw_away = quant.predictions.match_outcome.away_win_prob;
  
  // Apply additive adjustment to home win probability
  let adj_home = raw_home + adj.net_advantage_home;
  let adj_away = raw_away - adj.net_advantage_home;
  let adj_draw = raw_draw;
  
  // Renormalize to maintain valid probabilities
  const total = adj_home + adj_draw + adj_away;
  adj_home = adj_home / total;
  adj_draw = adj_draw / total;
  adj_away = adj_away / total;
  
  // For totals: apply xG modifiers and recompute via lightweight Poisson grid
  const adjusted_xg_home = quant.expected_goals.home + adj.xg_modifiers.home;
  const adjusted_xg_away = quant.expected_goals.away + adj.xg_modifiers.away;
  const adjusted_totals = recomputeTotalsFromLambdas(adjusted_xg_home, adjusted_xg_away);
  
  // For Asian handicap: recompute from adjusted joint distribution
  const adjusted_ah = recomputeAsianHandicapFromLambdas(adjusted_xg_home, adjusted_xg_away);
  
  // For BTTS: directly adjusted
  const adj_btts = quant.predictions.both_teams_to_score.yes_prob + 
                    (adj.factor_breakdown.weather?.btts_adjustment || 0);
  
  return {
    adjusted_match_outcome: { home_win_prob: adj_home, draw_prob: adj_draw, away_win_prob: adj_away },
    adjusted_totals,
    adjusted_asian_handicap: adjusted_ah,
    adjusted_btts: { yes_prob: adj_btts, no_prob: 1 - adj_btts },
    // ... recompute all derivative markets
  };
}
```

---

## BEHAVIORAL RULES

1. **Deterministic.** Same inputs always produce same outputs. No randomness. No LLM. No "feel."

2. **Document every adjustment.** Every factor that applied gets recorded in `factor_breakdown`. The CEO must be able to see exactly why probabilities shifted.

3. **Cap aggressively.** Total adjustment cannot exceed ±12%. If your factors sum higher, something is wrong (or the situation is truly extraordinary — flag for manual review).

4. **Compound, don't average.** A team with multiple disadvantages should have those effects ADD UP. The market doesn't price the combination.

5. **Surface flags in plain language.** The CEO will format your flags into the Walters writeup. "Senegal on 3 days rest after 120-min knockout match" not "Senegal_rest_adj = -0.03".

6. **Never override the Quant.** You modify Quant's probabilities; you don't replace them. If your adjustments produce a probability >95% or <2%, something's wrong — flag it, don't ship it.

7. **Cluster injuries are exponential.** Multiple absences at related positions compound non-linearly. Apply the multiplier rules.

8. **Lineup confirmation is your responsibility.** When XIs are confirmed, update the relevant fields and recompute. CEO depends on this for STRIKE eligibility on XI-dependent markets.

9. **Motivation gap is the big one.** During group stage Matchday 3, this often produces the largest single-factor adjustments. Get this right.

10. **Tournament stage matters.** Some factors don't apply in knockout (motivation gap = universal). Adjust factor enabling per stage.

---

## CADENCE & TRIGGERS

### T-24h before match (initial computation)
- Pull all schedule data (rest days, recent matches, upcoming matches)
- Compute travel, altitude, weather (forecast), motivation, squad rotation prediction
- Project XIs from press conferences / recent matches
- Cluster injury score based on projected absences (often higher uncertainty)
- Write initial `situational_adjustments` row

### T-12h before match (refresh)
- Re-pull beat reporter feeds for any breaking news
- Refresh weather forecast
- Check for any updated XI signals
- Update row

### T-2h before match (primary)
- Pull confirmed XIs (typically available by now)
- Recompute cluster scores with actual confirmed absences
- Final referee crew check (assigned ~24-48h prior usually)
- Final weather check
- Write final `situational_adjustments` row

### T-30min before match (lock)
- Final confirmation pass
- Last-minute scratches caught
- This is the lock — no more updates

### Nightly 4:15am MT
- Pre-compute schedule density and travel for next 7 days of matches
- Refresh team late-game tendency stats from yesterday's matches

---

## FAILURE MODES

### Confirmed XIs not available by T-2h
- Continue with projected XIs
- Flag `xi_status = 'projected'`
- Confidence score deducted -25 per team
- CEO will likely PASS on XI-dependent markets

### Referee assignment not published
- Skip referee factor (set to 0 with `flag: 'referee_unknown'`)
- Continue with other factors
- CEO may PASS on referee-sensitive bets (e.g., heavy cards markets in v2)

### Weather API down
- Use historical seasonal averages for that location/date
- Flag `inputs_quality_score` lower
- Apply wider CI on totals markets

### Group standings not yet updated (Matchday 3 prediction at T-24h before MD3)
- Wait until MD2 completes
- Trigger reprocessing once standings settle

### Adjustment exceeds ±12% cap
- Cap it
- Flag as "extreme situational stack — manual review recommended"
- Add `total_adjustment_capped: true`

---

## WORKED EXAMPLES

### Example 1: Mexico vs Argentina at Estadio Azteca, group stage

**Inputs:**
- Both teams 4 days rest (equal)
- Argentina flew from Buenos Aires (~7,500 km), arrived 6 days prior
- Mexico in their home market
- Altitude 2,240m — handled by Quant
- Weather 18°C, calm
- Group stage matchday 2, both teams fighting for top spot
- Argentina healthy, Mexico missing top creative #10 (Lozano, cluster score 1.5)
- Referee: Slavko Vinčić, average tendency
- Tactical: Argentina possession-based (Scaloni), Mexico aggressive transition under their new coach

**Computation:**
```
Rest days: 0 (equal)
Travel: 
  Argentina: -2% (long flight, but 6 days acclimation reduces to -1%)
  Mexico: 0 (home)
Altitude: handled by Quant venue factor (already in baseline)
Weather: 0 (comfortable)
Motivation: 0 (both fighting)
Squad rotation: 0 (no qualification status)
Tactical matchup:
  Argentina possession vs Mexico transition: +1% to Mexico
Set piece: ~neutral
Referee Vinčić: neutral
Cluster injury:
  Mexico cluster 1.5: -1%
  Argentina cluster 0: 0
Recent form: 0 (both performing roughly to Elo)

Sum:
  Mexico: +1% (tactical) - 1% (cluster) = 0%
  Argentina: -1% (travel) = -1%

Net advantage Mexico: +1%
```

**Output:**
```json
{
  "adjusted_probs": {
    "home_win": 0.39,
    "draw": 0.30,
    "away_win": 0.31
  },
  "factor_breakdown": {
    "travel": {"home_effect": 0, "away_effect": -0.01, "away_distance_km": 7500, "away_acclimation_days": 6},
    "tactical_matchup": {"home_effect": 0.01, "away_effect": 0, "note": "Argentina possession vs Mexico transition"},
    "cluster_injury": {"home_effect": -0.01, "home_cluster_score": 1.5, "note": "Lozano (creative #10) out"}
  },
  "flags": [
    "Mexico missing creative #10 Lozano",
    "Argentina traveled 7,500km but acclimated 6 days",
    "Tactical edge slightly favors Mexico (transition vs possession)"
  ]
}
```

### Example 2: Matchday 3 motivation gap (the canonical edge)

**Inputs:**
- Brazil vs Cameroon, group stage Matchday 3
- Brazil already first in group (5 points, 4 GD), already advanced
- Cameroon at 0 points, must win to have chance at best 3rd place
- Rest days equal
- Brazil rotating starters (expected based on press conference)
- Cameroon naming strongest XI

**Computation:**
```
Motivation differential:
  Brazil status: 'guaranteed_first' (probably rotating heavily)
  Cameroon status: 'fighting' (must win)
  → -2% to Brazil, +5% to Cameroon

Squad rotation:
  Brazil (guaranteed_first): -4% (high rotation)
  Cameroon: 0%

Other factors mostly neutral.

Sum:
  Brazil: -2% - 4% = -6%
  Cameroon: +5%

Net advantage Cameroon: +11%
This is at the upper edge of the cap.
```

**Output:**
```json
{
  "adjusted_probs": {
    "home_win": 0.32,  // was 0.62 in baseline (Brazil heavily favored)
    "draw": 0.30,
    "away_win": 0.38
  },
  "factor_breakdown": {
    "motivation": {"home_effect": -0.02, "away_effect": 0.05, "note": "Brazil locked, Cameroon must-win"},
    "squad_rotation": {"home_effect": -0.04, "note": "Brazil expected to rotate 4-5 starters"}
  },
  "flags": [
    "CRITICAL: Motivation differential — Brazil already top of group, Cameroon must win",
    "Brazil press conference signaled heavy rotation",
    "This is the canonical Walters tournament edge: rotating favorite vs desperate underdog",
    "Combined adjustment near cap (±12%) — high-conviction situational call"
  ],
  "total_adjustment_capped": false,
  "combined_advantage_home": -0.11
}
```

This is exactly the kind of match where The Pitch earns its keep. Pre-tournament, public lines pricing Brazil heavily favored. Post-Matchday-1-and-2 with this rotation signal, sharp money should have moved the line significantly. If retail books haven't moved enough, that's the edge.

### Example 3: Knockout extra-time hangover

**Inputs:**
- Round of 16 winner played 120 minutes (extra time) + penalties to advance
- Their R16 opponent won in regulation 90 min, comfortable
- Both teams have 3 days rest
- Same venue
- No cluster injuries

**Computation:**
```
Rest days difference: 0 (both 3 days)
Extra time penalty for team that played 120 min: -1.5%
Penalty shootout mental fatigue: -1.0%

Sum:
  Team A (played 120+PSO): -2.5%
  Team B (won in 90): 0%

Net advantage Team B: +2.5%
```

This is a real and underpriced edge in tournament soccer. Public bettors often don't fully account for cumulative fatigue from a previous round's marathon match.

---

## TESTING CRITERIA

The Tactician is "working" when:

1. **Deterministic:** Same inputs → identical outputs, 100% of runs
2. **Backtest improvement:** Adjustments improve CLV by >0.3¢ vs unadjusted Quant predictions on 2022 World Cup backtest
3. **Coefficient stability:** Coefficients change <25% between recalibrations (large jumps indicate model fragility)
4. **Cap behavior:** Cap triggers <10% of matches (should be rare — most adjustments are modest)
5. **Edge detection:** On games with cluster score ≥5, adjustments are non-zero 100% of the time
6. **Motivation detection:** All Matchday 3 motivation gap scenarios correctly identified and adjusted in backtest
7. **Performance:** Single match computation completes in <800ms (slightly higher than NHL due to more factors)
8. **Lineup confirmation:** XI status correctly classified in 95%+ of test cases

---

## CONFIGURATION

### `/agents/tactician/config/coefficients.json`

(See spec for full structure. Versioned, validated with zod, recalibrated post-Matchday-3.)

### `/agents/tactician/config/team_profiles.json`

Tactical style profiles for all 48 teams:

```json
{
  "BRA": {
    "press_intensity": "mid_block",
    "possession_orientation": "possession",
    "defensive_structure": "mid_block",
    "set_piece_reliance": "moderate",
    "set_piece_goals_per_match": 0.35,
    "set_piece_defense_z": 0.2,
    "style_directness_score": 0.3,
    "bench_quality_z": 1.8
  },
  // ... all 48 teams
}
```

### `/agents/tactician/config/venue_data.json`

All 16 host city venues with coordinates, altitude, surface, capacity.

### `/agents/tactician/config/referees.json`

All FIFA-listed World Cup referees with rolling tendency stats.

---

## RELATED FILES

- `01_MASTER_ORCHESTRATION.md` — when Tactician runs
- `02_AGENT_QUANT.md` — provides raw probabilities that Tactician adjusts
- `05_AGENT_CEO.md` — primary consumer of Tactician adjustments
- `07_SHARED_CONTRACTS.md` — `situational_adjustments` and `match_contexts` schemas
