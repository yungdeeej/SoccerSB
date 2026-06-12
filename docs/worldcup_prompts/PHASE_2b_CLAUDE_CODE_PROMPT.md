# CLAUDE CODE — PHASE 2b EXECUTION PROMPT

## The Pitch — The Tactician (Situational Engine + Lineup Intel)

## Copy everything below this line into Claude Code

---

You are continuing the build of **The Pitch**. Phases 0, 1, and 2a are complete:

- Foundation laid (Phase 0)
- Market intelligence skeleton with live odds streaming (Phase 1)
- The Quant statistical model producing fair probabilities, backtest passed (Phase 2a)

Phase 2b is **The Tactician** — the situational engine that adjusts the Quant's pure-math probabilities for factors the math model can't see: rest days, travel, altitude (beyond the venue baseline), weather tactical impact, motivation differential, squad rotation patterns, tactical matchups, set-piece efficiency, referee tendencies, cluster injuries, and recent form.

This is where Walters' edge lives. The Quant tells us what *should* happen given team strength. The Tactician tells us whether the team is in a position to play to that strength tonight.

## YOUR FIRST ACTIONS — BEFORE WRITING CODE

1. Inspect actual Phase 0/1/2a implementation:
   - `/src/db/schema.ts` — exact column names for `situational_adjustments`, `match_contexts`, `matches`, `players`, `referees`
   - `/src/shared/utils/geo.ts` — haversine signature (you'll use this heavily)
   - `/src/agents/wolfman/` — existing TypeScript agent patterns
   - `/src/agents/quant/api/schemas.py` — exact shape of QuantOutput (you'll consume this)
   - `/src/agents/orchestrator/quant_client.ts` — how TS calls Quant (you'll mirror for Tactician)

2. Read `/docs/worldcup_prompts/03_AGENT_TACTICIAN.md` in full. This is your build spec.

3. Read `/docs/worldcup_prompts/00_WALTERS_FOR_SOCCER.md` — constitutional layer.

4. Skim `/docs/worldcup_prompts/05_AGENT_CEO.md` — you don't build this in 2b, but you need to know what the CEO will consume from the Tactician output.

5. **Report drift first.** Reply with:
   - Schema fields actually present vs spec
   - Quant output structure as actually built
   - Phase 2a patterns to follow (cron, error handling, agent_runs logging)
   - Your Phase 2b build plan

Wait for nothing — proceed after reporting.

## ARCHITECTURAL DECISION: TYPESCRIPT-ONLY

The Tactician is pure deterministic rules. No statistical math, no model calibration, no scientific Python needed. **Build it in TypeScript as part of the existing Node service.** No separate Python process.

This is intentional — keeps the Tactician fast (no inter-service HTTP), simple to deploy, and easy to debug. The Quant earned its Python separation because of scipy; the Tactician doesn't need anything beyond what TypeScript provides.

## CRITICAL — INHERIT THE LEAN PHILOSOPHY

Phases 0/1/2a established: DB stores structural facts and agent outputs. Dynamic data fetched live.

Phase 2b layers in:

**Fetched live (not seeded):**
- Squad lists / starting XI confirmations (from FIFA API + beat reporters)
- Referee assignments (from FIFA API, ~48h pre-match)
- Weather forecasts (from OpenWeather API)
- Recent match data for rest day calculations (already in `matches` table from Phase 1)

**Configured (slow-changing, safe to file):**
- Coefficient values for each factor (`coefficients.json`)
- Team tactical style profiles (`team_profiles.json`) — these populate from initial analysis then refresh weekly
- Team rivalries / heritage matchup pairs (`rivalries.json`)

**Written by The Tactician:**
- `situational_adjustments` table — every adjustment computation
- `match_contexts` table — lineup data per evaluation phase
- `agent_runs` — every run logged

**NEVER pre-seed:**
- Specific cluster injury scores
- Specific referee tendencies (fetched from API-Football)
- Specific player absences (fetched from FIFA/beat reporters)
- Specific motivation states (computed from current group standings)

## PHASE 2b DELIVERABLES

### 1. Configuration files

**`/src/agents/tactician/config/coefficients.json`** — all 11 factor categories with their coefficient values. Use exact values from `03_AGENT_TACTICIAN.md` section "FACTOR CATEGORIES."

```json
{
  "version": "1.0.0",
  "rest_days": {
    "equal": 0.0,
    "plus_1_day": 0.015,
    "plus_2_days": 0.030,
    "plus_3_days": 0.045,
    "extra_time_fatigue_penalty": -0.015,
    "penalty_shootout_mental_penalty": -0.010
  },
  "travel": {
    "distance_2500_5000_km": -0.01,
    "distance_5000_8000_km": -0.02,
    "distance_8000_plus_km": -0.03,
    "timezone_2_zones": -0.005,
    "timezone_4_zones": -0.015,
    "timezone_6_zones": -0.025,
    "acclimation_4_days_modifier": 0.5,
    "acclimation_2_days_modifier": 0.75
  },
  "altitude": {
    "akron_partial_acclimation_5_to_10_days": 0.5,
    "akron_recent_altitude_match_30_percent": 0.3
  },
  "weather": {
    "hot_above_32c_depth_multiplier": 0.01,
    "wet_directness_multiplier": 0.005,
    "wet_btts_adjustment": 0.02
  },
  "motivation": {
    "fighting_vs_guaranteed_advance_motivated_team": 0.05,
    "fighting_vs_guaranteed_advance_locked_team": -0.02,
    "eliminated_vs_fighting_motivated_team": 0.03,
    "both_guaranteed_first_ci_widening": 0.15
  },
  "squad_rotation": {
    "guaranteed_first": -0.04,
    "guaranteed_advance": -0.02
  },
  "tactical_matchup": {
    "press_vs_deep_block": -0.015,
    "direct_vs_high_line": 0.02,
    "set_piece_vs_poor_defender": 0.015,
    "possession_vs_transition": -0.01
  },
  "set_piece": {
    "xg_modifier_multiplier": 0.5,
    "totals_modifier_multiplier": 0.3
  },
  "referee": {
    "high_card_crew_threshold": 5.0,
    "low_discipline_team_threshold": 3.5,
    "high_card_low_discipline_penalty": -0.01,
    "home_bias_threshold": 0.40,
    "home_bias_bonus": 0.01,
    "high_penalty_threshold": 0.4,
    "high_penalty_btts_boost": 0.10
  },
  "cluster_injury": {
    "score_0_to_1.5": -0.01,
    "score_1.5_to_3": -0.03,
    "score_3_to_5": -0.06,
    "score_5_to_7": -0.09,
    "score_7_plus": -0.12,
    "goalkeeper_plus_attacker_multiplier": 1.5,
    "two_plus_defenders_multiplier": 1.4,
    "two_plus_midfielders_multiplier": 1.3,
    "captain_absence_addition": 0.5
  },
  "recent_form": {
    "delta_plus_4": 0.015,
    "delta_plus_2": 0.008,
    "delta_minus_2": -0.008,
    "delta_minus_4": -0.015
  },
  "global": {
    "max_total_adjustment": 0.12,
    "min_total_adjustment": -0.12
  }
}
```

Validate this file with zod at load time. If malformed, service refuses to start.

**`/src/agents/tactician/config/team_profiles.json`** — tactical style per team. For Phase 2b, seed with reasonable starting profiles for all 48 teams. These don't need to be perfect on day one — they refresh weekly based on observed play.

Default starter profiles per team. Use this template:

```json
{
  "BRA": {
    "press_intensity": "mid_block",
    "possession_orientation": "possession",
    "defensive_structure": "mid_block",
    "set_piece_reliance": "moderate",
    "style_directness_score": 0.3,
    "bench_quality_z": 1.8,
    "leads_protected_pct": 0.75
  },
  "ARG": {
    "press_intensity": "mid_block",
    "possession_orientation": "possession",
    "defensive_structure": "deep_block",
    "set_piece_reliance": "heavy",
    "style_directness_score": 0.25,
    "bench_quality_z": 1.6,
    "leads_protected_pct": 0.82
  },
  ...
}
```

**Important:** if you're not confident in a team's style profile, use neutral defaults rather than guessing:
```json
{
  "press_intensity": "mid_block",
  "possession_orientation": "transition",
  "defensive_structure": "mid_block",
  "set_piece_reliance": "moderate",
  "style_directness_score": 0.5,
  "bench_quality_z": 0.0,
  "leads_protected_pct": 0.78
}
```

Add a TODO comment for each placeholder team. We'll refine during the tournament.

**`/src/agents/tactician/config/rivalries.json`** — heritage rivalries that get extra intensity flag:

```json
{
  "battle_of_alberta": [],  // not in WC
  "regional_rivalries": [
    ["ARG", "BRA"],
    ["MEX", "USA"],
    ["ENG", "SCO"],
    ["NED", "GER"],
    ["FRA", "GER"],
    ["ESP", "POR"],
    ["KSA", "QAT"],
    ["KOR", "JPN"]
  ],
  "playoff_rematches": []  // populates as tournament progresses
}
```

### 2. Factor modules

Eleven factor categories, one TypeScript file per factor in `/src/agents/tactician/factors/`. Each module exports a single pure function that takes typed inputs and returns:

```typescript
interface FactorEffect {
  home_effect: number;          // additive adjustment to home win probability
  away_effect: number;
  xg_modifier_home?: number;    // additive to home xG (for totals adjustment)
  xg_modifier_away?: number;
  totals_modifier?: number;     // direct adjustment to over probability across all lines
  btts_modifier?: number;       // direct adjustment to BTTS yes probability
  ci_widening?: number;         // signal that this factor adds uncertainty
  metadata: Record<string, unknown>;
}
```

Modules to build:

**`rest_days.ts`** — Compares rest days between teams. Handles extra-time and penalty shootout fatigue from previous match.

**`travel.ts`** — Uses `haversineDistance` from `/src/shared/utils/geo.ts`. Computes travel distance from team's recent base to venue, applies coefficient. Accounts for acclimation days. Adjusts for timezone difference (use IANA timezone offsets from venues table).

**`altitude.ts`** — Layered on top of Quant's venue factor for partial acclimation cases. Most teams will get 0 here (Azteca/Akron handle in Quant). Module exists for edge cases like teams that trained at altitude for 5-10 days.

**`weather.ts`** — Reads weather forecast from OpenWeather API (fetched separately, cached in match_contexts). Returns tactical adjustments for hot weather (favors deeper benches), wet weather (favors physical/direct teams), wind (disrupts crosses/long balls).

**`motivation.ts`** — The big one. Reads `groups.json` for the match's group, computes current standings from completed matches in that group, classifies each team's qualification status, applies coefficient based on differential. Only fires for `group_matchday_3` tournament stage.

```typescript
type QualificationStatus = 
  | 'guaranteed_first'      // top of group locked
  | 'guaranteed_advance'    // mathematically through but not first
  | 'fighting'              // can advance with right result
  | 'eliminated_with_pride' // out but playing for pride/ranking points
  | 'eliminated';           // playing meaningless minutes

function classifyTeamStatus(team_id: string, group_letter: string, completed_matches: Match[]): QualificationStatus {
  // Build standings from completed matches
  // Run forward-projection of possible Matchday 3 outcomes
  // Determine team's qualification status
}
```

This is computationally non-trivial — group permutation analysis. Use a brute-force approach: simulate all possible Matchday 3 outcomes for the group, count which fraction lead to each team advancing.

**`squad_rotation.ts`** — Tied to motivation. Teams classified as `guaranteed_first` get -4% penalty (high expected rotation). `guaranteed_advance` gets -2%. Others get 0.

**`tactical_matchup.ts`** — Reads `team_profiles.json` for both teams. Computes style matchup effects per spec's matrix. Press vs deep block, direct vs high line, possession vs transition, set piece reliance vs poor defender.

**`set_piece.ts`** — Reads team set-piece stats (will populate from API-Football in Phase 2a's data layer). Computes net set-piece edge, applies as xG modifier and totals modifier.

**`referee.ts`** — Reads referee assignment from match (when available, ~48h pre-match). Looks up referee in `referees` table. Returns adjustments based on crew tendencies (cards, penalties, home bias).

If no referee assigned yet, returns null effect with `metadata: { reason: 'referee_unknown' }`. Tactician composition handles null gracefully.

**`cluster_injury.ts`** — Reads home/away absences from `match_contexts` (populated by the lineup confirmation flow, Section 3). Computes cluster score per spec's exponential rules. Applies bucketed adjustment.

```typescript
function computeClusterScore(absences: PlayerAbsence[]): number {
  let score = 0;
  
  const groups = {
    attackers: absences.filter(a => a.position_group === 'forward'),
    midfielders: absences.filter(a => a.position_group === 'midfielder'),
    defenders: absences.filter(a => a.position_group === 'defender'),
    goalkeepers: absences.filter(a => a.position_group === 'goalkeeper')
  };
  
  // Base impact per group
  score += baseGroupImpact('attackers', groups.attackers.length);
  score += baseGroupImpact('midfielders', groups.midfielders.length);
  score += baseGroupImpact('defenders', groups.defenders.length);
  score += baseGroupImpact('goalkeepers', groups.goalkeepers.length);
  
  // Exponential clustering per Walters
  if (groups.goalkeepers.length > 0 && groups.attackers.length > 0) {
    score *= 1.5;  // catastrophic combination
  }
  if (groups.defenders.length >= 2) {
    score *= 1.4;  // structural compromise
  }
  if (groups.midfielders.length >= 2) {
    score *= 1.3;  // control compromise
  }
  
  // Captain absence
  if (absences.some(a => a.is_captain)) {
    score += 0.5;
  }
  
  return score;
}
```

**`recent_form.ts`** — Compares team's last 5 results vs Elo expectation. Returns small momentum adjustment, capped.

Each factor module gets its own unit test file in `/tests/unit/tactician/factors/`. Test the coefficient is applied correctly for representative inputs.

### 3. Lineup confirmation (absorbs NHL Reader role)

`/src/agents/tactician/lineup.ts`:

Soccer XIs are typically announced ~60-90 min before kickoff via team official channels. This is much simpler than the NHL Reader because there's one announcement per team per match (vs NHL's multi-source goalie + scratches puzzle).

**Sources in priority order:**

1. **FIFA API** — official tournament feed, when available
2. **Team official channels** — national federation Twitter/X (handles in `beat_reporters.json` config — empty arrays from Phase 0 need populating now, see Section 8)
3. **API-Football fixture lineups endpoint** — `/fixtures/lineups?fixture={id}` (paid fallback)
4. **Beat reporter feeds** — secondary corroboration

**XI status enum:**
```typescript
type XIStatus = 'projected' | 'leaked' | 'confirmed';
```

- `projected`: T-24h to T-2h, based on press conferences and recent matches
- `leaked`: T-3h to T-90min, unofficial leak before official announcement
- `confirmed`: T-90min onwards, from official source

**Confidence score (0-100):** start at 100, deduct -25 per unconfirmed XI at T-2h, -10 per critical concern, -15 if multiple primary sources unreachable.

Write to `match_contexts` table on every evaluation pass:
- `home_xi_status`, `away_xi_status`, confidence scores
- `home_confirmed_xi`, `away_confirmed_xi` (JSON arrays of `{ player_id, position }`)
- `home_absences`, `away_absences` (JSON arrays of `{ player_id, reason, position_group, is_captain }`)
- `home_cluster_score`, `away_cluster_score`
- `beat_reporter_signals` (JSON)
- `flagged_concerns` (string[])

### 4. Composition engine

`/src/agents/tactician/compose.ts`:

Sum all factor effects, apply ±12% cap, renormalize:

```typescript
function combineAdjustments(factors: FactorBreakdown): CombinedAdjustment {
  let home_total = 0;
  let away_total = 0;
  let xg_home_total = 0;
  let xg_away_total = 0;
  let totals_modifier_sum = 0;
  let btts_modifier_sum = 0;
  
  for (const factor of Object.values(factors)) {
    home_total += factor.home_effect;
    away_total += factor.away_effect;
    xg_home_total += factor.xg_modifier_home || 0;
    xg_away_total += factor.xg_modifier_away || 0;
    totals_modifier_sum += factor.totals_modifier || 0;
    btts_modifier_sum += factor.btts_modifier || 0;
  }
  
  const MAX = 0.12;
  const home_capped = Math.max(-MAX, Math.min(MAX, home_total));
  const away_capped = Math.max(-MAX, Math.min(MAX, away_total));
  
  return {
    home_total: home_capped,
    away_total: away_capped,
    capped: (home_capped !== home_total) || (away_capped !== away_total),
    net_advantage_home: home_capped - away_capped,
    xg_modifiers: { home: xg_home_total, away: xg_away_total, totals_offset: totals_modifier_sum },
    btts_modifier: btts_modifier_sum
  };
}
```

### 5. Apply to Quant output

`/src/agents/tactician/apply.ts`:

Take a QuantOutput, apply the composition adjustments, return adjusted predictions for all markets:

```typescript
function applyToQuant(quant: QuantOutput, adj: CombinedAdjustment): AdjustedPredictions {
  // Three-way outcome — apply additive adjustment, renormalize
  const raw_home = quant.predictions.match_outcome.home_win_prob;
  const raw_draw = quant.predictions.match_outcome.draw_prob;
  const raw_away = quant.predictions.match_outcome.away_win_prob;
  
  let adj_home = raw_home + adj.net_advantage_home;
  let adj_away = raw_away - adj.net_advantage_home;
  let adj_draw = raw_draw;
  
  // Clip to valid range
  adj_home = Math.max(0.01, Math.min(0.98, adj_home));
  adj_away = Math.max(0.01, Math.min(0.98, adj_away));
  
  // Renormalize
  const sum = adj_home + adj_draw + adj_away;
  adj_home /= sum;
  adj_draw /= sum;
  adj_away /= sum;
  
  // Totals: apply xG modifiers and recompute via lightweight Poisson grid
  const adjusted_xg_home = quant.expected_goals.home + adj.xg_modifiers.home;
  const adjusted_xg_away = quant.expected_goals.away + adj.xg_modifiers.away;
  const adjusted_totals = recomputeTotalsFromLambdas(adjusted_xg_home, adjusted_xg_away);
  
  // Asian handicap: recompute from adjusted joint distribution
  const adjusted_ah = recomputeAsianHandicapFromLambdas(adjusted_xg_home, adjusted_xg_away);
  
  // BTTS: direct adjustment
  const adj_btts_yes = Math.max(0.01, Math.min(0.99, 
    quant.predictions.both_teams_to_score.yes_prob + (adj.btts_modifier || 0)
  ));
  
  // ... recompute every market
  
  return {
    adjusted_match_outcome: { home_win_prob: adj_home, draw_prob: adj_draw, away_win_prob: adj_away },
    adjusted_totals,
    adjusted_asian_handicap: adjusted_ah,
    adjusted_btts: { yes_prob: adj_btts_yes, no_prob: 1 - adj_btts_yes },
    adjusted_xg: { home: adjusted_xg_home, away: adjusted_xg_away }
  };
}
```

The lightweight Poisson grid for totals/AH recomputation: build a 7x7 grid using the adjusted lambdas, apply draw inflation, derive markets. This reuses logic that's already in the Python Quant — port it to TypeScript carefully (avoid divergence between the two implementations).

**Critical:** if adjusted probabilities clip extreme (>95% or <2%), something's wrong. Flag it, don't ship it. The Tactician should never produce probabilities the Quant wouldn't produce given reasonable input variations.

### 6. Main entry point

`/src/agents/tactician/index.ts`:

```typescript
export async function runTactician(inputs: TacticianInputs): Promise<TacticianOutput> {
  const startMs = Date.now();
  
  try {
    // 1. Fetch Quant output for this match (or run Quant if missing)
    const quantOutput = await getQuantOutput(inputs.match_id);
    
    // 2. Build context (rest days, travel, weather, referee, lineups)
    const context = await buildMatchContext(inputs);
    
    // 3. Run all 11 factor modules
    const factors = {
      rest_days: computeRestDays(context),
      travel: computeTravel(context),
      altitude: computeAltitude(context),
      weather: computeWeather(context),
      motivation: computeMotivation(context),
      squad_rotation: computeSquadRotation(context),
      tactical_matchup: computeTacticalMatchup(context),
      set_piece: computeSetPiece(context),
      referee: computeReferee(context),
      cluster_injury: computeClusterInjury(context),
      recent_form: computeRecentForm(context)
    };
    
    // 4. Compose
    const combined = combineAdjustments(factors);
    
    // 5. Apply to Quant output
    const adjusted = applyToQuant(quantOutput, combined);
    
    // 6. Build output
    const output: TacticianOutput = {
      match_id: inputs.match_id,
      computed_at: new Date().toISOString(),
      coefficient_version: getCoefficientVersion(),
      home_xi_status: context.home_xi_status,
      away_xi_status: context.away_xi_status,
      home_xi_confidence_score: context.home_xi_confidence_score,
      away_xi_confidence_score: context.away_xi_confidence_score,
      home_cluster_score: context.home_cluster_score,
      away_cluster_score: context.away_cluster_score,
      raw_quant_probs: quantOutput.predictions.match_outcome,
      adjusted_probs: adjusted.adjusted_match_outcome,
      xg_modifiers: combined.xg_modifiers,
      factor_breakdown: factors,
      flags: buildPlainLanguageFlags(factors, context),
      total_adjustment_capped: combined.capped,
      combined_advantage_home: combined.net_advantage_home,
      inputs_quality_score: computeInputsQualityScore(context),
      flagged_lineup_concerns: context.flagged_concerns
    };
    
    // 7. Write to situational_adjustments
    await writeSituationalAdjustment(output);
    
    // 8. Log to agent_runs
    await logAgentRun({
      agent: 'tactician',
      match_id: inputs.match_id,
      run_phase: inputs.run_phase,
      status: 'success',
      duration_ms: Date.now() - startMs,
      outputs_summary: { capped: combined.capped, net_advantage_home: combined.net_advantage_home }
    });
    
    return output;
  } catch (error) {
    await logAgentRun({
      agent: 'tactician',
      match_id: inputs.match_id,
      status: 'failed_recoverable',
      duration_ms: Date.now() - startMs,
      error_message: error.message,
      error_stack: error.stack
    });
    throw error;
  }
}
```

### 7. Cadence and orchestration

Tactician runs at four checkpoints per match: T-24h, T-12h, T-2h, T-30min.

Update the orchestrator (or cron, depending on Phase 1 patterns) to call `runTactician` at these times. Each run writes a new row to `situational_adjustments` (don't mutate existing rows).

**Lineup confirmation cadence is more frequent during the final 2 hours.** Schedule lineup polling separately at T-3h, T-2h, T-90min, T-60min, T-30min. The Tactician's primary computation can stay at the 4-checkpoint cadence, but lineup data refreshes more often.

### 8. Beat reporters config update

Phase 0 left `beat_reporters.json` with empty arrays. Phase 2b doesn't need to fully populate it — that's a manual data entry task — but the prompt should populate **at least the top 8-10 teams** with real beat reporter Twitter/X handles. These are publicly available:

```json
{
  "ARG": ["@gastonedul", "@martinmazur", "@manuetchevehere"],
  "BRA": ["@samirpcarvalho", "@PVC", "@LCSilva"],
  "FRA": ["@VincentDuluc", "@DanielRiolo"],
  "ENG": ["@HenryWinter", "@Sammy_Lee_Times", "@PaulHirstTimes"],
  "ESP": ["@guillemballague", "@samuelmarsden"],
  "GER": ["@hosenmatz", "@danblank88"],
  "POR": ["@miguelueli", "@PedroBenitez"],
  "NED": ["@MaartenWijffels", "@vivacatfish"],
  ...
}
```

For the remaining ~38 teams, add a TODO comment. We'll fill in as we encounter them in the tournament.

**Note:** The Tactician doesn't actually scrape Twitter in Phase 2b — that's a data ingestion problem we defer. The handles are stored for later use. For Phase 2b, beat reporter signals come from API-Football's lineup endpoint when available, with manual operator overrides via a dashboard form for cases where the API is wrong.

### 9. Dashboard integration

Update the match detail view to add a Tactician section between the Quant section and the market section:

```
┌─────────────────────────────────────────────────────────────┐
│ THE QUANT'S READ                                             │
│  Model fair: ESP 28% / Draw 30% / CPV 42%                   │
│  Expected goals: ESP 0.8 / CPV 0.6                          │
│  CI width: ±8%                                              │
├─────────────────────────────────────────────────────────────┤
│ THE TACTICIAN'S DELTA                              [T-2h]   │
│  XI status: ESP confirmed · CPV confirmed                    │
│  Cluster scores: ESP 0.0 · CPV 2.5                          │
│                                                              │
│  Factors firing:                                             │
│    motivation       +0.0% (both teams motivated)            │
│    travel           -0.5% to CPV (4500km from base)         │
│    rest_days        +1.5% to ESP (4 vs 3 days)             │
│    cluster_injury   -2.5% to CPV (top scorer + LB out)     │
│    tactical_matchup +1.0% to ESP (possession vs trans)     │
│                                                              │
│  Net advantage: +5.5% to ESP                                │
│  Adjusted: ESP 33% / Draw 29% / CPV 38%                    │
│  Capped: no                                                 │
└─────────────────────────────────────────────────────────────┘
```

Still no STRIKE/PASS/WATCH (that's Phase 3 / CEO).

### 10. Match context flow

Building `MatchContext` requires pulling from multiple sources:

```typescript
interface MatchContext {
  match: Match;
  home_team: Team;
  away_team: Team;
  venue: Venue;
  
  // Schedule data (from matches table)
  home_team_recent: Match[];   // last 14 days
  away_team_recent: Match[];
  
  // Group context (for motivation/squad rotation)
  group_letter: string | null;
  group_standings: GroupStanding[] | null;
  group_matchday_3_scenarios: QualificationScenario[] | null;
  
  // External data
  weather: WeatherForecast | null;     // OpenWeather API
  referee: Referee | null;              // from referees table when assigned
  
  // Lineup data (from match_contexts table, populated by lineup confirmation flow)
  home_xi_status: XIStatus;
  away_xi_status: XIStatus;
  home_xi_confidence_score: number;
  away_xi_confidence_score: number;
  home_confirmed_xi: Player[] | null;
  away_confirmed_xi: Player[] | null;
  home_absences: PlayerAbsence[];
  away_absences: PlayerAbsence[];
  home_cluster_score: number;
  away_cluster_score: number;
  flagged_concerns: string[];
}

async function buildMatchContext(inputs: TacticianInputs): Promise<MatchContext> {
  // Parallel fetches where possible
  const [match, homeRecent, awayRecent, weather, lineup] = await Promise.all([
    getMatch(inputs.match_id),
    getRecentMatchesForTeam(inputs.home_team_id, 14),
    getRecentMatchesForTeam(inputs.away_team_id, 14),
    getWeatherForecast(inputs.venue_id, inputs.scheduled_kickoff_utc),
    getMatchContext(inputs.match_id)  // lineup data from match_contexts table
  ]);
  
  // ... assemble
}
```

### 11. Failure modes

Per spec:

- **Confirmed XIs not available by T-2h:** continue with projected, confidence score deducted, CEO will later PASS on XI-dependent markets
- **Referee not assigned:** referee factor returns null effect, continue
- **Weather API down:** use historical seasonal average for that location/date
- **Group standings stale (Matchday 3 prediction at T-24h before MD2 complete):** wait until MD2 completes, trigger reprocessing
- **Adjustment exceeds ±12% cap:** cap it, flag as "extreme situational stack"

All failures log to `agent_runs`. Dashboard reflects degraded inputs (e.g., "Weather unavailable" instead of full forecast).

### 12. Health check update

Add Tactician status to `/health`:

```json
{
  "checks": {
    "database": { ... },
    "wolfman": { ... },
    "quant_service": { ... },
    "tactician": {
      "status": "ok",
      "coefficient_version": "1.0.0",
      "last_run": "2026-06-13T14:32:00Z",
      "last_run_match": "ESP vs CPV",
      "last_run_status": "success"
    }
  }
}
```

## SCOPE BOUNDARIES — DO NOT BUILD IN PHASE 2b

- ❌ The CEO / STRIKE/PASS/WATCH verdicts — Phase 3
- ❌ Discipline gates — Phase 3
- ❌ LLM synthesis (Walters voice writeup) — Phase 3
- ❌ Star rating computation — Phase 3
- ❌ Treasurer / Kelly stake recommendations — Phase 4
- ❌ Automatic CLV computation — Phase 4
- ❌ Steam detection, sharp signals (full Wolfman LLM synthesis) — Phase 3
- ❌ Twitter/X scraping — defer to v2

If you find yourself wanting to build one of these, STOP and ask.

## TECHNICAL CONSTRAINTS

- TypeScript strict mode, zero `any`
- Money as BigInt cents (no Tactician outputs are monetary, but stay consistent with project)
- UTC in storage, MT for display
- Drizzle ORM, zod validation
- Factor modules are pure functions — no DB calls inside them, no async, no side effects. Inputs in, FactorEffect out. This makes them trivially testable.
- The composition engine and orchestrator handle async (fetching context, writing to DB)
- Coefficient values from `coefficients.json` loaded once at startup, refreshed only on file change

## TESTING REQUIREMENTS

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero errors
3. `npm run test` — all unit tests pass, including:
   - Each factor module tested with representative inputs (11 modules × 3-5 cases each = 35-55 tests)
   - Composition engine cap logic
   - Adjustment composition determinism (same inputs → same output)
   - `applyToQuant` correctly renormalizes
   - Cluster score exponentiation correctness
   - Group standings classification (build mock group data, verify status assignment)
4. Integration tests:
   - End-to-end: pick a real upcoming match, run Tactician, verify it writes to DB and returns valid output
   - Coefficient version mismatch behavior
   - Failure paths: missing weather, missing referee, missing lineup

## PHASE 2b EXIT CRITERIA

1. All 11 factor modules implemented with passing unit tests
2. Composition engine with ±12% cap working
3. `applyToQuant` correctly transforms QuantOutput → AdjustedPredictions
4. Lineup confirmation flow populates `match_contexts` table
5. Main entry point `runTactician()` executes end-to-end on real match
6. Tactician runs at all 4 checkpoints (T-24h, T-12h, T-2h, T-30min)
7. Dashboard shows Tactician section on match detail page with adjusted probabilities
8. `situational_adjustments` table receiving writes
9. Health check includes Tactician status
10. Agent runs logged for every Tactician execution
11. All tests passing
12. Coefficient and team profile configs validated at startup

## RULES OF ENGAGEMENT

- **Report drift first.** Always.
- **Factor modules are pure functions.** No async, no DB, no side effects. This is critical for testability.
- **Don't expand scope.** No CEO. No verdicts. No LLM.
- **Lean philosophy still applies.** Fetch lineup data live. Don't pre-seed cluster scores or referee tendencies.
- **The ±12% cap is sacred.** Don't quietly allow larger adjustments. If factors sum higher, cap, flag, surface to operator.
- **Validate inputs at every boundary.** zod for JSON configs, zod for Quant output before consumption.
- **Reuse the Quant's Poisson math via port, not copy-paste.** If you need to recompute totals/AH from adjusted lambdas in TypeScript, port the Python logic carefully and add a test that compares Python vs TypeScript output on identical inputs to catch divergence.

## WHEN YOU'RE DONE

Report back:

1. One-paragraph summary
2. `npm run test` output (call out the ~50 factor module tests specifically)
3. Sample Tactician output for one real upcoming match — show all 11 factors firing or returning null
4. Dashboard screenshot or description of the Tactician section rendering
5. Confederation count check still passing (regression)
6. Backtest still passing from Phase 2a (regression)
7. Any spec deviations and why
8. Any TODOs (especially: which team profiles are placeholder defaults, which beat reporter sections still empty)
9. Confirmation ready for Phase 3 (The CEO — Walters synthesis + discipline gates)

Do NOT proceed to Phase 3 without my approval.

## CONTEXT

By the end of Phase 2b:
- Pure model fair probabilities (Quant) AND situationally-adjusted probabilities (Tactician) both visible on dashboard
- Operator can see what the math says and what the situation says
- Still no automatic STRIKE/PASS — that's Phase 3
- Operator still placing bets manually but with significantly more information than Phase 1

For Matchday 3 of group stage (June 22-25), Phase 2b is critical because the motivation gap factor only fires for `group_matchday_3` matches. That single factor module is responsible for the highest-edge opportunity in the group stage. Make sure it works.

## START HERE

Inspect Phase 0/1/2a implementation. Re-read `03_AGENT_TACTICIAN.md`. Reply with drift report and Phase 2b build plan before writing any code.
