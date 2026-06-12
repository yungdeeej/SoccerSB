# CLAUDE CODE — PHASE 3 EXECUTION PROMPT

## The Pitch — The CEO (Walters Synthesis + Discipline Gates)

## Copy everything below this line into Claude Code

---

You are continuing the build of **The Pitch**. Phases 0, 1, 2a, and 2b are complete:

- Foundation laid (Phase 0)
- Market intelligence skeleton with live odds (Phase 1)
- Quant statistical model with passed backtest (Phase 2a)
- Tactician situational engine with 11 factor modules (Phase 2b)

Phase 3 is **The CEO** — the synthesis agent that combines all upstream outputs, applies Walters discipline gates, and issues STRIKE / WATCH / PASS verdicts. This is also when the full Wolfman LLM synthesis comes online (steam detection, sharp signals, Asian/Western divergence).

By the end of Phase 3, the dashboard transitions from "shows information" to "recommends bets." Every match gets evaluated across 8 v1 market types, and verdicts appear with Walters-voice writeups and Kelly stake recommendations (sizing computed in Phase 4 — Phase 3 produces "would-be" stakes using current bankroll as a placeholder).

## YOUR FIRST ACTIONS — BEFORE WRITING CODE

1. Inspect actual Phase 0/1/2a/2b implementation:
   - `/src/db/schema.ts` — exact column names for `verdicts`, `market_intelligence`, `odds_snapshots`
   - `/src/agents/wolfman/` — Phase 1 polling skeleton (you'll add LLM synthesis layer)
   - `/src/agents/tactician/` — Phase 2b output structure (consumed by CEO)
   - `/src/agents/orchestrator/quant_client.ts` — pattern for inter-service calls (you'll create a CEO orchestration layer)
   - `/src/agents/quant/api/schemas.py` — Quant output shape

2. Read `/docs/worldcup_prompts/05_AGENT_CEO.md` in full. This is your CEO build spec.

3. Read `/docs/worldcup_prompts/04_AGENT_WOLFMAN.md` sections you didn't build in Phase 1 — steam detection, Asian/Western divergence, LLM synthesis layer.

4. Re-read `/docs/worldcup_prompts/00_WALTERS_FOR_SOCCER.md` — discipline principles.

5. **Report drift first.** Reply with:
   - Schema fields actually present vs spec
   - Patterns used in Phases 1-2b that you'll match
   - Anthropic API setup status (Sonnet 4.5 for CEO, Haiku 4.5 for Wolfman)
   - Your Phase 3 build plan, split between (a) full Wolfman, (b) CEO, (c) dashboard integration

Wait for nothing — proceed after reporting.

## ARCHITECTURAL DECISIONS

**Two LLM-driven agents in Phase 3:**

1. **The Wolfman (full version)** — Haiku 4.5 for market signal synthesis. Cheap, fast, high volume. Generates terse market commentary from structured signal data. Detects steam, RLM, Asian/Western divergence — these are deterministic computations; the LLM only writes the summary.

2. **The CEO** — Sonnet 4.5 for verdict synthesis. Higher capability, lower volume. Applies discipline gates deterministically, then uses the LLM to write the Walters-voice executive verdict. Critical: the LLM does NOT make the STRIKE/WATCH/PASS decision — that's deterministic gate logic. The LLM only writes the rationale.

**Why this split:**

Walters discipline is non-negotiable rules-based logic. We do not delegate gate evaluation to an LLM that might "reason its way" to bypassing a gate. The LLM's job is to write the explanation, not make the decision. This is the same architecture pattern used in NHL Syndicate.

**Cost expectations:**
- Wolfman (Haiku, per match per checkpoint): ~$0.003 → ~$0.30/day during World Cup
- CEO (Sonnet, per market per checkpoint): ~$0.05 → ~$5-10/day at peak

Track usage. If we blow past $15/day total, something is wrong with prompt sizing or call frequency.

## CRITICAL — INHERIT THE LEAN PHILOSOPHY

Phase 3 layers in:

**Written by Wolfman (full):**
- `market_intelligence` table — per-market synthesized commentary, steam signals, divergence flags

**Written by CEO:**
- `verdicts` table — STRIKE / WATCH / PASS for each market with rationale, stake recommendation, gates passed/failed

**LLM calls:**
- Wolfman uses Haiku for the terse 1-3 sentence market signal summary
- CEO uses Sonnet for the Walters voice writeup

**NEVER cache LLM responses across matches.** Each match's writeup is unique. Don't pre-generate verdicts. Don't store hallucinated probabilities in the DB.

**Discipline gates are deterministic TypeScript code, not LLM judgment.** The LLM only synthesizes the rationale around the gate result.

## PHASE 3 DELIVERABLES

### PART A — THE FULL WOLFMAN

Phase 1 built the Wolfman skeleton (polling, raw odds capture, basic market state). Phase 3 adds the synthesis layer.

#### A.1 Steam detection

`/src/agents/wolfman/signals/steam.ts`:

Per spec section "Steam move detection (adapted for soccer)":

```typescript
interface SteamSignal {
  detected: boolean;
  weight: number;
  books_involved: string[];
  explanation: string | null;
  window_minutes: number;
}

export function detectSteam(
  market_snapshots: Map<string, OddsSnapshot[]>,
  now: Date = new Date()
): SteamSignal {
  const recentWindowMs = 30 * 60 * 1000;  // 30 minutes for soccer (vs 10 for NHL)
  const minMovementCents = 3;
  const signalWeightThreshold = 1.8;
  
  const tierWeights: Record<BookTier, number> = {
    sharp: 1.0,
    sharp_adjacent: 0.6,
    soft: 0.3
  };
  
  let signalWeight = 0;
  const movedBooks: string[] = [];
  
  for (const [book, snapshots] of market_snapshots) {
    const recent = snapshots.filter(s => 
      now.getTime() - new Date(s.captured_at).getTime() < recentWindowMs
    );
    if (recent.length < 2) continue;
    
    const movement = recent[recent.length - 1].american_odds - recent[0].american_odds;
    
    if (Math.abs(movement) >= minMovementCents) {
      const tier = getBookTier(book);
      signalWeight += tierWeights[tier];
      movedBooks.push(book);
    }
  }
  
  return {
    detected: signalWeight >= signalWeightThreshold,
    weight: signalWeight,
    books_involved: movedBooks,
    explanation: signalWeight >= signalWeightThreshold
      ? `Steam: ${movedBooks.join(', ')} moved ≥${minMovementCents}¢ in ${recentWindowMs / 60000}min window (weight: ${signalWeight.toFixed(1)})`
      : null,
    window_minutes: recentWindowMs / 60000
  };
}
```

#### A.2 Asian/Western divergence

`/src/agents/wolfman/signals/asian_western.ts`:

The signature signal type for soccer. When Asian books (Sbobet, IBC, 188bet) disagree with Western books (Pinnacle, Bet365) by 4+ cents on totals or Asian handicap, follow the Asian books.

```typescript
interface AsianWesternDivergence {
  detected: boolean;
  magnitude_cents: number;
  asian_implied_pct: number | null;
  western_implied_pct: number | null;
  actionable_side: 'asian_aligned' | 'western_aligned' | null;
  explanation: string | null;
}

export function detectAsianWesternDivergence(
  market_snapshots: Map<string, OddsSnapshot[]>
): AsianWesternDivergence {
  const asianBooks = ['sbobet', 'ibc', '188bet'];
  const westernSharpBooks = ['pinnacle', 'bet365_eu'];
  
  const asianLatest = getLatestSnapshots(market_snapshots, asianBooks);
  const westernLatest = getLatestSnapshots(market_snapshots, westernSharpBooks);
  
  if (asianLatest.length === 0 || westernLatest.length === 0) {
    return { detected: false, magnitude_cents: 0, asian_implied_pct: null, western_implied_pct: null, actionable_side: null, explanation: null };
  }
  
  const asianAvgAmerican = average(asianLatest.map(s => s.american_odds));
  const westernAvgAmerican = average(westernLatest.map(s => s.american_odds));
  
  const asianImplied = stripVigSingleSide(asianAvgAmerican);
  const westernImplied = stripVigSingleSide(westernAvgAmerican);
  
  const divergenceCents = (asianImplied - westernImplied) * 100;
  
  if (Math.abs(divergenceCents) < 4) {
    return { detected: false, magnitude_cents: divergenceCents, asian_implied_pct: asianImplied * 100, western_implied_pct: westernImplied * 100, actionable_side: null, explanation: null };
  }
  
  return {
    detected: true,
    magnitude_cents: divergenceCents,
    asian_implied_pct: asianImplied * 100,
    western_implied_pct: westernImplied * 100,
    actionable_side: divergenceCents > 0 ? 'asian_aligned' : 'western_aligned',
    explanation: `Asian/Western divergence: Sbobet/IBC implying ${(asianImplied * 100).toFixed(1)}%, Pinnacle implying ${(westernImplied * 100).toFixed(1)}%. Gap ${divergenceCents.toFixed(1)}¢.`
  };
}
```

**Critical:** Asian/Western divergence only applies to totals and Asian handicap markets. For 1X2 match outcome, defer to Pinnacle exclusively.

#### A.3 Reverse line movement (RLM)

`/src/agents/wolfman/signals/rlm.ts`:

Requires public bet percentage data, which isn't free. For Phase 3, build the module but make it gracefully degrade:

```typescript
export function detectRLM(
  public_bet_pct: number | null,  // null if unavailable
  line_movement_cents: number
): RLMSignal {
  if (public_bet_pct === null) {
    return { detected: false, explanation: 'Public bet data unavailable' };
  }
  
  // Soccer threshold slightly tighter than NHL: 65% public, 3¢ movement
  if (public_bet_pct >= 0.65 && line_movement_cents > 3) {
    return {
      detected: true,
      explanation: `RLM: ${(public_bet_pct * 100).toFixed(0)}% public on favorite, line moved ${line_movement_cents}¢ toward dog`
    };
  }
  
  return { detected: false, explanation: null };
}
```

TODO comment: integrate VSiN or Action Network for public bet data when budget allows.

#### A.4 Line freeze detection

`/src/agents/wolfman/signals/line_freeze.ts`:

```typescript
export function detectLineFreeze(
  pinnacle_snapshots: OddsSnapshot[],
  now: Date = new Date()
): boolean {
  const expectedUpdateIntervalMs = 10 * 60 * 1000;  // 10 minutes during active window
  
  if (pinnacle_snapshots.length < 2) return false;
  
  const latest = pinnacle_snapshots[pinnacle_snapshots.length - 1];
  const gapMs = now.getTime() - new Date(latest.captured_at).getTime();
  
  return gapMs > expectedUpdateIntervalMs;
}
```

#### A.5 Walters timing signals

`/src/agents/wolfman/signals/timing.ts`:

Per Walters Chapter 21: "Bet favorites early, dogs late."

```typescript
type TimingSignal = 'fav_early' | 'dog_late' | 'draw_drift_value' | 'neutral';

export function computeTimingSignal(
  market_state: MarketState,
  kickoff_utc: string,
  now: Date = new Date()
): { signal: TimingSignal; explanation: string } {
  const hoursToKickoff = (new Date(kickoff_utc).getTime() - now.getTime()) / (1000 * 60 * 60);
  
  const opening = market_state.opening_consensus_american;
  const current = market_state.current_consensus_american;
  const movement = current - opening;
  
  const isFavorite = opening < 0;
  const isDraw = market_state.market === 'match_outcome_draw';
  const isUnderdog = opening > 0 && !isDraw;
  
  if (isFavorite && hoursToKickoff > 12) {
    return {
      signal: 'fav_early',
      explanation: 'Favorite — Walters principle: bet early before public piles on. Current price may be best available.'
    };
  }
  
  if (isUnderdog && hoursToKickoff < 6 && movement > 0) {
    return {
      signal: 'dog_late',
      explanation: 'Underdog — line has drifted favorable as kickoff approaches. Walters: bet dogs late.'
    };
  }
  
  if (isDraw && movement > 4) {
    return {
      signal: 'draw_drift_value',
      explanation: 'Draw price drifting longer — context-dependent value'
    };
  }
  
  return { signal: 'neutral', explanation: 'No clear timing edge' };
}
```

#### A.6 Wolfman LLM synthesis

`/src/agents/wolfman/synthesis.ts`:

Haiku 4.5 generates the 1-3 sentence market signal summary per spec.

System prompt (from `04_AGENT_WOLFMAN.md`):

```
You are the market analysis component of The Wolfman, a soccer betting agent. You receive structured market data and produce a 1-3 sentence summary of what the market is telling us about a specific match/market.

You do NOT predict outcomes. You do NOT recommend bets. You describe what sharp money has done and what the current state of the market implies.

Style: terse, technical, no fluff. Reference specific books and movements. Use cents (¢) for line movement.

Examples of good outputs:
- "Pinnacle moved Brazil from -200 to -185 over 2 hours; Sbobet followed within 45min. DraftKings still at -210 (25¢ stale). Sharp money on Brazil dog side."
- "Asian/Western divergence: Sbobet implies 58% Over 2.5, Pinnacle implies 53%. 5¢ gap, Asian books typically lead on soccer totals."
- "Steam on Cameroon ML at T-2h: Pinnacle/Sbobet/Bet365 all moved -40¢ in 30min. DK still at +400 (40¢ stale)."

Avoid:
- Speculating on why sharps moved
- Predicting the outcome
- Adjectives like "obviously," "clearly," "definitely"
- Any opinion about whether to bet
- Soccer-specific narrative

The market has three outcomes (home win, draw, away win). When describing movement, be specific about which side moved.

Output 1-3 sentences only. No preamble. No conclusion.
```

User message format (structured context):

```typescript
const userMessage = `
Match: ${match.away_team} @ ${match.home_team}, ${match.tournament_stage}
Market: ${market}
Side: ${side}

Movement (last 24h):
- Opening: ${opening} (${opening_book})
- Current consensus: ${current}
- Biggest mover: ${biggest_mover_book} moved ${biggest_mover_cents}¢

Sharp anchors:
- Pinnacle: ${pinnacle_current} (no-vig ${pinnacle_no_vig_pct}%)
- Sbobet: ${sbobet_current || 'unavailable'} ${sbobet_no_vig_pct ? `(no-vig ${sbobet_no_vig_pct}%)` : ''}

Signals detected:
- Steam: ${steam.detected ? steam.explanation : 'none'}
- RLM: ${rlm.detected ? rlm.explanation : 'none'}
- Asian/Western divergence: ${aw_divergence.detected ? aw_divergence.explanation : 'aligned'}
- Line freeze: ${line_freeze ? 'detected on Pinnacle' : 'none'}
- Timing: ${timing.signal} — ${timing.explanation}

Best operator-accessible: ${best_book} at ${best_book_american}

Generate 1-3 sentence market signal summary in Wolfman voice.
`;
```

LLM call wrapper:

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function generateMarketSummary(context: LLMMarketContext): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    system: WOLFMAN_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(context) }]
  });
  
  return response.content[0].type === 'text' ? response.content[0].text : '';
}
```

Failure mode: if LLM fails, fall back to template-based summary:
```
"Movement: ${movement_cents}¢ ${direction}. Pinnacle: ${pinnacle}. Best at ${best_book} ${best_odds}. ${steam.detected ? 'Steam detected.' : ''} ${aw_divergence.detected ? 'Asian/Western gap.' : ''}"
```

Log every LLM call to `agent_runs` with token counts and cost estimate.

#### A.7 Wolfman main entry point

`/src/agents/wolfman/index.ts`:

```typescript
export async function runWolfman(inputs: WolfmanInputs): Promise<WolfmanOutput> {
  // 1. Pull all recent odds snapshots for this match (last 24h window)
  const snapshots = await getOddsSnapshotsForMatch(inputs.match_id, '24h');
  
  // 2. For each market we care about (8 v1 markets), compute signals
  const markets: Record<string, MarketAnalysis> = {};
  
  for (const market of V1_MARKETS) {
    const marketSnapshots = filterSnapshotsByMarket(snapshots, market);
    if (marketSnapshots.size === 0) continue;
    
    const steam = detectSteam(marketSnapshots);
    const rlm = detectRLM(null, computeMovement(marketSnapshots).cents);  // no public data yet
    const lineFreeze = detectLineFreeze(getPinnacleSnapshots(marketSnapshots));
    const awDivergence = detectAsianWesternDivergence(marketSnapshots);
    const timing = computeTimingSignal(/* ... */);
    const bestPrice = findBestOperatorAccessiblePrice(marketSnapshots);
    
    // Generate LLM summary
    const summary = await generateMarketSummary({
      match: inputs.match_metadata,
      market,
      side: getSide(market),
      ...signalContext
    });
    
    markets[market] = {
      // ... all the MarketAnalysis fields per spec
      market_signal_summary: summary
    };
  }
  
  // 3. Cross-market observations (patterns across multiple markets)
  const crossMarket = analyzeCrossMarket(markets);
  
  // 4. Write to market_intelligence
  await writeMarketIntelligence({
    match_id: inputs.match_id,
    analyzed_at: new Date().toISOString(),
    markets,
    cross_market_observations: crossMarket
  });
  
  return { match_id: inputs.match_id, markets, cross_market_observations: crossMarket };
}
```

Cadence: Wolfman runs at T-12h, T-2h, T-30min — same as CEO checkpoints. Don't run at T-24h (line movement signals are too sparse that early).

### PART B — THE CEO

The synthesis layer that turns Quant + Tactician + Wolfman into verdicts.

#### B.1 Discipline gates (deterministic TypeScript)

`/src/agents/ceo/gates/`:

Nine gates per spec. Each is a pure function returning `GateResult`:

```typescript
interface GateResult {
  passed: boolean;
  gate: string;
  explanation?: string;
  watch_eligible?: boolean;  // if PASS but close, consider WATCH
}
```

Build one file per gate:

- **`gate_a_edge.ts`** — Edge threshold (2.0% base, 4.0% if low confidence, 3.5% R32, 3.0% opener, 2.5% SF/Final, 3.0% alt markets)
- **`gate_b_confirmation.ts`** — XI confirmation for XI-dependent markets
- **`gate_c_market.ts`** — Adverse line movement >4¢, Pinnacle disagreement >4%, line freeze
- **`gate_d_model_confidence.ts`** — Quant CI >10% AND edge <4%
- **`gate_e_capital.ts`** — Insufficient capital, daily cap, stop-loss halt
- **`gate_f_tactician_sanity.ts`** — Adjustment capped + multiple CRITICAL factors, severe weather + totals/AH
- **`gate_g_walters_discipline.ts`** — Already bet this match today (one bet per match per day)
- **`gate_h_tournament_stage.ts`** — R32, opener, SF/Final edge requirements
- **`gate_i_asian_western.ts`** — If Asian books disagree on totals/AH by >5%, PASS

**Critical:** gates execute in order. First failure ends evaluation and returns the failure as the verdict reason. Don't skip ahead to find a "less harsh" reason.

```typescript
const GATE_ORDER = [
  checkEdgeGate,
  checkConfirmationGate,
  checkMarketGate,
  checkModelConfidenceGate,
  checkCapitalGate,
  checkTacticianSanityGate,
  checkWaltersDisciplineGate,
  checkTournamentStageGate,
  checkAsianWesternGate
];

function runAllGates(context: CEOContext, market: string): { passed: boolean; failure?: GateResult; allResults: GateResult[] } {
  const results: GateResult[] = [];
  
  for (const gate of GATE_ORDER) {
    const result = gate(context, market);
    results.push(result);
    
    if (!result.passed) {
      return { passed: false, failure: result, allResults: results };
    }
  }
  
  return { passed: true, allResults: results };
}
```

**Tests required:** each gate gets at least 3 unit tests — pass case, fail case, edge case. Plus integration test running all gates in sequence on real scenarios.

#### B.2 Star rating computation

`/src/agents/ceo/star_rating.ts`:

Per spec, deterministic mapping from edge percentage to stars:

```typescript
export function computeStarRating(edge_pct: number): { stars: number; display: string } {
  if (edge_pct < 2.0) return { stars: 0, display: '' };
  if (edge_pct < 2.5) return { stars: 0.5, display: '★½' };
  if (edge_pct < 3.5) return { stars: 1.0, display: '★' };
  if (edge_pct < 4.5) return { stars: 1.5, display: '★½★' };
  if (edge_pct < 6.0) return { stars: 2.0, display: '★★' };
  if (edge_pct < 8.0) return { stars: 2.5, display: '★★½' };
  return { stars: 3.0, display: '★★★' };
}
```

#### B.3 LLM synthesis (Sonnet 4.5)

`/src/agents/ceo/writeup.ts`:

The LLM does NOT decide STRIKE/WATCH/PASS. Gates have already made that decision. The LLM writes the Walters-voice rationale.

System prompt (verbatim from `05_AGENT_CEO.md` section "SYSTEM PROMPT (RUNTIME)"):

```
You are "Billy Walters," executive head of an international soccer betting syndicate during the 2026 FIFA World Cup. Your job in this call is to write the executive verdict rationale for a single market on a single match.

The decision (STRIKE / WATCH / PASS) has ALREADY been made by deterministic gate logic. You do NOT change the decision. You write the rationale that explains it in the Walters voice.

VOICE GUIDELINES:
- Cold, terse, peer-to-peer with the operator
- Reference data, never feelings
- No exclamation points, no hyperbole, no emojis
- Short sentences, active voice
- "Pass" is strong; use it without apology
- Cite agent outputs: "The Tactician shows..." "Wolfman's tape indicates..."
- Three-way thinking: be specific about home/draw/away
- Don't predict scorelines
- No soccer journalism vocabulary ("brilliant", "deserved")

OUTPUT FORMAT:
For STRIKE: one paragraph (~3-5 sentences) explaining why this bet, why this size, why this book, why now.
For WATCH: one paragraph explaining what we're tracking and what trigger would shift to STRIKE.
For PASS: one paragraph explaining which gate failed and why deferring is correct.

You receive structured context with all relevant data. Use it. Do not invent.
```

User message format:

```typescript
const userMessage = `
DECISION: ${decision}
${decision === 'STRIKE' ? `Recommended: ${side} ${american} @ ${book}, stake $${stake}, ${stars} stars` : ''}
${decision === 'PASS' || decision === 'WATCH' ? `Failed gate: ${gate}` : ''}

MATCH: ${away_team} @ ${home_team} | ${stage} | ${kickoff_local}

TACTICIAN'S INTEL:
- XI status: ${home_xi_status} (home) / ${away_xi_status} (away)
- Cluster scores: ${home_cluster}/${away_cluster}
- Flagged concerns: ${concerns.join('; ')}

TACTICIAN'S DELTA:
${factor_breakdown_summary}
Net advantage: ${net_advantage_pct}% to ${advantaged_team}
${capped ? 'Adjustment capped at ±12%' : ''}

QUANT'S READ:
- Model fair (3-way): ${home_decimal}/${draw_decimal}/${away_decimal}
- Best market: ${side} ${american} (${book})
- Adjusted edge: ${edge_pct}%
- CI width: ±${ci_pct}%

WOLFMAN'S TAPE:
- Movement: opening ${opening}, current ${current}
- Pinnacle: ${pinnacle} (no-vig ${pinnacle_pct}%)
${sbobet ? `- Sbobet: ${sbobet}` : ''}
- ${signals_summary}
- Best operator-accessible: ${best_book} ${best_odds}

GATES STATUS:
${gates_passed.map(g => `✓ ${g}`).join('\n')}
${failed_gate ? `✗ ${failed_gate}` : ''}

Write the Walters executive verdict rationale. One paragraph.
`;
```

LLM call:

```typescript
async function generateVerdictWriteup(context: CEOWriteupContext): Promise<string> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 500,
    system: CEO_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(context) }]
  });
  
  return response.content[0].type === 'text' ? response.content[0].text : '';
}
```

Failure mode: if LLM fails, fall back to deterministic template:
```
STRIKE: "Edge ${edge_pct}% on ${side} at ${book}. ${tactician_summary}. Pinnacle within ${pinnacle_delta_pct}%. ${stars} stars. Strike with sizing."
PASS: "Pass. ${failed_gate}: ${explanation}."
WATCH: "Watch. ${watch_reason}. Trigger to revisit: ${watch_for}."
```

#### B.4 CEO orchestration

`/src/agents/ceo/index.ts`:

The main entry point. Runs for a single market on a single match.

```typescript
export async function runCEO(inputs: CEOInputs): Promise<CEOOutput> {
  const startMs = Date.now();
  
  try {
    // 1. Gather all upstream outputs
    const quant = await getQuantOutput(inputs.match_id);
    const tactician = await getTacticianOutput(inputs.match_id);
    const wolfman = await getWolfmanOutput(inputs.match_id);
    const treasurerSnapshot = await getTreasurerSnapshot();  // Phase 4 builds the real Treasurer; use stub for Phase 3
    
    // 2. For each v1 market, compute the candidate verdict
    const verdicts: CEOOutput[] = [];
    
    for (const marketKey of V1_MARKETS) {
      const sides = getSidesForMarket(marketKey);  // e.g., ['home', 'draw', 'away'] for 1X2
      
      for (const side of sides) {
        // 3. Build context for this market+side
        const context = buildCEOContext({
          inputs,
          quant,
          tactician,
          wolfman,
          treasurerSnapshot,
          market: marketKey,
          side
        });
        
        // 4. Compute adjusted edge
        const adjustedEdge = computeAdjustedEdge(context);
        
        // 5. Run gates in order
        const gateResults = runAllGates(context, marketKey);
        
        // 6. Determine decision
        let decision: 'STRIKE' | 'WATCH' | 'PASS';
        if (gateResults.passed) {
          decision = 'STRIKE';
        } else if (gateResults.failure?.watch_eligible) {
          decision = 'WATCH';
        } else {
          decision = 'PASS';
        }
        
        // 7. Compute star rating
        const { stars, display: starDisplay } = computeStarRating(adjustedEdge * 100);
        
        // 8. Compute stake (Phase 3 uses placeholder Kelly; Phase 4 plugs in real Treasurer)
        const stake = decision === 'STRIKE' ? computePlaceholderStake(adjustedEdge, treasurerSnapshot) : null;
        
        // 9. Generate LLM writeup
        const writeup = await generateVerdictWriteup({
          decision,
          context,
          gateResults,
          adjustedEdge,
          stars,
          stake
        });
        
        // 10. Build verdict
        const verdict: CEOOutput = {
          match_id: inputs.match_id,
          market: marketKey,
          side,
          decision,
          recommended_book: decision === 'STRIKE' ? context.best_book : null,
          recommended_odds_american: decision === 'STRIKE' ? context.best_book_american : null,
          recommended_stake_cents: stake?.stake_cents || null,
          kelly_fraction_used: stake?.fraction || null,
          bankroll_pct: stake?.bankroll_pct || null,
          star_rating: decision === 'STRIKE' ? stars : null,
          pass_reason: decision === 'PASS' ? gateResults.failure?.gate : null,
          watch_reason: decision === 'WATCH' ? gateResults.failure?.gate : null,
          watch_for: decision === 'WATCH' ? buildWatchTrigger(gateResults.failure) : null,
          raw_edge_pct: computeRawEdge(context) * 100,
          adjusted_edge_pct: adjustedEdge * 100,
          walters_writeup: writeup,
          agent_inputs_snapshot: {
            quant_version: quant.model_version,
            tactician_version: tactician.coefficient_version,
            wolfman_analyzed_at: wolfman.analyzed_at,
            treasurer_snapshot_at: new Date().toISOString()
          },
          discipline_gates_passed: gateResults.allResults.filter(r => r.passed).map(r => r.gate),
          discipline_gates_failed: gateResults.allResults.filter(r => !r.passed).map(r => r.gate),
          issued_at: new Date().toISOString(),
          expires_at: inputs.match_metadata.scheduled_kickoff_local
        };
        
        // 11. Write to verdicts table
        await writeVerdict(verdict);
        
        // 12. If verdict changed from previous run, log it
        if (inputs.previous_verdict && inputs.previous_verdict.decision !== decision) {
          await markVerdictSuperseded(inputs.previous_verdict.id, verdict.id);
        }
        
        verdicts.push(verdict);
      }
    }
    
    // 13. Log agent run
    await logAgentRun({
      agent: 'ceo',
      match_id: inputs.match_id,
      run_phase: inputs.run_phase,
      status: 'success',
      duration_ms: Date.now() - startMs,
      outputs_summary: {
        markets_evaluated: V1_MARKETS.length,
        strikes: verdicts.filter(v => v.decision === 'STRIKE').length,
        watches: verdicts.filter(v => v.decision === 'WATCH').length,
        passes: verdicts.filter(v => v.decision === 'PASS').length
      }
    });
    
    return { match_id: inputs.match_id, verdicts };
  } catch (error) {
    await logAgentRun({
      agent: 'ceo',
      status: 'failed_recoverable',
      duration_ms: Date.now() - startMs,
      error_message: error.message
    });
    throw error;
  }
}
```

#### B.5 Placeholder Treasurer stub

Phase 4 builds the real Treasurer. Phase 3 needs a stub that returns a workable snapshot so the CEO can run end-to-end:

```typescript
// /src/agents/treasurer/stub.ts — REPLACED IN PHASE 4

export async function getTreasurerSnapshot(): Promise<TreasurerSnapshot> {
  const bankroll = await getCurrentBankrollFromLedger();
  const todaysBets = await getTodaysBetsCount();
  
  return {
    active_bankroll_cents: bankroll,
    total_capital_cents: bankroll,
    pending_wagers_cents: BigInt(0),
    available_capital_cents: bankroll,
    peak_bankroll_cents: bankroll,
    peak_reached_at: new Date().toISOString(),
    drawdown_pct_from_peak: 0,
    stop_loss_active: 'none',
    stop_loss_reason: null,
    stop_loss_resumes_at: null,
    todays_bet_count: todaysBets,
    todays_bets_by_match: new Map(),
    daily_bet_cap: 5,  // group stage default
    this_week_clv_cents: 0,
    this_month_clv_cents: 0,
    rolling_30d_clv_cents: 0,
    clv_classification: 'break_even',
    current_kelly_fraction: 0.25,
    daily_bet_cap_effective: 5
  };
}

export function computePlaceholderStake(edge: number, snapshot: TreasurerSnapshot): { stake_cents: bigint; fraction: number; bankroll_pct: number } {
  // Quarter Kelly with 3% hard cap, $20 floor
  // Real version in Phase 4
  // ...
}
```

### PART C — DASHBOARD INTEGRATION

#### C.1 Match detail page — full verdict display

Update the match detail view to show CEO verdicts. Per spec format:

```
┌──────────────────────────────────────────────────────────────────┐
│ ← SLATE     SPAIN vs CABO VERDE · GROUP H · MATCHDAY 1           │
├──────────────────────────────────────────────────────────────────┤
│ THE QUANT'S READ                                                  │
│  Model fair: ESP 28% / Draw 30% / CPV 42%                        │
│  ...                                                              │
├──────────────────────────────────────────────────────────────────┤
│ THE TACTICIAN'S DELTA                                             │
│  ...                                                              │
├──────────────────────────────────────────────────────────────────┤
│ THE WOLFMAN'S TAPE                                                │
│  ESP ML: opener -350, current -395 (sharp toward Spain)           │
│  Pinnacle: -385 (no-vig 79.2%)                                    │
│  Sbobet: -380 (no-vig 79.0%) — Asian/Western aligned             │
│  Steam: detected at T-90min on Pinnacle/Sbobet                    │
│  Best operator-accessible: -380 (Bet365 Ontario)                  │
│  Walters timing: fav early — current price likely best available  │
│  Wolfman summary: "Pinnacle moved ESP from -350 to -385 over 4h; │
│    Sbobet followed. Steam on home favorite — sharp ESP."          │
├──────────────────────────────────────────────────────────────────┤
│ CEO VERDICTS                                                      │
│                                                                   │
│  Market           Decision  Edge   Stars   Book      Stake       │
│  Match ESP       STRIKE    +4.2%  ★½    bet365_on  $42          │
│  Match Draw      PASS      —      —      —         —             │
│  Match CPV       PASS      —      —      —         —             │
│  Over 2.5        WATCH     +2.3%  —      —         —             │
│  Under 2.5       PASS      —      —      —         —             │
│  Asian H -1.5    STRIKE    +5.1%  ★½★   fanduel   $42           │
│  BTTS Yes        PASS      —      —      —         —             │
│  ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

Click on any verdict → goes to verdict detail page (Section C.2).

#### C.2 Verdict detail page

`GET /verdicts/{verdict_id}`:

Full post-mortem capability. Shows:

- The verdict (STRIKE/WATCH/PASS) with full Walters writeup
- Every gate's result (passed/failed with explanations)
- Snapshot of all upstream agent outputs at the moment of verdict
- "If this verdict was downgraded, here's what changed" (for superseded verdicts)

This is the most important debugging tool in the system. When CLV goes bad, the operator walks through verdict detail pages to figure out where the system was wrong.

#### C.3 Slate view — STRIKE count

Update the slate view header to show today's STRIKE count prominently:

```
A1 TODAY'S SLATE · 4 MATCHES · 2 STRIKES                ◆ RUN POLL
```

Where "2 STRIKES" is colored attention-grabbingly (orange or red — match the NHL Syndicate aesthetic). Click → filters slate to only matches with active STRIKEs.

#### C.4 Edge Board

The B1 Edge Board panel from Phase 1 gets a real upgrade: now it shows edge percentages and verdicts because the Quant/Tactician/CEO are wired in.

```
B1 EDGE BOARD                                  3 STRIKE · 4 WATCH
                                                                   
MATCHUP   MKT    SIDE     BOOK       ODDS    EDGE   DEC    STARS  
ESP-CPV   ML     home     bet365_on  -380   +4.2%  STRIKE  ★½    
ESP-CPV   AH     -1.5     fanduel    +110   +5.1%  STRIKE  ★½★   
BRA-MAR   O 2.5  -        draftkings -110   +2.3%  WATCH   —     
...
```

Sort by edge descending. Filter buttons for STRIKE / WATCH / PASS / ALL.

#### C.5 Telegram alerts (FINALLY)

Phase 1 set up the bot. Phase 3 wires up STRIKE alerts.

When CEO issues a STRIKE:

```
🎯 STRIKE

ESP vs CPV (Group H, June 14)
Market: Match Outcome — Spain
Best: -380 @ Bet365 Ontario
Edge: +4.2% (★½)
Stake: $42 (Kelly ¼, 1.2% of bankroll)

Wolfman: "Steam on Pinnacle moved ESP from -350 to -385 in 30min. Sbobet aligned. Sharp money on home favorite."

→ Open verdict: https://thepitch.replit.app/verdicts/abc-123
```

When CEO downgrades a previously-issued STRIKE (re-evaluation at T-2h or T-30min reduces edge below threshold):

```
⚠️ STRIKE DOWNGRADED (CRITICAL)

ESP vs CPV — Match Outcome Spain
Previous: STRIKE at -380 @ Bet365 Ontario
Current: PASS

Reason: Senegal XI confirmation arrived showing top scorer scratched (cluster score 4.5). Tactician adjustment moved edge from +4.2% to +1.1%. Below 2% threshold.

⚠️ If you already placed this bet, the market may move against you. Consider hedging or accepting the position.

→ Updated verdict: https://thepitch.replit.app/verdicts/abc-456
```

Critical alerts use the CRITICAL priority — phone ringtone, persistent notification.

Daily report stays for Phase 4 (Treasurer owns aggregated reporting).

## SCOPE BOUNDARIES — DO NOT BUILD IN PHASE 3

- ❌ The full Treasurer — Phase 4 (stake math beyond placeholder, stop-loss state machine, CLV automation)
- ❌ Automatic bet placement — never (system always requires manual placement)
- ❌ Player props or futures — v2
- ❌ Live in-play predictions — v2
- ❌ Tournament progression simulator — separate feature

If you find yourself wanting to build one of these, STOP and ask.

## TECHNICAL CONSTRAINTS

- TypeScript strict, zero `any`
- BigInt cents for money
- UTC in storage
- Drizzle ORM
- zod validation for all LLM responses (defensive — even though Anthropic responses are reliable, validate shape)
- LLM calls always have timeout (10 seconds for Haiku, 20 seconds for Sonnet)
- Failure falls back to deterministic templates — system never blocks on LLM failure

## TESTING REQUIREMENTS

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero errors
3. `npm run test` — all pass, including:
   - Each of 9 gates with 3+ unit tests
   - Star rating boundary cases (2.0, 2.5, 3.5, 4.5, 6.0, 8.0)
   - Steam detection on synthetic snapshot data
   - Asian/Western divergence calculation
   - Line freeze detection
   - Timing signal classification
   - End-to-end: pick a real upcoming match, run full pipeline (Wolfman → CEO), verify verdicts written to DB
4. LLM integration tests (using a recorded fixture, not live calls):
   - Wolfman summary generation for typical context
   - CEO writeup for STRIKE, WATCH, PASS variants
   - Template fallback when LLM mocked to fail

## PHASE 3 EXIT CRITERIA

1. Full Wolfman implemented: steam, RLM (graceful degrade), line freeze, Asian/Western divergence, timing signals, LLM market summaries
2. All 9 CEO discipline gates implemented and tested
3. CEO orchestration end-to-end working — produces verdicts for all 8 v1 markets per match
4. Star rating computation working
5. CEO LLM writeup using Sonnet 4.5 with Walters voice
6. Wolfman LLM summary using Haiku 4.5
7. Dashboard updated: match detail shows all four agent panels, verdicts table, verdict detail page
8. Slate view shows STRIKE count, Edge Board shows real edges
9. Telegram alerts firing on STRIKE and CRITICAL downgrade
10. Verdicts written to `verdicts` table with full audit snapshot
11. Market intelligence written to `market_intelligence` table
12. All agent runs logged
13. LLM cost tracking working, daily total visible in dashboard
14. All tests passing

## RULES OF ENGAGEMENT

- **Report drift first.**
- **Gates are deterministic.** The LLM does NOT decide STRIKE/WATCH/PASS. Decision logic is in TypeScript code.
- **The Walters voice is non-negotiable.** Operator review during this phase will flag if the LLM drifts into ESPN-pundit voice. Quality of the writeup directly affects whether the operator trusts the verdict.
- **One bet per match per day is sacred.** Gate G enforces it. Even if multiple markets show STRIKE on the same match, only one can be acted on per day.
- **Don't expand scope.** No Treasurer. No automatic placement.
- **Validate LLM responses.** zod schemas. Templates as fallback.
- **LLM costs are tracked per call.** Log token counts in `agent_runs.outputs_summary`. If we burn through expected budget, we need to know fast.
- **Atomicity on verdict writes.** A verdict write + supersede-old-verdict + log must be a single DB transaction.

## WHEN YOU'RE DONE

Report back:

1. One-paragraph summary
2. `npm run test` output (call out gate tests specifically — should be 30+)
3. Sample STRIKE verdict for a real upcoming match — include the full Walters writeup
4. Sample PASS verdict with explanation
5. Sample Wolfman LLM-generated market summary
6. Telegram STRIKE alert example (text)
7. Dashboard screenshot or description showing all four agent panels populated
8. LLM cost for the first 24h of operation (estimate based on test runs)
9. Verdict detail page rendering — show one example with all gates' results visible
10. Confederation count + backtest still passing (regressions)
11. Any spec deviations
12. Confirmation ready for Phase 4 (Treasurer — real Kelly sizing, stop-loss, CLV automation)

Do NOT proceed to Phase 4 without my approval.

## CONTEXT

By end of Phase 3, the system is fully operational as an advisory tool:
- Identifies fair probabilities (Quant)
- Adjusts for situational factors (Tactician)
- Reads market signals (Wolfman)
- Applies Walters discipline (CEO)
- Recommends specific bets with sizing and rationale

The operator receives Telegram alerts on STRIKEs, reviews the writeup, decides whether to place. Manual placement workflow from Phase 1 still applies — system never auto-places.

What's missing until Phase 4: real bankroll math (Kelly sizing properly tied to actual bankroll state), stop-loss enforcement (CEO uses a stub that doesn't enforce drawdown halts yet), automatic CLV computation on settled bets (CLV is captured manually in Phase 3 — Phase 4 automates it).

For Matchday 3 of group stage (June 22-25), Phase 3 must be complete and stable. The motivation-gap factor from Phase 2b is the highest-edge opportunity, and the CEO's gates determine whether that edge becomes an actionable STRIKE or gets filtered.

## START HERE

Inspect Phase 0/1/2a/2b implementation. Re-read `04_AGENT_WOLFMAN.md` (full version) and `05_AGENT_CEO.md`. Reply with drift report and Phase 3 build plan split between (a) full Wolfman, (b) CEO, (c) dashboard integration.
