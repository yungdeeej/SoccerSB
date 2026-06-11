# 06 — THE TREASURER

## Bankroll, Sizing & Performance (Soccer)

**Model:** None — deterministic math + ledger (TypeScript)
**Type:** Append-only ledger with stake calculator and CLV engine
**Cadence:** On-demand (called by CEO before STRIKE), continuous (post-match CLV), daily reports (8am MT)
**Owns tables:** `bankroll_ledger`, `bets`, performance views
**Estimated cost:** $0

---

## IDENTITY

You are **The Treasurer**. You hold the purse. You compute the stakes. You enforce stop-losses. You score performance honestly.

This agent is largely portable from the NHL system — bankroll math is sport-agnostic. Soccer-specific differences are noted throughout.

You execute math against a ledger and return numbers. No opinion, no LLM, no prediction.

Your job: make sure the syndicate is solvent next month. Every other agent finds edge. Your job is to make sure that edge converts to bankroll growth — not blown up by sizing errors, tilt-betting, or chasing losses.

---

## CORE RESPONSIBILITIES

1. **Bankroll accounting** — track every dollar in/out, append-only
2. **Kelly stake calculation** — quarter-Kelly with hard caps and floors
3. **Daily bet cap enforcement** — 5 group stage / 3 knockout
4. **Stop-loss enforcement** — escalating drawdown responses
5. **CLV computation** — post-match closing line value
6. **Performance reporting** — daily/weekly/monthly P&L and CLV
7. **Capital allocation gating** — tell CEO if capital available

---

## SOCCER-SPECIFIC DIFFERENCES FROM NHL

| Aspect | NHL | Soccer |
|---|---|---|
| Daily bet cap | 4 | 5 group / 3 knockout |
| Per-match bet cap | 1 | 1 |
| CLV sharp threshold | +1.5¢ rolling 30d | +0.5¢ rolling 30d (markets sharper) |
| CLV marginal threshold | +0.5¢ | +0.0¢ |
| Stop-loss reduced state | 15% drawdown | 12% drawdown (tighter — tournament is short) |
| Stop-loss halt | 25% drawdown | 20% drawdown (tighter) |
| Live-mode first-week sizing | Half-Kelly | Half-Kelly |
| Live-mode first-week cap | 3/day | 3/day group, 2/day knockout |

The tighter thresholds reflect: (1) sharper soccer markets mean smaller "true" CLV signals look like edge faster, (2) the tournament is short (5 weeks vs an NHL season) so drawdown protection matters more, (3) less margin for error.

---

## INPUTS

```typescript
interface StakeRequest {
  match_id: string;
  market: string;
  side: string;
  adjusted_win_prob: number;
  american_odds: number;
  decimal_odds: number;
  book: string;
  edge_pct: number;
  low_confidence_flag: boolean;
  tournament_stage: string;
}

interface LedgerEntry {
  type: 'bet_placed' | 'bet_settled' | 'deposit' | 'withdrawal' | 'adjustment';
  amount_cents: number;
  reference_id: string;
  notes: string;
  source: 'ceo_verdict' | 'manual' | 'system';
}

interface CLVRequest {
  bet_id: string;
  closing_line_american: number;
  closing_line_no_vig_prob: number;
}
```

---

## OUTPUTS

```typescript
interface StakeResponse {
  approved: boolean;
  recommended_stake_cents: number | null;
  kelly_fraction_full: number;
  kelly_fraction_used: number;
  bankroll_pct: number;
  cap_reasoning: string;
  rejection_reason: string | null;
  capital_snapshot: TreasurerSnapshot;
}

interface TreasurerSnapshot {
  active_bankroll_cents: number;
  total_capital_cents: number;
  pending_wagers_cents: number;
  available_capital_cents: number;
  
  peak_bankroll_cents: number;
  peak_reached_at: string;
  drawdown_pct_from_peak: number;
  
  stop_loss_active: 'none' | 'reduced_kelly' | 'halt';
  stop_loss_reason: string | null;
  stop_loss_resumes_at: string | null;
  
  todays_bet_count: number;
  todays_bets_by_match: Map<string, number>;
  daily_bet_cap: number;  // 5 group stage, 3 knockout
  
  this_week_clv_cents: number;
  this_month_clv_cents: number;
  rolling_30d_clv_cents: number;
  clv_classification: 'sharp' | 'marginal' | 'break_even' | 'below_replacement';
  
  current_kelly_fraction: number;
  daily_bet_cap_effective: number;
}
```

---

## KELLY SIZING ENGINE

```typescript
function calculateStake(req: StakeRequest, snapshot: TreasurerSnapshot): StakeResponse {
  
  // Step 1: Full Kelly
  const b = req.decimal_odds - 1;
  const p = req.adjusted_win_prob;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  
  if (fullKelly <= 0) {
    return {
      approved: false,
      rejection_reason: 'kelly_non_positive',
      cap_reasoning: 'No positive Kelly fraction',
      ...
    };
  }
  
  // Step 2: Apply Kelly fraction (quarter by default; halved in reduced state)
  const baseKellyFraction = 0.25;
  const effectiveKellyFraction = snapshot.stop_loss_active === 'reduced_kelly'
    ? baseKellyFraction / 2  // 0.125
    : baseKellyFraction;
  
  let kellyStakePct = fullKelly * effectiveKellyFraction;
  
  // Step 3: Low-confidence halving
  if (req.low_confidence_flag) kellyStakePct *= 0.5;
  
  // Step 4: Tournament stage adjustment
  // Knockout matches have correlated risk (loss eliminates team) — slightly reduce
  if (['r32', 'r16', 'qf', 'sf', 'final'].includes(req.tournament_stage)) {
    kellyStakePct *= 0.85;
  }
  
  // Step 5: Hard cap and floor
  const HARD_CAP_PCT = 0.03;
  const FLOOR_CENTS = 2000;
  
  let stake_cents = Math.round(kellyStakePct * snapshot.active_bankroll_cents);
  let capReasoning = `Quarter-Kelly: ${(kellyStakePct * 100).toFixed(2)}% of bankroll`;
  
  const hardCapCents = Math.round(HARD_CAP_PCT * snapshot.active_bankroll_cents);
  if (stake_cents > hardCapCents) {
    stake_cents = hardCapCents;
    capReasoning = `Capped at 3% hard cap ($${(hardCapCents / 100).toFixed(2)})`;
  }
  
  if (stake_cents < FLOOR_CENTS) {
    return {
      approved: false,
      rejection_reason: 'stake_below_floor',
      cap_reasoning: `Computed stake $${(stake_cents / 100).toFixed(2)} below $20 floor`,
      ...
    };
  }
  
  // Step 6: Available capital check
  if (stake_cents > snapshot.available_capital_cents) {
    if (snapshot.available_capital_cents >= FLOOR_CENTS) {
      stake_cents = snapshot.available_capital_cents;
      capReasoning = `Reduced to fit available capital`;
    } else {
      return {
        approved: false,
        rejection_reason: 'insufficient_capital',
        ...
      };
    }
  }
  
  return {
    approved: true,
    recommended_stake_cents: stake_cents,
    kelly_fraction_full: fullKelly,
    kelly_fraction_used: effectiveKellyFraction,
    bankroll_pct: (stake_cents / snapshot.active_bankroll_cents) * 100,
    cap_reasoning: capReasoning,
    rejection_reason: null,
    capital_snapshot: snapshot
  };
}
```

### Sizing rules summary

| Rule | Value | Rationale |
|---|---|---|
| Base Kelly fraction | 0.25 | Standard quarter-Kelly |
| Hard cap | 3% of bankroll | Walters 1-3% range, upper end |
| Floor | $20 | Below this, not worth the action |
| Low-confidence multiplier | 0.5x | Quant uncertainty reduces exposure |
| Reduced-state Kelly | 0.125 | Drawdown protection |
| Knockout stage multiplier | 0.85x | Correlated risk in eliminations |
| Daily bet cap (group) | 5 | Tournament tempo demands flexibility |
| Daily bet cap (knockout) | 3 | Higher stakes, less variance forgiveness |
| Live-mode first week | Half-Kelly + cap 3/2 | Calibration window |

---

## STOP-LOSS LOGIC (TIGHTER THAN NHL)

Tournament is 5 weeks long; drawdown protection has to act faster.

### Drawdown levels

```typescript
function evaluateStopLossState(currentCents: number, peakCents: number): StopLossState {
  const drawdownPct = ((peakCents - currentCents) / peakCents) * 100;
  
  if (drawdownPct >= 20) {  // TIGHTER than NHL's 25
    return {
      level: 'halt',
      reason: `Bankroll down ${drawdownPct.toFixed(1)}% from peak`,
      action: 'No new bets. Manual review required.',
      resumes_at: null,
      kelly_modifier: 0
    };
  }
  
  if (drawdownPct >= 12) {  // TIGHTER than NHL's 15
    const resumesAt = new Date();
    resumesAt.setDate(resumesAt.getDate() + 7);  // 7 days (was 14 for NHL)
    
    return {
      level: 'reduced_kelly',
      reason: `Bankroll down ${drawdownPct.toFixed(1)}%. Half-Kelly active 7 days.`,
      action: 'Continue at half-Kelly. Daily cap reduced.',
      resumes_at: resumesAt.toISOString(),
      kelly_modifier: 0.5,
      daily_cap_override: 3
    };
  }
  
  return { level: 'none', kelly_modifier: 1.0 };
}
```

### Daily cooldown rules

| Trigger | Action |
|---|---|
| 2 consecutive losses today | 30-min pause before next STRIKE |
| 3 losses in a day | Cap to current count (no more today) |
| Down >5% today | Cap to current + 1 (one more shot, then done) |
| Won 3 of first 3 today | No restriction (ride the streak, cap stays) |

### Upside management

When bankroll up 20% from baseline, prompt operator: compound or withdraw. System doesn't auto-withdraw; decision is operator's.

---

## CLV COMPUTATION

```typescript
function computeCLV(bet: Bet, closingLine: ClosingLine): CLVResult {
  const betDecimal = americanToDecimal(bet.american_odds);
  const betImpliedRaw = 1 / betDecimal;
  
  // Strip vig from bet's price using the opposing side
  const betNoVigProb = stripVigSingleSide(
    bet.american_odds, 
    bet.opposing_side_american
  );
  
  const closingNoVigProb = closingLine.no_vig_prob;
  
  // CLV in cents
  const clv_cents = (closingNoVigProb - betNoVigProb) * 100;
  
  let classification: 'beat_close' | 'matched_close' | 'lost_to_close';
  if (clv_cents > 0.5) classification = 'beat_close';
  else if (clv_cents < -0.5) classification = 'lost_to_close';
  else classification = 'matched_close';
  
  return {
    bet_id: bet.id,
    bet_no_vig_prob: betNoVigProb,
    closing_no_vig_prob: closingNoVigProb,
    clv_cents,
    clv_classification: classification,
    weeks_rolling_clv_cents: computeRollingCLV(7)
  };
}
```

### CLV classification tiers (TIGHTER than NHL)

| Rolling 30d CLV | Classification | Interpretation |
|---|---|---|
| ≥ +0.5¢ | sharp | Real edge in efficient soccer market |
| 0 to +0.5¢ | marginal | Some edge, vulnerable to variance |
| -0.5 to 0¢ | break_even | No demonstrated edge |
| < -0.5¢ | below_replacement | System losing to market |

These thresholds are lower than NHL because soccer markets are sharper — positive CLV of any size in soccer is meaningful.

---

## LEDGER ARCHITECTURE

### Schema (append-only)

```sql
CREATE TABLE bankroll_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  entry_type TEXT NOT NULL,
  amount_cents BIGINT NOT NULL,
  balance_after_cents BIGINT NOT NULL,
  reference_id UUID,
  notes TEXT,
  source TEXT NOT NULL,
  
  peak_bankroll_at_entry_cents BIGINT,
  drawdown_pct_at_entry NUMERIC(5,2),
  stop_loss_state_at_entry TEXT,
  
  CHECK (entry_type IN ('bet_placed', 'bet_settled', 'deposit', 'withdrawal', 'adjustment')),
  CHECK (source IN ('ceo_verdict', 'manual', 'system_settlement', 'system_adjustment'))
);

CREATE INDEX idx_ledger_occurred_at ON bankroll_ledger(occurred_at DESC);
CREATE INDEX idx_ledger_reference ON bankroll_ledger(reference_id);
```

### Sample flow

```
Time      | Type           | Amount | Balance | Notes
----------|----------------|--------|---------|--------------------------
Jun 11 09:00 | deposit      | +$5000 | $5000  | Initial World Cup bankroll
Jun 11 14:30 | bet_placed   | -$150  | $4850  | Mexico ML +195 @ Bet365 Ontario
Jun 11 17:00 | bet_settled  | +$443  | $5293  | Mexico ML won, payout $443
Jun 12 08:00 | bet_placed   | -$120  | $5173  | Brazil/Cameroon U2.5 -115 @ DK
Jun 12 16:30 | bet_settled  | -$0    | $5173  | U2.5 lost (no payout)
...
```

bet_placed debits stake immediately. bet_settled credits full payout (stake + profit) on win, zero on loss, stake-back on push.

---

## DAILY OPERATIONS

### Morning report (8am MT)

```typescript
async function generateDailyReport() {
  const snapshot = await getCurrentSnapshot();
  const yesterdayBets = await getBetsForDate(getYesterday());
  const settled = yesterdayBets.filter(b => b.settlement_status === 'settled');
  
  return {
    date: today,
    
    bankroll: {
      current: snapshot.active_bankroll_cents,
      change_24h: ..., change_7d: ..., change_tournament: ...,
      drawdown_from_peak_pct: snapshot.drawdown_pct_from_peak
    },
    
    yesterday: {
      bets_placed: yesterdayBets.length,
      won: settled.filter(b => b.outcome === 'win').length,
      lost: settled.filter(b => b.outcome === 'loss').length,
      pushed: settled.filter(b => b.outcome === 'push').length,
      total_staked_cents: yesterdayBets.reduce((s, b) => s + b.stake_cents, 0),
      net_pl_cents: settled.reduce((s, b) => s + b.pl_cents, 0),
      avg_clv_cents: average(settled.map(b => b.clv_cents))
    },
    
    rolling: {
      last_7d_pl_cents, last_7d_clv_cents,
      tournament_total_pl_cents, tournament_total_clv_cents,
      tournament_record: '12W-8L-2P'
    },
    
    state: {
      stop_loss_active: snapshot.stop_loss_active,
      kelly_fraction_current: snapshot.current_kelly_fraction,
      daily_cap_effective: snapshot.daily_bet_cap_effective
    },
    
    today_matches: getMatchesScheduledToday()
  };
}
```

Sent via Telegram at 8am MT.

### Post-match settlement

```typescript
async function settleBet(bet_id: string, matchResult: MatchResult) {
  const bet = await getBet(bet_id);
  const outcome = determineOutcome(bet.market, bet.side, matchResult);
  
  let pl_cents, payout_cents;
  if (outcome === 'win') {
    const decimal = americanToDecimal(bet.american_odds);
    payout_cents = Math.round(bet.stake_cents * decimal);
    pl_cents = payout_cents - bet.stake_cents;
  } else if (outcome === 'loss') {
    payout_cents = 0;
    pl_cents = -bet.stake_cents;
  } else if (outcome === 'push') {
    payout_cents = bet.stake_cents;
    pl_cents = 0;
  } else if (outcome === 'half_win') {  // Asian handicap half-stake outcomes
    payout_cents = Math.round(bet.stake_cents * (1 + (decimal - 1) / 2));
    pl_cents = payout_cents - bet.stake_cents;
  } else if (outcome === 'half_loss') {
    payout_cents = Math.round(bet.stake_cents / 2);
    pl_cents = -Math.round(bet.stake_cents / 2);
  }
  
  await updateBet(bet_id, { outcome, payout_cents, pl_cents, settled_at: now() });
  
  if (payout_cents > 0) {
    await appendLedger({
      entry_type: 'bet_settled',
      amount_cents: payout_cents,
      reference_id: bet_id,
      notes: `${bet.market} ${bet.side} ${outcome}`,
      source: 'system_settlement'
    });
  }
  
  // Compute CLV
  const closingLine = await getClosingLine(bet.match_id, bet.market, bet.side);
  if (closingLine) {
    const clv = computeCLV(bet, closingLine);
    await updateBet(bet_id, { ...clv });
  }
  
  // Re-evaluate stop-loss
  const newSnapshot = await getCurrentSnapshot();
  if (newSnapshot.stop_loss_active !== bet.stop_loss_state_at_placement) {
    await alertOperator({
      priority: newSnapshot.stop_loss_active === 'halt' ? 'CRITICAL' : 'HIGH',
      message: `Stop-loss state changed: ${newSnapshot.stop_loss_active}`
    });
  }
}
```

**Soccer-specific:** Asian handicap quarter lines settle as half-win or half-loss. Must handle both outcomes in settlement logic.

---

## BEHAVIORAL RULES

1. **Append-only ledger.** Never mutate. Every change is new row with timestamp.
2. **Integer cents only.** All money as BigInt. Floats corrupt ledgers.
3. **Atomicity.** Bet placement + ledger entry = single transaction. If ledger fails, bet not recorded.
4. **Size for survival.** Default to under-betting, not over-betting.
5. **Stop-loss is the law.** Cannot be overridden except by explicit operator command.
6. **CLV is truth.** Track relentlessly. Surface daily. Negative 30-day CLV → surface the problem.
7. **Daily cap is hard.** 5 group / 3 knockout. No exceptions.
8. **Reduced state is automatic.** 12% drawdown triggers half-Kelly. Operator doesn't have to remember.
9. **Halt requires acknowledgment.** 20% drawdown requires manual resume. Prevents emotional revenge betting.
10. **Honesty over comfort.** Daily report says the truth plainly. No softening.

---

## CADENCE & TRIGGERS

### Continuous (event-driven)
- CEO requests stake calculation → respond synchronously
- Bet placement confirmed by operator → append ledger entry
- Match ends → trigger settlement workflow
- Wolfman captures closing line → compute CLV

### Scheduled
- **8am MT daily** → generate daily report, Telegram
- **Monday 8am MT** → weekly summary
- **Every 6 hours** → recompute stop-loss state

### Manual
- Operator deposits/withdraws → manual ledger entry via dashboard
- Operator resumes from halt → log resume event
- Operator requests forced report → ad-hoc

---

## FAILURE MODES

- **Database lost** → CEO auto-PASSes all. Telegram CRITICAL.
- **Ledger integrity violation** (should be impossible by design) → HALT, CRITICAL alert.
- **Settlement data unavailable** → allow manual settlement via dashboard.
- **CLV computation fails** → settle bet correctly, mark CLV null with reason.
- **Concurrent stake requests for same match** → lock by match_id. Prevents double-betting.

---

## WORKED EXAMPLES

### Example 1: Standard Kelly

**Inputs:**
- Bankroll $5,000
- Adjusted prob 0.55
- American +130 (decimal 2.30)
- Edge 3.5%
- Not low confidence
- Group stage
- No stop-loss active

```
b = 1.30, p = 0.55, q = 0.45
full_kelly = (1.30 × 0.55 - 0.45) / 1.30 = 0.2 = 20%
quarter_kelly = 5%
stake = 5% × $5000 = $250

Hard cap: 3% × $5000 = $150 — TRIGGERED
Capped: $150
```

**Response:** approved, $150, capped at hard cap.

### Example 2: Drawdown triggers reduced state

**Inputs:**
- Peak $6,000, current $5,250
- Drawdown 12.5%

```
12.5% ≥ 12% threshold → reduced_kelly
7-day timer starts
Daily cap reduced 5 → 3
Kelly modifier 0.5
```

**Telegram alert:**
```
⚠️ STOP-LOSS: REDUCED KELLY ACTIVE

Bankroll: $5,250 (down 12.5% from peak $6,000)
Action: Half-Kelly sizing for 7 days
Daily cap: reduced to 3 bets
Auto-resumes: June 19 if recovered

Per Walters: stay disciplined through drawdown. Variance is normal.
```

### Example 3: Halt state

**Inputs:**
- Peak $6,000, current $4,750
- Drawdown 20.8% ≥ 20% threshold → HALT

All stake requests rejected:
```json
{
  "approved": false,
  "rejection_reason": "stop_loss_halt",
  "cap_reasoning": "Bankroll down 20.8% from peak. Manual resume required."
}
```

**Telegram CRITICAL:**
```
🛑 STOP-LOSS HALT TRIGGERED

Bankroll: $4,750 (down 20.8% from peak $6,000)
All new bets BLOCKED.

Step back. Review recent bets. Look at CLV trend.

To resume: send "/treasurer resume" via Telegram.

Per Walters Chapter 21: "Chasing losses is a recipe for disaster."
```

### Example 4: CLV computation

**Inputs:**
- Bet: Mexico ML +195 (decimal 2.95)
- Closing line: Mexico +175 (decimal 2.75), Pinnacle no-vig 36.5%

```
bet_implied_raw = 1/2.95 = 33.9%
bet_no_vig (using opposing side strip) ≈ 32.8%
closing_no_vig = 36.5%

clv_cents = (36.5 - 32.8) × 100 = 3.7¢
Classification: beat_close
```

Strong positive CLV. Line moved 20¢ toward Mexico after we bet at +195. Demonstrates real edge regardless of match outcome.

---

## DAILY REPORT SAMPLE (Telegram, 8am MT)

```
📊 DAILY TREASURER REPORT — June 14, 2026

BANKROLL
Current: $5,420.50
24h change: +$210 (+4.0%)
Tournament total: +$420.50 (+8.4%)
From peak: -2.1% (peak $5,540)

YESTERDAY
Bets: 3 placed, 3 settled (2W-1L)
Staked: $480
Net P&L: +$210
Avg CLV: +1.8¢ (sharp)

TOURNAMENT TO DATE
Bets: 14 placed
Record: 9W-4L-1P
ROI: +12.3%
Avg CLV: +1.2¢ (sharp)
Win rate: 69% (vs 52.4% breakeven)

STATE
Stop-loss: NONE
Kelly fraction: 0.25 (quarter)
Daily cap: 5 (group stage)

TODAY'S MATCHES
- France vs Senegal (15:00 ET) — 1 STRIKE active
- Brazil vs Morocco (18:00 ET) — under review
- Argentina vs Iraq (21:00 ET) — WATCH (line not aligned)

✅ System healthy. Continue with discipline.
```

---

## CONFIGURATION

### `/agents/treasurer/config/parameters.json`

```json
{
  "kelly": {
    "base_fraction": 0.25,
    "reduced_state_fraction": 0.125,
    "low_confidence_multiplier": 0.5,
    "knockout_stage_multiplier": 0.85,
    "hard_cap_pct": 0.03,
    "floor_cents": 2000
  },
  
  "discipline": {
    "daily_bet_cap_group": 5,
    "daily_bet_cap_knockout": 3,
    "daily_bet_cap_reduced_state": 3,
    "one_bet_per_match": true,
    "cooldown_after_2_losses_minutes": 30,
    "cooldown_after_3_losses_today": "halt_remaining_day",
    "daily_drawdown_5pct_reduce_cap": true
  },
  
  "stop_loss": {
    "reduced_state_drawdown_pct": 0.12,
    "reduced_state_duration_days": 7,
    "halt_drawdown_pct": 0.20,
    "halt_requires_manual_resume": true
  },
  
  "upside": {
    "compound_withdraw_prompt_gain_pct": 0.20,
    "prompt_cadence_days": 14
  },
  
  "clv": {
    "sharp_threshold_cents": 0.5,
    "marginal_threshold_cents": 0.0,
    "rolling_window_days": 30
  },
  
  "live_mode": {
    "first_week_use_half_kelly": true,
    "first_week_daily_cap_group": 3,
    "first_week_daily_cap_knockout": 2
  }
}
```

---

## TESTING CRITERIA

1. **Ledger integrity:** sum of all amounts == latest balance_after_cents across 10K simulated entries
2. **Kelly math:** verified against quarter-Kelly tables on 100 test inputs
3. **Cap behavior:** hard cap triggers when full Kelly > 3%
4. **Floor behavior:** triggers when computed stake < $20
5. **Stop-loss triggers:** reduced at exactly 12%, halt at exactly 20%
6. **Stop-loss release:** reduced auto-releases after 7 days only if recovered above threshold
7. **CLV accuracy:** verified against manual computation on 50 historical bets
8. **Daily cap:** holds correctly across timezone boundaries
9. **Atomicity:** transaction rollback verified by interrupting mid-write
10. **Performance:** stake calculation < 50ms
11. **Asian handicap settlement:** half-win/half-loss outcomes computed correctly

---

## RELATED FILES

- `01_MASTER_ORCHESTRATION.md` — when Treasurer runs
- `05_AGENT_CEO.md` — primary caller for stake calculation
- `04_AGENT_WOLFMAN.md` — provides closing line for CLV
- `07_SHARED_CONTRACTS.md` — `bankroll_ledger` and `bets` schemas
