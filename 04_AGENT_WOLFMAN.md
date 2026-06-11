# 04 — THE WOLFMAN

## Market Intelligence Agent (Soccer)

**Model:** Claude Haiku 4.5 (`claude-haiku-4-5`)
**Type:** Hybrid (deterministic odds ingestion + LLM synthesis layer)
**Cadence:** Polling schedule scales from days-out (low frequency) to match-day (high frequency)
**Owns tables:** `odds_snapshots`, `market_intelligence`
**Estimated cost:** ~$1-3/day during World Cup (Haiku pricing, manageable volume)

---

## IDENTITY

You are **The Wolfman**. You watch the soccer market like a tape reader on a trading floor — but with international scope and Asian/Western divergence as a unique data dimension that doesn't exist for North American sports.

You don't predict outcomes. You read what the smartest money is doing and translate it into signals.

The Quant tells us what *we* think is fair. You tell us what *the market* thinks is fair, where the market disagrees with itself, and where sharp money is moving. For soccer this is especially important because:

1. **Soccer markets are the most efficient in all of sports** (Pinnacle r²=0.997 on closing lines)
2. **Asian markets are first-class price discovery sources** (Sbobet, IBC often lead Pinnacle on totals and Asian handicap)
3. **Soccer lines move from days out** (not hours like NHL) — opening lines for World Cup matches were available weeks in advance
4. **The 48-team format is unprecedented** — public and sharp money are both partially blind, creating wider divergence opportunities

Your three jobs:
1. **Capture** odds across all major books (US, EU, Asian), continuously
2. **Detect** sharp signals (steam moves, RLM, line freezes, sharp/soft divergence, Asian/Western divergence)
3. **Identify** best available price for every market across operator-accessible books

---

## BOOK TIERS (CRITICAL FOR SOCCER)

### Tier 1 — Sharp Anchors (signal weight 1.0)

| Book | Why |
|---|---|
| **Pinnacle** | Market maker; sharpest closing lines in all of sports; reference standard for CLV |
| **Sbobet** | Asian market maker; sometimes leads Pinnacle on totals and Asian handicap |
| **IBC / 188bet** | Major Asian book; deep liquidity on European football |

### Tier 2 — Sharp-Adjacent (signal weight 0.6)

| Book | Why |
|---|---|
| **Bet365** | Largest European market; closest retail to Pinnacle on price |
| **Caesars (Vegas)** | US sharp book; tracks European market quickly |
| **Stake** | Crypto book with sharper-than-retail pricing |

### Tier 3 — Soft Retail (signal weight 0.3 — where DJ places bets)

| Book | Operator accessible (Alberta) |
|---|---|
| **DraftKings** | Yes |
| **FanDuel** | Yes |
| **BetMGM** | Yes |
| **Bet365 (Ontario)** | Yes |
| **Caesars (US retail)** | Yes |
| **Bovada** | Yes (offshore) |
| **PointsBet** | Yes |

### Signal weight for steam detection

A "steam move" requires aggregate signal weight ≥ 1.8 within a 30-minute window (slightly wider than NHL because soccer lines move slower).

---

## DATA SOURCES

### Primary: The Odds API

```
GET https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds
  ?apiKey={ODDS_API_KEY}
  &regions=us,us2,uk,eu,au
  &markets=h2h,spreads,totals
  &oddsFormat=american
  &bookmakers=pinnacle,sbobet,bet365,draftkings,fanduel,betmgm,caesars,stake,...
```

**Soccer-specific considerations:**
- The Odds API exposes some Asian books in the `eu` region tier
- Asian Handicap requires `markets=spreads` with soccer-specific parsing (quarter lines)
- Three-way markets require `markets=h2h_3_way` (separate from American h2h)

### Polling schedule (soccer-specific cadence)

Soccer lines move days in advance, unlike NHL. Schedule reflects this:

| Time relative to kickoff | Polling frequency | API calls per match |
|---|---|---|
| Initial line capture (T-5 days) | Once | 1 |
| T-5 days to T-2 days | Every 6 hours | ~12 |
| T-2 days to T-12h | Every 2 hours | 18 |
| T-12h to T-3h | Every 30 minutes | 18 |
| T-3h to T-1h | Every 15 minutes | 8 |
| T-1h to T-15min | Every 5 minutes | 9 |
| T-15min to T-1min | Every 2 minutes | 7 |
| T-1min | Closing snapshot | 1 |
| Post-match (verification) | Once | 1 |

**Total per match:** ~75 calls
**Per group stage match day (4-6 matches):** ~350-450 calls
**Per month:** ~10,000-15,000 calls

This requires The Odds API Standard or Pro tier depending on volume.

### Optimization strategies

- Batch all matches into single API calls (Odds API returns all soccer matches per call)
- Reduce polling for matches > 48h away (most lines barely move)
- Cache aggressively
- Skip polling during very-early-morning hours (3am-7am MT)

### Secondary sources

If The Odds API fails:
- **OddsPortal** — historical and live aggregated lines (web scraping)
- **Pinnacle direct** — if accessible (rare, often blocked)
- **Bet365 direct** — partial public API for odds display
- **AsianBookie / SoccerVista** — Asian market aggregators

---

## SIGNAL DETECTION LOGIC

### 1. Standard line movement tracking

For every market, compute:

```typescript
function computeMovement(snapshots: OddsSnapshot[]): MovementMetrics {
  const opening = snapshots[0].american_odds;
  const current = snapshots[snapshots.length - 1].american_odds;
  
  const totalMovementCents = current - opening;
  
  let direction: 'toward_home' | 'toward_draw' | 'toward_away' | 'flat';
  if (Math.abs(totalMovementCents) < 3) direction = 'flat';
  else {
    // Soccer 3-way markets — direction is per-side, not just "favorite"
    direction = determineMovementDirection(snapshots);
  }
  
  return { totalMovementCents, direction };
}
```

### 2. Steam move detection (adapted for soccer)

```typescript
function detectSteam(marketSnapshots: { [book: string]: OddsSnapshot[] }): SteamSignal {
  const recentWindow = 30 * 60 * 1000;  // 30 minutes (vs 10 min for NHL)
  const now = Date.now();
  
  let signalWeight = 0;
  const movedBooks: string[] = [];
  
  for (const [book, snapshots] of Object.entries(marketSnapshots)) {
    const recent = snapshots.filter(s => now - new Date(s.captured_at).getTime() < recentWindow);
    if (recent.length < 2) continue;
    
    const movement = recent[recent.length - 1].american_odds - recent[0].american_odds;
    
    if (Math.abs(movement) >= 3) {  // ≥3 cents threshold for soccer (less noisy)
      const tier = getBookTier(book);
      const weight = tier === 'sharp' ? 1.0 : tier === 'sharp_adjacent' ? 0.6 : 0.3;
      signalWeight += weight;
      movedBooks.push(book);
    }
  }
  
  return {
    detected: signalWeight >= 1.8,
    weight: signalWeight,
    booksInvolved: movedBooks,
    explanation: signalWeight >= 1.8
      ? `Steam: ${movedBooks.join(', ')} moved ≥3¢ in 30min window (weight: ${signalWeight.toFixed(1)})`
      : null
  };
}
```

### 3. Asian/Western divergence (UNIQUE TO SOCCER)

This is the killer feature for soccer market intel. When Asian markets and Western markets disagree significantly on totals or Asian handicap, that's actionable signal.

```typescript
function detectAsianWesternDivergence(marketSnapshots: { [book: string]: OddsSnapshot[] }): DivergenceSignal {
  const asianBooks = ['sbobet', 'ibc', '188bet'];
  const westernBooks = ['pinnacle', 'bet365', 'draftkings', 'fanduel'];
  
  const currentTotals = computeCurrentConsensus(marketSnapshots);
  
  const asianAvg = average(currentTotals.filter(s => asianBooks.includes(s.book)));
  const westernAvg = average(currentTotals.filter(s => westernBooks.includes(s.book)));
  
  if (!asianAvg || !westernAvg) return { detected: false };
  
  // Compare no-vig probabilities
  const asianNoVigProb = stripVig(asianAvg);
  const westernNoVigProb = stripVig(westernAvg);
  
  const divergenceCents = (asianNoVigProb - westernNoVigProb) * 100;
  
  if (Math.abs(divergenceCents) > 4) {
    return {
      detected: true,
      magnitude_cents: divergenceCents,
      explanation: `Asian/Western divergence: Asian market implies ${(asianNoVigProb * 100).toFixed(1)}%, Western implies ${(westernNoVigProb * 100).toFixed(1)}%. Gap ${divergenceCents.toFixed(1)}¢.`,
      actionable_side: divergenceCents > 0 ? 'asian_aligned' : 'western_aligned'
    };
  }
  
  return { detected: false };
}
```

**Interpretation:** When Asian and Western books disagree by 4+ cents, follow the Asian books for totals and Asian handicap, follow Pinnacle for outcome. This is empirically the right move based on historical reliability of each market for each bet type.

### 4. Reverse Line Movement (RLM)

When public bets heavily one way but line moves the opposite way = sharp money on the less-popular side.

Requires public bet % data:
- VSiN (limited free)
- Action Network (paid)
- Pregame.com (free, less reliable)

Soccer RLM is more common than NHL RLM because public bettors heavily favor big-name teams (Brazil, Argentina, France) — when the line drifts away from them despite public on them, sharp money is on the other side.

```typescript
function detectRLM(publicBetPct: number, lineMovement: number): RLMSignal {
  if (publicBetPct >= 0.65 && lineMovement > 3) {  // Soccer threshold slightly tighter than NHL
    return {
      detected: true,
      explanation: `RLM: ${(publicBetPct * 100).toFixed(0)}% public on favorite, line moved ${lineMovement}¢ toward dog`
    };
  }
  return { detected: false };
}
```

### 5. Line freeze

Pinnacle pulling a market off the board = high uncertainty, sharp action they can't price yet.

```typescript
function detectLineFreeze(snapshots: OddsSnapshot[]): boolean {
  const pinnacleSnapshots = snapshots.filter(s => s.book === 'pinnacle');
  const lastTwo = pinnacleSnapshots.slice(-2);
  
  if (lastTwo.length === 2) {
    const gap = new Date(lastTwo[1].captured_at).getTime() - new Date(lastTwo[0].captured_at).getTime();
    return gap > 10 * 60 * 1000;  // 10-minute gap during active polling window
  }
  return false;
}
```

### 6. Sharp/soft divergence (where to place bets)

The gap between Pinnacle/Sbobet and retail soft books reveals stale lines.

```typescript
function computeSharpSoftDivergence(market: MarketSnapshot): number {
  const pinnacle = market.snapshots.find(s => s.book === 'pinnacle');
  const softBooks = market.snapshots.filter(s => 
    ['draftkings', 'fanduel', 'betmgm', 'caesars'].includes(s.book)
  );
  
  if (!pinnacle || softBooks.length === 0) return 0;
  
  const softAvg = softBooks.reduce((sum, s) => sum + s.american_odds, 0) / softBooks.length;
  return softAvg - pinnacle.american_odds;
}
```

**Interpretation:**
- Divergence 3-5¢: minor, normal market lag
- Divergence 5-10¢: stale line, place at soft book if Quant agrees
- Divergence 10¢+: large stale line, urgent

### 7. Walters timing signals

```typescript
function computeTimingSignal(market: MarketSnapshot): TimingSignal {
  const side = market.side;  // 'home', 'draw', or 'away'
  const opening = market.opening_consensus_american;
  const current = market.current_consensus_american;
  const hoursToKickoff = (new Date(market.kickoff).getTime() - Date.now()) / (1000 * 60 * 60);
  
  const isFavorite = (opening < 0);  // negative odds = favorite
  const isDraw = (side === 'draw');
  const isUnderdog = (opening > 0) && !isDraw;
  
  const movement = current - opening;
  
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
      explanation: 'Draw price drifting longer — often value when both teams have something to play for, less when one side is heavily motivated.'
    };
  }
  
  return { signal: 'neutral', explanation: 'No clear timing edge' };
}
```

---

## LLM SYNTHESIS LAYER

Haiku 4.5 generates the human-readable `market_signal_summary` for each market.

### System prompt

```
You are the market analysis component of The Wolfman, a soccer betting agent. You receive structured market data and produce a 1-3 sentence summary of what the market is telling us about a specific match/market.

You do NOT predict outcomes. You do NOT recommend bets. You describe what sharp money has done and what the current state of the market implies.

Style: terse, technical, no fluff. Reference specific books and movements. Use cents (¢) for line movement.

Examples of good outputs:
- "Pinnacle moved Brazil from -200 to -185 over 2 hours; Sbobet followed within 45min. DraftKings still at -210 (25¢ stale). Sharp money on Brazil dog side."
- "Line stuck at France/Senegal Over 2.5 -110 across all books for 12 hours despite Senegal injury news. Likely sharp position holding line."
- "Asian/Western divergence: Sbobet implies 58% Over 2.5, Pinnacle implies 53%. 5¢ gap, Asian books typically lead on soccer totals."
- "Bet365 dropped Argentina ML by 8¢ in the last 30 minutes; Pinnacle followed but DraftKings hasn't moved. Soft books lagging by 10¢+."

Avoid:
- Speculating on why sharps moved
- Predicting the outcome
- Adjectives like "obviously," "clearly," "definitely"
- Any opinion about whether to bet
- Soccer-specific narrative ("Mbappe is hot right now")

Constraints unique to soccer:
- The market has three outcomes (home win, draw, away win). When describing movement, be specific about which side moved.
- Asian handicap quarter lines should be described as "half-stake" splits (e.g., "-0.75 = half on -0.5, half on -1.0")
- When describing totals, soccer typically uses 0.5, 1.5, 2.5, 3.5 — don't refer to "the over" without specifying the line
```

### Inputs to LLM

Structured market context with movement data, signals detected, current best prices, and Pinnacle position.

---

## OUTPUTS

```typescript
interface WolfmanOutput {
  match_id: string;
  analyzed_at: string;
  
  markets: {
    [marketKey: string]: {
      // Snapshot data
      opening_consensus_american: number;
      current_consensus_american: number;
      consensus_no_vig_prob: number;
      
      // Sharp anchor (Pinnacle)
      pinnacle_current_american: number;
      pinnacle_no_vig_prob: number;
      
      // Asian anchor
      sbobet_current_american: number | null;
      sbobet_no_vig_prob: number | null;
      
      // Movement metrics
      total_movement_cents: number;
      movement_direction: string;
      biggest_mover_book: string;
      biggest_mover_cents: number;
      
      // Sharp signals
      rlm_detected: boolean;
      rlm_explanation: string | null;
      steam_detected: boolean;
      steam_explanation: string | null;
      line_freeze_detected: boolean;
      sharp_soft_divergence_cents: number;
      
      // SOCCER-SPECIFIC: Asian/Western divergence
      asian_western_divergence_cents: number;
      asian_western_divergence_explanation: string | null;
      
      // Best price (operator-accessible)
      best_book: string;
      best_book_american: number;
      best_book_decimal: number;
      best_book_tier: 'sharp' | 'sharp_adjacent' | 'soft';
      
      // Walters timing
      timing_signal: 'fav_early' | 'dog_late' | 'draw_drift_value' | 'neutral';
      timing_explanation: string;
      
      // Synthesized commentary (LLM)
      market_signal_summary: string;
    };
  };
  
  cross_market_observations: string[];  // patterns across multiple markets for this match
}
```

---

## BEHAVIORAL RULES

1. **Pinnacle is the truth anchor for outcomes.** Sbobet is the anchor for totals/AH. When sharp money disagrees with our Quant by >4%, surface that disagreement.

2. **Document every snapshot.** Every odds pull goes into `odds_snapshots`. Never overwrite, always append.

3. **3-cent movements warrant attention.** Soccer lines move less than NHL — 3¢ is significant, 5¢ is meaningful, 10¢ is major.

4. **The closing line is sacred.** Capture it precisely at T-1min. Primary CLV benchmark.

5. **Detect line freezes carefully.** A freeze on Pinnacle = strong signal. A freeze on DraftKings = probably just maintenance.

6. **Apply Walters timing.** Especially on three-way markets where draw value varies systematically by hour to kickoff.

7. **Distinguish book tiers.** A 5-cent move on Pinnacle ≠ a 5-cent move on DraftKings. Weight by tier.

8. **Surface stale lines.** If Pinnacle is at -180 and DraftKings is still at -165, that's 15-cent stale line — bet should be placed at DK immediately.

9. **Track Asian markets explicitly.** They're not a curiosity; they're first-class signal sources for soccer totals and Asian handicap.

10. **Don't generate predictions.** You read tape, you don't predict. The Quant predicts, the CEO decides. You inform.

11. **Three-way market awareness.** All market analysis must respect the existence of draws. "Movement toward favorite" without specifying which of three outcomes is incomplete.

---

## CADENCE & POLLING SCHEDULE

(See "Polling schedule" section above. Polling ramps from days-out to minute-by-minute as kickoff approaches.)

---

## FAILURE MODES

### The Odds API down
- Retry with exponential backoff
- After 3 failures: switch to fallback (OddsPortal scraping if available)
- Alert operator via Telegram
- If down >1 hour during match day: PASS all bets pending odds data

### Pinnacle unavailable
- Use Sbobet as backup anchor for totals/AH
- Use Bet365 as backup for outcome markets
- Flag `pinnacle_unavailable: true`

### Asian books unavailable
- Continue with Western books only
- Lose Asian/Western divergence signal
- Flag inputs quality down

### Line freeze on multiple books simultaneously
- Likely breaking news event
- Pause new verdicts on this match until lines unfreeze
- Telegram alert (priority MEDIUM)

### LLM synthesis fails
- Fall back to deterministic template-based summary
- Continue operation

### Closing line capture missed
- Retry at T+30s
- If still missed, use last captured snapshot
- Flag affected bets for manual review

---

## WORKED EXAMPLES

### Example 1: Standard market with mild stale line

**Inputs:**
- Match: France vs Senegal, T-3h
- Market: France Match Outcome (home win)
- Opening (across all books): France -180
- Current consensus: France -195
- Pinnacle: France -200
- Sbobet: France -198
- DraftKings: France -185 (hasn't moved)

**What Wolfman computes:**
- Movement: -15¢ across consensus (toward France)
- Pinnacle position: -200
- DraftKings stale by: 15¢
- Sharp/soft divergence: 15¢
- Asian/Western divergence: 2¢ (negligible)
- Steam: not detected (movement spread over 3h, no 30min window with 1.8+ signal weight)
- Timing: France is favorite, T-3h, post-fav-early window, no clear timing edge

**Output (truncated):**
```json
{
  "markets": {
    "match_outcome_home": {
      "opening_consensus_american": -180,
      "current_consensus_american": -195,
      "pinnacle_current_american": -200,
      "sbobet_current_american": -198,
      "total_movement_cents": -15,
      "movement_direction": "toward_home",
      "sharp_soft_divergence_cents": 15,
      "asian_western_divergence_cents": 2,
      "best_book": "draftkings",
      "best_book_american": -185,
      "best_book_tier": "soft",
      "timing_signal": "neutral",
      "market_signal_summary": "France moved from -180 to -200 at Pinnacle over 3 hours; Sbobet followed. DraftKings still at -185 (15¢ stale). Sharp side is France but soft books are lagging."
    }
  }
}
```

### Example 2: Asian/Western divergence on totals

**Inputs:**
- Match: Spain vs Germany, T-12h
- Market: Total Over 2.5
- Pinnacle: -110
- Bet365: -108
- DraftKings: -110
- Sbobet: -125
- IBC: -123

**What Wolfman computes:**
- Western no-vig prob: ~52%
- Asian no-vig prob: ~57%
- Divergence: 5¢
- Best price for Over 2.5 (operator accessible): DraftKings -110

**Output (truncated):**
```json
{
  "markets": {
    "total_over_2.5": {
      "pinnacle_current_american": -110,
      "sbobet_current_american": -125,
      "asian_western_divergence_cents": 5,
      "asian_western_divergence_explanation": "Sbobet/IBC implying 57% Over 2.5, Pinnacle implying 52%. Asian books typically lead Western on soccer totals.",
      "best_book": "draftkings",
      "best_book_american": -110,
      "market_signal_summary": "Asian/Western divergence on Spain-Germany Over 2.5: Sbobet at -125 vs Pinnacle at -110. Asian books historically lead on soccer totals — sharp side likely Over."
    }
  }
}
```

This is a textbook actionable signal. If the Quant also says Over 2.5 is value, this becomes a STRIKE candidate.

### Example 3: Steam move on Matchday 3 motivation game

**Inputs:**
- Brazil vs Cameroon (Brazil already qualified, expected to rotate)
- Market: Cameroon Money Line
- Opening (3 days ago): Cameroon +600
- Yesterday: Cameroon +450 (drift toward Cameroon)
- Last 30 min: Pinnacle moved Cameroon from +400 to +360, Sbobet from +395 to +355, Bet365 from +420 to +380. DraftKings still at +400.

**What Wolfman detects:**
- 30-min movement: -40¢ on Pinnacle, -40¢ on Sbobet, -40¢ on Bet365
- Signal weight: Pinnacle 1.0 + Sbobet 1.0 + Bet365 0.6 = 2.6
- Threshold 1.8 exceeded → STEAM
- DK still at +400, stale by ~40¢
- Timing: dog late, line drifting favorable

**Output (truncated):**
```json
{
  "markets": {
    "match_outcome_away": {
      "opening_consensus_american": 600,
      "current_consensus_american": 365,
      "pinnacle_current_american": 360,
      "total_movement_cents": -235,
      "steam_detected": true,
      "steam_explanation": "Steam: Pinnacle, Sbobet, Bet365 all moved Cameroon ML ≥40¢ in 30min window. Signal weight 2.6.",
      "best_book": "draftkings",
      "best_book_american": 400,
      "best_book_tier": "soft",
      "timing_signal": "dog_late",
      "market_signal_summary": "Steam on Cameroon ML at T-2h: Pinnacle/Sbobet/Bet365 all moved -40¢ in 30min. DK still at +400 (40¢ stale). Sharp money loading Cameroon — likely catching the rotation/motivation differential."
    }
  }
}
```

This is the canonical Walters tournament edge case: rotating favorite, motivated underdog, sharps moving aggressively, retail lagging. If the Quant+Tactician math agrees, this is a max-conviction STRIKE.

---

## TESTING CRITERIA

The Wolfman is "working" when:

1. **Capture reliability:** Successfully captures odds on ≥98% of scheduled poll intervals
2. **Closing line accuracy:** T-1min snapshot occurs within ±60 seconds, 100% of the time
3. **Steam detection:** Manually validated steam moves identified correctly ≥85% of the time
4. **Asian/Western divergence:** Detected when actual divergence exceeds threshold in 100% of test cases
5. **Best price accuracy:** Best book identification matches manual review 100% of the time
6. **LLM commentary quality:** Summaries pass operator review — terse, technical, no speculation
7. **Performance:** Full match analysis completes in <15 seconds
8. **Cost discipline:** Stays within $3/day API budget during World Cup
9. **Three-way handling:** Draw signal tracked separately from home/away in all market analysis

---

## CONFIGURATION

### `/agents/wolfman/config/books.json`

```json
{
  "tier_1_sharp": [
    {"key": "pinnacle", "display": "Pinnacle", "operator_accessible": false, "region": "global"},
    {"key": "sbobet", "display": "Sbobet", "operator_accessible": false, "region": "asian"},
    {"key": "ibc", "display": "IBC / 188bet", "operator_accessible": false, "region": "asian"}
  ],
  "tier_2_sharp_adjacent": [
    {"key": "bet365_eu", "display": "Bet365 (EU)", "operator_accessible": false, "region": "european"},
    {"key": "caesars_vegas", "display": "Caesars (Vegas sharp)", "operator_accessible": false, "region": "us"},
    {"key": "stake", "display": "Stake", "operator_accessible": false, "region": "global"}
  ],
  "tier_3_soft_retail": [
    {"key": "draftkings", "display": "DraftKings", "operator_accessible": true, "region": "us"},
    {"key": "fanduel", "display": "FanDuel", "operator_accessible": true, "region": "us"},
    {"key": "betmgm", "display": "BetMGM", "operator_accessible": true, "region": "us"},
    {"key": "bet365_ontario", "display": "Bet365 (Ontario)", "operator_accessible": true, "region": "canada"},
    {"key": "caesars", "display": "Caesars (retail)", "operator_accessible": true, "region": "us"},
    {"key": "bovada", "display": "Bovada", "operator_accessible": true, "region": "offshore"}
  ]
}
```

### `/agents/wolfman/config/detection_thresholds.json`

```json
{
  "steam_detection": {
    "window_minutes": 30,
    "movement_threshold_cents": 3,
    "signal_weight_threshold": 1.8,
    "tier_weights": {
      "sharp": 1.0,
      "sharp_adjacent": 0.6,
      "soft": 0.3
    }
  },
  "rlm_detection": {
    "public_bet_threshold_pct": 0.65,
    "line_movement_threshold_cents": 3
  },
  "line_freeze": {
    "expected_update_interval_minutes": 10,
    "trigger_gap_minutes": 10
  },
  "sharp_soft_divergence": {
    "minor_threshold_cents": 3,
    "significant_threshold_cents": 5,
    "urgent_threshold_cents": 10
  },
  "asian_western_divergence": {
    "minor_threshold_cents": 3,
    "actionable_threshold_cents": 4,
    "urgent_threshold_cents": 8
  }
}
```

---

## RELATED FILES

- `01_MASTER_ORCHESTRATION.md` — when Wolfman runs
- `05_AGENT_CEO.md` — consumes market intelligence for STRIKE/PASS
- `06_AGENT_TREASURER.md` — uses closing line data for CLV
- `07_SHARED_CONTRACTS.md` — `odds_snapshots` and `market_intelligence` schemas
