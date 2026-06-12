# CLAUDE CODE — PHASE 4 EXECUTION PROMPT

## The Pitch — The Treasurer (Bankroll, Kelly, Stop-Loss, CLV)

## Copy everything below this line into Claude Code

---

You are completing the v1 build of **The Pitch**. Phases 0, 1, 2a, 2b, and 3 are complete:

- Foundation laid (Phase 0)
- Market intelligence skeleton with live odds (Phase 1)
- Quant statistical model with passed backtest (Phase 2a)
- Tactician situational engine with 11 factor modules (Phase 2b)
- CEO with discipline gates + full Wolfman with LLM synthesis (Phase 3)

Phase 4 is **The Treasurer** — the final piece. Real Kelly sizing tied to live bankroll, stop-loss state machine, automatic CLV computation, daily reporting, and concurrent stake request locking.

After Phase 4, the system is feature-complete for v1. The operator has a fully automated betting intelligence pipeline that identifies edges, applies discipline, sizes bets correctly, tracks performance, and enforces drawdown protection — all advisory, with manual bet placement.

## YOUR FIRST ACTIONS — BEFORE WRITING CODE

1. Inspect actual Phase 0-3 implementation:
   - `/src/db/schema.ts` — `bankroll_ledger`, `bets`, `verdicts` exact columns
   - `/src/shared/utils/kelly.ts` — the calculateKellyStake utility from Phase 0
   - `/src/agents/treasurer/stub.ts` — the placeholder stub from Phase 3 (you're replacing it)
   - `/src/agents/ceo/index.ts` — how CEO calls Treasurer (you must not break this interface)
   - `/src/agents/wolfman/` — closing line capture flow (you'll consume `is_closing_line: true` snapshots for CLV)

2. Read `/docs/worldcup_prompts/06_AGENT_TREASURER.md` in full. This is your Treasurer build spec.

3. Re-read `/docs/worldcup_prompts/00_WALTERS_FOR_SOCCER.md` — bankroll discipline principles.

4. **Report drift first.** Reply with:
   - Schema fields actually present vs spec
   - The Treasurer stub's current interface (exact function signatures and return shapes)
   - How Phase 3's CEO consumes the stub
   - Your Phase 4 build plan

Wait for nothing — proceed after reporting.

## CRITICAL — THE STUB INTERFACE IS THE CONTRACT

Phase 3 built `/src/agents/treasurer/stub.ts` with a specific `TreasurerSnapshot` shape and `computePlaceholderStake` function. The CEO already imports these.

**Phase 4 must:**
- Replace stub implementations with real ones
- Maintain the exact same function signatures and return shapes
- Ensure CEO continues to work without modification (the interface is the contract)

If you find that the stub interface diverged from the `06_AGENT_TREASURER.md` spec, the stub wins for backward compatibility. You may extend the interface with new fields, but cannot break existing ones.

## CRITICAL — INHERIT THE LEAN PHILOSOPHY

Phase 4 layers in:

**Computed from ledger (single source of truth):**
- Current bankroll (sum of all ledger entries)
- Peak bankroll (max balance_after_cents in ledger history)
- Drawdown percentage (current vs peak)
- Stop-loss state (derived from drawdown thresholds)
- Today's bet count (from bets table where placed_at within today MT)

**Computed from bets table:**
- Pending wagers (bets where settlement_status = pending)
- CLV per bet (when closing line available)
- Rolling CLV windows (7d, 30d)
- CLV classification (sharp/marginal/break_even/below_replacement)

**Written by Treasurer:**
- New `bankroll_ledger` rows on bet placement, settlement, deposit, withdrawal
- CLV fields on `bets` rows when settling
- Daily report records (in `agent_runs.outputs_summary` for now — no separate table needed)

**NEVER cached/seeded:**
- Bankroll values
- CLV computations
- Stop-loss state

These are always derived from append-only ledger + bets table.

## PHASE 4 DELIVERABLES

### 1. Real `getTreasurerSnapshot()`

`/src/agents/treasurer/snapshot.ts`:

Replace the stub with real implementation that computes everything from the database.

```typescript
export async function getTreasurerSnapshot(): Promise<TreasurerSnapshot> {
  const [
    ledgerStats,
    pendingBets,
    todaysBets,
    clvStats,
    matchesByDate
  ] = await Promise.all([
    computeLedgerStats(),
    getPendingBets(),
    getTodaysBets(),
    computeRollingCLV(),
    getTodaysMatches()
  ]);
  
  const stopLossState = evaluateStopLossState(ledgerStats.current_cents, ledgerStats.peak_cents);
  
  return {
    active_bankroll_cents: ledgerStats.current_cents,
    total_capital_cents: ledgerStats.current_cents + pendingBets.total_stake_cents,
    pending_wagers_cents: pendingBets.total_stake_cents,
    available_capital_cents: ledgerStats.current_cents,
    
    peak_bankroll_cents: ledgerStats.peak_cents,
    peak_reached_at: ledgerStats.peak_reached_at,
    drawdown_pct_from_peak: ledgerStats.drawdown_pct,
    
    stop_loss_active: stopLossState.level,
    stop_loss_reason: stopLossState.reason,
    stop_loss_resumes_at: stopLossState.resumes_at,
    
    todays_bet_count: todaysBets.count,
    todays_bets_by_match: todaysBets.byMatch,
    daily_bet_cap: getDailyCap(todaysBets.tournament_stage),
    
    this_week_clv_cents: clvStats.week,
    this_month_clv_cents: clvStats.month,
    rolling_30d_clv_cents: clvStats.rolling30d,
    clv_classification: classifyCLV(clvStats.rolling30d),
    
    current_kelly_fraction: stopLossState.kelly_modifier * BASE_KELLY_FRACTION,
    daily_bet_cap_effective: stopLossState.daily_cap_override || getDailyCap(todaysBets.tournament_stage)
  };
}
```

#### Helper: `computeLedgerStats`

```typescript
async function computeLedgerStats(): Promise<LedgerStats> {
  const entries = await db.select().from(bankroll_ledger).orderBy(asc(bankroll_ledger.occurred_at));
  
  if (entries.length === 0) {
    throw new Error('Bankroll ledger is empty — Phase 0 should have initialized this');
  }
  
  const current = entries[entries.length - 1].balance_after_cents;
  
  let peak = BigInt(0);
  let peakReachedAt = entries[0].occurred_at;
  
  for (const entry of entries) {
    if (entry.balance_after_cents > peak) {
      peak = entry.balance_after_cents;
      peakReachedAt = entry.occurred_at;
    }
  }
  
  const drawdownPct = peak > 0 
    ? Number((peak - current) * BigInt(10000) / peak) / 100 
    : 0;
  
  return { current_cents: current, peak_cents: peak, peak_reached_at: peakReachedAt, drawdown_pct: drawdownPct };
}
```

#### Helper: `getTodaysBets`

```typescript
async function getTodaysBets(): Promise<TodaysBetsResult> {
  // Use operator timezone (MT) for "today" boundary
  const operatorTz = process.env.OPERATOR_TIMEZONE || 'America/Edmonton';
  const todayStart = startOfDayInTz(new Date(), operatorTz);
  const todayEnd = endOfDayInTz(new Date(), operatorTz);
  
  const bets = await db.select().from(bets_table)
    .where(and(
      gte(bets_table.placed_at, todayStart),
      lt(bets_table.placed_at, todayEnd)
    ));
  
  const byMatch = new Map<string, number>();
  for (const bet of bets) {
    byMatch.set(bet.match_id, (byMatch.get(bet.match_id) || 0) + 1);
  }
  
  // Determine if we're in group stage or knockout for cap calculation
  const today_matches = await getTodaysMatches();
  const isKnockout = today_matches.some(m => 
    ['r32', 'r16', 'qf', 'sf', 'third', 'final'].includes(m.tournament_stage)
  );
  
  return { count: bets.length, byMatch, tournament_stage: isKnockout ? 'knockout' : 'group' };
}

function getDailyCap(stage: 'knockout' | 'group'): number {
  return stage === 'knockout' ? 3 : 5;
}
```

#### Helper: `computeRollingCLV`

```typescript
async function computeRollingCLV(): Promise<CLVStats> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  
  const settledBets = await db.select().from(bets_table)
    .where(and(
      eq(bets_table.settlement_status, 'settled'),
      isNotNull(bets_table.clv_cents)
    ));
  
  const thisWeek = settledBets.filter(b => b.settled_at >= weekAgo);
  const thisMonth = settledBets.filter(b => b.settled_at >= monthAgo);
  
  const avg = (bets: Bet[]) => bets.length > 0
    ? bets.reduce((sum, b) => sum + Number(b.clv_cents || 0), 0) / bets.length
    : 0;
  
  return {
    week: avg(thisWeek),
    month: avg(thisMonth),
    rolling30d: avg(thisMonth)  // 30d == month for our purposes
  };
}

function classifyCLV(rolling30d: number): CLVClassification {
  if (rolling30d >= 0.5) return 'sharp';
  if (rolling30d >= 0.0) return 'marginal';
  if (rolling30d >= -0.5) return 'break_even';
  return 'below_replacement';
}
```

### 2. Stop-loss state machine

`/src/agents/treasurer/stop_loss.ts`:

```typescript
type StopLossLevel = 'none' | 'reduced_kelly' | 'halt';

interface StopLossState {
  level: StopLossLevel;
  reason: string | null;
  action: string | null;
  resumes_at: string | null;
  kelly_modifier: number;
  daily_cap_override: number | null;
}

export function evaluateStopLossState(currentCents: bigint, peakCents: bigint): StopLossState {
  if (peakCents === BigInt(0) || currentCents >= peakCents) {
    return { level: 'none', reason: null, action: null, resumes_at: null, kelly_modifier: 1.0, daily_cap_override: null };
  }
  
  const drawdownBips = Number((peakCents - currentCents) * BigInt(10000) / peakCents);
  const drawdownPct = drawdownBips / 100;
  
  // Halt at 20% drawdown (tighter than NHL's 25%)
  if (drawdownPct >= 20) {
    return {
      level: 'halt',
      reason: `Bankroll down ${drawdownPct.toFixed(1)}% from peak`,
      action: 'No new bets. Manual resume required via Telegram.',
      resumes_at: null,
      kelly_modifier: 0,
      daily_cap_override: 0
    };
  }
  
  // Reduced state at 12% drawdown (tighter than NHL's 15%)
  if (drawdownPct >= 12) {
    const resumesAt = new Date();
    resumesAt.setDate(resumesAt.getDate() + 7);  // 7 days
    
    return {
      level: 'reduced_kelly',
      reason: `Bankroll down ${drawdownPct.toFixed(1)}%. Half-Kelly active 7 days.`,
      action: 'Half-Kelly sizing. Daily cap reduced to 3.',
      resumes_at: resumesAt.toISOString(),
      kelly_modifier: 0.5,
      daily_cap_override: 3
    };
  }
  
  return { level: 'none', reason: null, action: null, resumes_at: null, kelly_modifier: 1.0, daily_cap_override: null };
}
```

**Manual halt override:**

Operator can resume from halt via Telegram command. When `/treasurer resume` is sent:
- Verify current state is `halt`
- Log resume event to `agent_runs` with operator confirmation
- Write a marker row to `bankroll_ledger` with `entry_type: 'adjustment'`, `amount_cents: 0`, `notes: 'Stop-loss halt manually resumed by operator'`
- The state machine will continue to evaluate normally — if drawdown is still ≥ 20%, halt will re-trigger immediately. Operator must wait until natural recovery (deposit or winning streak) brings bankroll above the halt threshold.

### 3. Real Kelly sizing engine

`/src/agents/treasurer/sizing.ts`:

Replace the placeholder stake function with the full implementation per spec:

```typescript
export async function calculateStake(req: StakeRequest): Promise<StakeResponse> {
  const snapshot = await getTreasurerSnapshot();
  
  // Halt check
  if (snapshot.stop_loss_active === 'halt') {
    return rejection('stop_loss_halt', 'Bankroll halt active. Manual resume required.');
  }
  
  // Daily cap check
  if (snapshot.todays_bet_count >= snapshot.daily_bet_cap_effective) {
    return rejection('daily_cap_reached', `Already placed ${snapshot.todays_bet_count}/${snapshot.daily_bet_cap_effective} bets today`);
  }
  
  // Match cap check (one bet per match per day — Walters rule)
  const existingForMatch = snapshot.todays_bets_by_match.get(req.match_id) || 0;
  if (existingForMatch > 0) {
    return rejection('match_already_bet_today', 'Already placed a bet on this match today');
  }
  
  // Full Kelly
  const b = req.decimal_odds - 1;
  const p = req.adjusted_win_prob;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  
  if (fullKelly <= 0) {
    return rejection('kelly_non_positive', 'No positive Kelly fraction at this price');
  }
  
  // Apply Kelly fraction (quarter default, halved in reduced state)
  let kellyStakePct = fullKelly * snapshot.current_kelly_fraction;
  
  // Low confidence halving
  if (req.low_confidence_flag) {
    kellyStakePct *= 0.5;
  }
  
  // Knockout stage multiplier
  if (['r32', 'r16', 'qf', 'sf', 'third', 'final'].includes(req.tournament_stage)) {
    kellyStakePct *= 0.85;
  }
  
  // Compute stake in cents
  const HARD_CAP_PCT = 0.03;
  const FLOOR_CENTS = BigInt(2000);  // $20
  
  let stake_cents = BigInt(Math.round(kellyStakePct * Number(snapshot.active_bankroll_cents)));
  let cap_reasoning = `${(snapshot.current_kelly_fraction * 100).toFixed(0)}%-Kelly: ${(kellyStakePct * 100).toFixed(2)}% of bankroll`;
  
  // Hard cap
  const hardCapCents = BigInt(Math.round(HARD_CAP_PCT * Number(snapshot.active_bankroll_cents)));
  if (stake_cents > hardCapCents) {
    stake_cents = hardCapCents;
    cap_reasoning = `Capped at 3% hard cap ($${(Number(hardCapCents) / 100).toFixed(2)})`;
  }
  
  // Floor check
  if (stake_cents < FLOOR_CENTS) {
    return rejection('stake_below_floor', `Computed stake $${(Number(stake_cents) / 100).toFixed(2)} below $20 floor`);
  }
  
  // Available capital
  if (stake_cents > snapshot.available_capital_cents) {
    if (snapshot.available_capital_cents >= FLOOR_CENTS) {
      stake_cents = snapshot.available_capital_cents;
      cap_reasoning = `Reduced to fit available capital ($${(Number(snapshot.available_capital_cents) / 100).toFixed(2)})`;
    } else {
      return rejection('insufficient_capital', `Available capital $${(Number(snapshot.available_capital_cents) / 100).toFixed(2)} below floor`);
    }
  }
  
  return {
    approved: true,
    recommended_stake_cents: stake_cents,
    kelly_fraction_full: fullKelly,
    kelly_fraction_used: snapshot.current_kelly_fraction,
    bankroll_pct: (Number(stake_cents) / Number(snapshot.active_bankroll_cents)) * 100,
    cap_reasoning,
    rejection_reason: null,
    capital_snapshot: snapshot
  };
}
```

### 4. Daily cooldown rules

Beyond the stop-loss state machine, intra-day cooldowns trigger pauses:

`/src/agents/treasurer/cooldown.ts`:

```typescript
interface CooldownState {
  active: boolean;
  reason: string | null;
  remaining_minutes: number | null;
  effective_cap_today: number | null;
}

export async function evaluateCooldown(): Promise<CooldownState> {
  const todaysBets = await getTodaysSettledBets();
  
  // 2 consecutive losses → 30 min pause
  const recent = todaysBets.sort((a, b) => b.settled_at.getTime() - a.settled_at.getTime()).slice(0, 2);
  if (recent.length === 2 && recent.every(b => b.outcome === 'loss')) {
    const mostRecentLossAt = recent[0].settled_at;
    const minutesSince = (Date.now() - mostRecentLossAt.getTime()) / 60000;
    if (minutesSince < 30) {
      return {
        active: true,
        reason: 'Two consecutive losses — 30min cooldown',
        remaining_minutes: 30 - minutesSince,
        effective_cap_today: null
      };
    }
  }
  
  // 3 losses today → cap to current count (no more today)
  const losses = todaysBets.filter(b => b.outcome === 'loss').length;
  if (losses >= 3) {
    return {
      active: true,
      reason: '3 losses today — capped to current count',
      remaining_minutes: null,
      effective_cap_today: todaysBets.length
    };
  }
  
  // Down >5% today → cap to current + 1
  const todayStartBankroll = await getBankrollAtStartOfDay();
  const currentBankroll = (await getTreasurerSnapshot()).active_bankroll_cents;
  const dailyDrawdownPct = todayStartBankroll > 0
    ? Number((todayStartBankroll - currentBankroll) * BigInt(10000) / todayStartBankroll) / 100
    : 0;
  
  if (dailyDrawdownPct > 5) {
    return {
      active: true,
      reason: `Down ${dailyDrawdownPct.toFixed(1)}% today — one more shot then done`,
      remaining_minutes: null,
      effective_cap_today: todaysBets.length + 1
    };
  }
  
  return { active: false, reason: null, remaining_minutes: null, effective_cap_today: null };
}
```

Cooldown checks fold into `calculateStake` — if cooldown is active and would reject the bet, surface that as the rejection reason.

### 5. Bet placement integration

Phase 1 built the manual bet placement workflow that writes atomic bet + ledger transactions. Phase 4 enhances it to:

- Call `calculateStake` to validate before allowing placement (operator-entered stake is checked against Treasurer's approval)
- Warn if operator-entered stake differs from Treasurer recommendation
- Block placement if `calculateStake` rejects (with clear reason shown to operator)
- Capture stop-loss state at placement time → write to `bets.stop_loss_state_at_placement`

Update the bet placement form on the match detail page to show the Treasurer recommendation alongside the input field:

```
┌──────────────────────────────────────┐
│  PLACE BET                            │
├──────────────────────────────────────┤
│  Match: ESP vs CPV                    │
│  Market: Match Outcome                │
│  Side: Spain                          │
│  Book: Bet365 Ontario                 │
│  Odds (American): [-380]              │
│  Stake ($): [42.00]   ← recommended   │
│                                       │
│  Treasurer recommends: $42 (Kelly ¼, 1.2%)│
│  Kelly fraction used: 0.25            │
│  Bankroll after: $3,458               │
│                                       │
│  ⚠️ Override warning: if you enter   │
│  a different stake, the system logs   │
│  it but discipline gates were already │
│  satisfied for $42.                   │
│                                       │
│  [CANCEL]            [CONFIRM BET]    │
└──────────────────────────────────────┘
```

If the operator enters a stake higher than 1.5x the recommendation, surface a confirmation modal: "Stake is X% above Treasurer recommendation. Walters principle: discipline over action. Proceed?"

### 6. Automatic CLV computation on settlement

Phase 1 built the manual settlement workflow that updates `bets` and writes ledger payout entries. Phase 4 adds automatic CLV computation when a bet is settled.

`/src/agents/treasurer/clv.ts`:

```typescript
export async function computeCLVForBet(bet_id: string): Promise<CLVResult | null> {
  const bet = await getBet(bet_id);
  
  if (bet.settlement_status !== 'settled') {
    return null;
  }
  
  // Find the closing line snapshot for this market/side
  const closingSnapshot = await db.select().from(odds_snapshots)
    .where(and(
      eq(odds_snapshots.match_id, bet.match_id),
      eq(odds_snapshots.market, bet.market),
      eq(odds_snapshots.is_closing_line, true)
    ))
    .orderBy(desc(odds_snapshots.captured_at))
    .limit(1);
  
  if (closingSnapshot.length === 0) {
    return null;  // closing line not captured — log warning, don't fail
  }
  
  const closing = closingSnapshot[0];
  
  // Compute no-vig probability of bet's price and closing price
  // Use opposing-side strip method
  const opposingSide = await getOpposingSideSnapshot(bet.match_id, bet.market, bet.side, closing.captured_at);
  
  if (!opposingSide) {
    return null;  // can't strip vig without opposing side
  }
  
  const { side_a_no_vig: bet_no_vig_prob } = stripVigTwoWay(bet.american_odds, opposingSide.american_odds);
  const { side_a_no_vig: closing_no_vig_prob } = stripVigTwoWay(closing.american_odds, opposingSide.american_odds);
  
  const clv_cents = (closing_no_vig_prob - bet_no_vig_prob) * 100;
  
  let classification: CLVClassification;
  if (clv_cents > 0.5) classification = 'beat_close';
  else if (clv_cents < -0.5) classification = 'lost_to_close';
  else classification = 'matched_close';
  
  // Update bet row with CLV
  await db.update(bets_table)
    .set({
      bet_no_vig_prob,
      closing_line_american: closing.american_odds,
      closing_line_no_vig_prob,
      clv_cents,
      clv_classification: classification
    })
    .where(eq(bets_table.id, bet_id));
  
  return { clv_cents, classification, bet_no_vig_prob, closing_no_vig_prob };
}
```

**Three-way market handling (1X2):** When computing CLV for a match outcome bet, use the full three-way strip (`stripVigThreeWay`) instead of two-way, because there's no "single opposing side" — there are two.

**Asian handicap half-outcomes:** Treat half-win/half-loss bets as if half the stake was the original bet for CLV purposes.

**Trigger:** Run CLV computation automatically after every bet settlement. Add to the settlement workflow in `/src/api/bets.ts`. If closing line not yet captured, retry after 5 minutes, then after 30 minutes, then give up and log.

### 7. Daily morning report (8am MT)

`/src/agents/treasurer/daily_report.ts`:

Cron triggered at 8am MT every day. Generates and sends a Telegram digest:

```typescript
export async function generateDailyReport(): Promise<DailyReport> {
  const snapshot = await getTreasurerSnapshot();
  const yesterday = getYesterday();
  const yesterdayBets = await getBetsForDate(yesterday);
  const settled = yesterdayBets.filter(b => b.settlement_status === 'settled');
  const todayMatches = await getTodaysMatches();
  const activeStrikes = await getActiveStrikesForDate(new Date());
  
  return {
    date: formatDateMT(new Date()),
    bankroll: {
      current_cents: snapshot.active_bankroll_cents,
      change_24h_cents: await computeChange24h(),
      change_7d_cents: await computeChange7d(),
      change_tournament_cents: await computeChangeTournament(),
      drawdown_from_peak_pct: snapshot.drawdown_pct_from_peak
    },
    yesterday: {
      bets_placed: yesterdayBets.length,
      won: settled.filter(b => b.outcome === 'win').length,
      lost: settled.filter(b => b.outcome === 'loss').length,
      pushed: settled.filter(b => b.outcome === 'push').length,
      half_win: settled.filter(b => b.outcome === 'half_win').length,
      half_loss: settled.filter(b => b.outcome === 'half_loss').length,
      total_staked_cents: yesterdayBets.reduce((s, b) => s + b.stake_cents, BigInt(0)),
      net_pl_cents: settled.reduce((s, b) => s + (b.pl_cents || BigInt(0)), BigInt(0)),
      avg_clv_cents: settled.length > 0 
        ? settled.reduce((s, b) => s + Number(b.clv_cents || 0), 0) / settled.length 
        : 0
    },
    rolling: {
      last_7d_pl_cents: await compute7dPL(),
      last_7d_clv_cents: snapshot.this_week_clv_cents,
      tournament_total_pl_cents: await computeTournamentPL(),
      tournament_total_clv_cents: snapshot.this_month_clv_cents,
      tournament_record: await computeTournamentRecord()
    },
    state: {
      stop_loss_active: snapshot.stop_loss_active,
      kelly_fraction_current: snapshot.current_kelly_fraction,
      daily_cap_effective: snapshot.daily_bet_cap_effective
    },
    today_matches: todayMatches.map(m => ({
      home: m.home_team_name,
      away: m.away_team_name,
      kickoff_local: m.scheduled_kickoff_mt,
      strike_count: activeStrikes.filter(s => s.match_id === m.id).length
    }))
  };
}

async function sendDailyReportTelegram(report: DailyReport): Promise<void> {
  const text = formatReportForTelegram(report);
  await sendTelegramMessage(text, 'LOW');  // LOW priority - it's informational
}
```

Telegram format:

```
📊 DAILY TREASURER REPORT — June 14, 2026

BANKROLL
Current: $5,420.50
24h change: +$210 (+4.0%)
7d change: +$340 (+6.7%)
Tournament total: +$420.50 (+8.4%)
From peak: -2.1% (peak $5,540)

YESTERDAY
Bets: 3 placed, 3 settled (2W-1L)
Staked: $480
Net P&L: +$210
Avg CLV: +1.8¢ (sharp)

ROLLING
Last 7d P&L: +$340
Last 7d CLV: +1.6¢ (sharp)
Tournament: 9W-4L-1P, +$420, +1.2¢ avg CLV

STATE
Stop-loss: NONE
Kelly: 0.25 (quarter)
Daily cap: 5 (group stage)

TODAY'S MATCHES
• France vs Senegal (15:00 ET) — 1 STRIKE active
• Brazil vs Morocco (18:00 ET) — under review  
• Argentina vs Iraq (21:00 ET) — WATCH

✅ System healthy. Continue with discipline.
```

If state is `reduced_kelly` or `halt`, the report includes prominent warnings at the top instead of the green checkmark.

### 8. Compound/withdraw prompt

`/src/agents/treasurer/compound_prompt.ts`:

When bankroll is up 20% from a baseline, send the operator a Telegram prompt asking what to do.

```typescript
export async function checkCompoundWithdrawTrigger(): Promise<void> {
  const baseline = await getCurrentBaseline();  // last set baseline, or initial deposit
  const current = (await getTreasurerSnapshot()).active_bankroll_cents;
  
  const gainPct = baseline > 0 
    ? Number((current - baseline) * BigInt(10000) / baseline) / 100 
    : 0;
  
  if (gainPct < 20) return;
  
  const lastPromptedAt = await getLastCompoundPromptTimestamp();
  if (lastPromptedAt && (Date.now() - lastPromptedAt.getTime()) < 14 * 24 * 60 * 60 * 1000) {
    return;  // already prompted within last 14 days
  }
  
  await sendTelegramMessage(`
💰 BANKROLL +${gainPct.toFixed(1)}% FROM BASELINE

Current: $${(Number(current) / 100).toFixed(2)}
Baseline: $${(Number(baseline) / 100).toFixed(2)}
Gain: +$${(Number(current - baseline) / 100).toFixed(2)}

Decision time. Three options:

1. /treasurer compound — set new baseline at current bankroll
2. /treasurer withdraw [amount] — withdraw to your real bank account, keep rest in play
3. /treasurer continue — keep current baseline, defer decision (will re-prompt in 14 days)

Per Walters: take profits when the math says you should.
`, 'MEDIUM');
  
  await setLastCompoundPromptTimestamp(new Date());
}
```

Cron checks this daily after the morning report.

### 9. Concurrent stake request locking

Multiple CEO instances or rapid-fire stake requests could race conditions on bet placement. Lock by match_id:

`/src/agents/treasurer/locking.ts`:

```typescript
const matchLocks = new Map<string, Promise<void>>();

export async function withMatchLock<T>(match_id: string, fn: () => Promise<T>): Promise<T> {
  // Wait for any existing lock on this match
  while (matchLocks.has(match_id)) {
    await matchLocks.get(match_id);
  }
  
  let release: () => void;
  const lockPromise = new Promise<void>(resolve => { release = resolve; });
  matchLocks.set(match_id, lockPromise);
  
  try {
    return await fn();
  } finally {
    matchLocks.delete(match_id);
    release!();
  }
}
```

`calculateStake` wraps its critical section (snapshot read → cap check → return) in `withMatchLock(req.match_id, ...)`.

This prevents the race condition where two stake requests for the same match both pass the "haven't bet this match today" check before either has written.

### 10. Telegram resume command

`/src/api/telegram.ts`:

Add handlers for operator commands:

- `/treasurer resume` — resume from halt
- `/treasurer compound` — set new baseline at current bankroll
- `/treasurer withdraw 500` — withdraw $500 from bankroll
- `/treasurer continue` — defer compound/withdraw decision
- `/treasurer state` — return current state details

```typescript
async function handleTreasurerCommand(args: string[], chatId: string): Promise<void> {
  if (chatId !== process.env.TELEGRAM_CHAT_ID) {
    await sendTelegramMessage('Unauthorized', 'LOW', chatId);
    return;
  }
  
  const subcommand = args[0];
  
  if (subcommand === 'resume') {
    const snapshot = await getTreasurerSnapshot();
    if (snapshot.stop_loss_active !== 'halt') {
      await sendTelegramMessage(`Halt not active (current state: ${snapshot.stop_loss_active})`, 'LOW');
      return;
    }
    await resumeFromHalt();
    await sendTelegramMessage('Halt manually resumed. State machine will re-evaluate normally.', 'MEDIUM');
  }
  
  // ... other subcommands
}
```

### 11. Verdict integration — wire CEO to real Treasurer

The CEO's stake calculation in Phase 3 used the placeholder `computePlaceholderStake`. Phase 4 swaps it out:

In `/src/agents/ceo/index.ts`, change:
```typescript
const stake = decision === 'STRIKE' ? computePlaceholderStake(adjustedEdge, treasurerSnapshot) : null;
```

To:
```typescript
const stakeResponse = decision === 'STRIKE' 
  ? await calculateStake({
      match_id: inputs.match_id,
      market: marketKey,
      side,
      adjusted_win_prob: context.adjusted_prob,
      american_odds: context.best_book_american,
      decimal_odds: context.best_book_decimal,
      book: context.best_book,
      edge_pct: adjustedEdge,
      low_confidence_flag: quant.confidence_interval.low_confidence_flag,
      tournament_stage: inputs.match_metadata.tournament_stage
    })
  : null;

const stake = stakeResponse?.approved 
  ? { stake_cents: stakeResponse.recommended_stake_cents, fraction: stakeResponse.kelly_fraction_used, bankroll_pct: stakeResponse.bankroll_pct }
  : null;
```

If `stakeResponse.approved === false`, the decision flips from STRIKE to PASS with the rejection reason as the pass_reason.

### 12. Dashboard treasurer panel

Update the slate view footer to show real Treasurer state:

```
C1 BANKROLL                       AGENT HEALTH                    
 ACTIVE: $5,420.50                wolfman: success · 234ms        
 7D: +$340 (+6.7%)                quant: success · 1.2s           
 PEAK: $5,540.00 (-2.1%)          tactician: success · 412ms      
 TODAY'S BETS: 3/5                ceo: success · 2.1s             
 KELLY: 0.25 ✓                    treasurer: success · 18ms       
 CLV 30D: +1.2¢ (sharp)          api_credits: 387/500            
```

If stop-loss active, change the panel color (orange for reduced, red for halt) and surface the state:

```
C1 BANKROLL — ⚠️ REDUCED KELLY
 ACTIVE: $4,840.00 (-12.6% from peak)
 KELLY: 0.125 (half-Kelly active 5 more days)
 TODAY'S BETS: 1/3
 CLV 30D: +0.2¢ (marginal)
```

Add a new page `/treasurer` showing full treasurer state, recent ledger entries, CLV breakdown by week, and stop-loss history.

### 13. Update verdict format

Verdicts written to `verdicts` table now include real Treasurer-computed fields. Backfill historical verdicts that have NULL stake fields (because Phase 3 stubs returned approximations) is optional but nice.

## SCOPE BOUNDARIES — DO NOT BUILD IN PHASE 4

- ❌ Auto bet placement — never (manual only, per Walters principle)
- ❌ Player props or futures — v2
- ❌ Live in-play markets — v2
- ❌ Tournament progression simulator — separate feature
- ❌ ML / learning from past bets — sample size too small, deferred to post-tournament analysis
- ❌ Sportsbook account balance reconciliation — operator handles externally

If you find yourself wanting to build one of these, STOP and ask.

## TECHNICAL CONSTRAINTS

- TypeScript strict, zero `any`
- All money as BigInt cents — never floating point. Multiplications use `BigInt(Math.round(float * Number(big)))` pattern.
- UTC in storage, MT for display
- All ledger writes inside transactions
- Drizzle ORM
- zod validation
- Telegram commands authenticate against TELEGRAM_CHAT_ID — reject unauthorized

## TESTING REQUIREMENTS

1. `npm run typecheck` — zero errors
2. `npm run lint` — zero errors
3. `npm run test` — all pass, including:
   - `computeLedgerStats` correctness (sum-of-amounts == latest balance_after_cents across 1000 simulated entries)
   - Stop-loss state transitions (none → reduced at exactly 12%, reduced → halt at exactly 20%)
   - Kelly math (verified against known quarter-Kelly tables on 100 inputs)
   - Hard cap behavior at 3%
   - Floor behavior at $20
   - Daily cap by stage (5 group / 3 knockout)
   - One-bet-per-match-per-day enforcement
   - Knockout stage multiplier 0.85x
   - Low confidence multiplier 0.5x
   - Reduced-state Kelly halving
   - CLV computation accuracy on 50 historical bets (vs manual computation)
   - Asian handicap half-win/half-loss settlement math
   - Three-way market CLV computation (1X2)
   - Cooldown rules (2 losses → 30min pause, 3 losses → cap today)
   - Daily drawdown >5% → cap to current+1
   - Concurrent stake request locking (no race conditions in 1000 simulated parallel requests)
   - Compound/withdraw trigger at exactly 20% gain
   - Atomic transactions (interrupt mid-write, verify rollback)
4. Integration tests:
   - End-to-end bet placement → settlement → CLV computation
   - Stop-loss halt → manual resume flow
   - Daily report generation with real ledger data

## PHASE 4 EXIT CRITERIA

1. Real `getTreasurerSnapshot()` computing everything from ledger + bets
2. Stop-loss state machine working (12% reduced, 20% halt, 7-day reduced timer)
3. Manual resume from halt via Telegram
4. Real `calculateStake` with all caps, floors, multipliers
5. CLV computed automatically on every bet settlement
6. Daily morning report sending via Telegram at 8am MT
7. Compound/withdraw prompt firing at +20% baseline
8. Concurrent stake request locking working
9. CEO using real Treasurer (placeholder stub deleted)
10. Dashboard treasurer panel showing real state
11. New `/treasurer` page with full state details
12. Telegram commands `/treasurer resume`, `/treasurer compound`, `/treasurer withdraw`, `/treasurer continue`, `/treasurer state` working
13. All tests passing
14. README updated with Phase 4 setup
15. v1 feature complete

## RULES OF ENGAGEMENT

- **Report drift first.** Especially regarding the stub interface — that's the contract you must preserve.
- **Don't break CEO.** The CEO calls Treasurer functions. Keep signatures stable; extend only.
- **Ledger is append-only.** Never UPDATE or DELETE rows in bankroll_ledger. Every change is a new row.
- **Cents are BigInt.** No floats in money paths. Test with extreme values to catch overflow.
- **Stop-loss is the law.** Operator cannot override the halt without explicit Telegram command.
- **Atomicity.** Bet placement + ledger debit + stake validation = single transaction.
- **CLV degrades gracefully.** If closing line not captured, log it, don't fail the settlement.
- **Authenticate Telegram commands.** Reject anything not from TELEGRAM_CHAT_ID.
- **Test the boundary conditions.** Exactly 12% drawdown, exactly $20 floor, exactly 3% cap, exactly 5 bets today, etc.

## WHEN YOU'RE DONE

Report back:

1. One-paragraph summary
2. `npm run test` output — call out the stop-loss state transition tests, Kelly math tests, CLV computation tests specifically
3. Sample TreasurerSnapshot output for current bankroll
4. Sample daily morning report (text)
5. Telegram command demonstration: `/treasurer state` response
6. CLV computation for one real settled bet
7. Stop-loss state machine demonstration: simulate 12% drawdown, verify state changes
8. Confederation count + backtest still passing (regressions from earlier phases)
9. Any spec deviations
10. **v1 IS FEATURE COMPLETE** confirmation

You are not building Phase 5. After Phase 4, the system shifts from build to operate. The work that follows is calibration, tournament-specific tuning, and operator activities — not Claude Code builds.

## CONTEXT

By the end of Phase 4:

- Bankroll properly managed with append-only ledger as single source of truth
- Stake recommendations tied to live bankroll state, not stale snapshots
- Drawdown protection enforced automatically (12%/20% thresholds)
- CLV tracked per bet, classified, surfaced in daily reports
- Operator gets morning summaries via Telegram
- Compound/withdraw prompts trigger at appropriate gains
- One-bet-per-match-per-day rule enforced
- Daily cap (5 group / 3 knockout) enforced
- Cooldowns trigger on consecutive losses

The system is now syndicate-grade. For Matchday 3 (June 22-25) — the highest-edge window of group stage — you have:
- Calibrated Quant model with validated backtest
- Tactician applying motivation-gap edge (the canonical Walters tournament opportunity)
- Wolfman reading market signals with Asian/Western divergence detection
- CEO applying 9 discipline gates before any STRIKE
- Treasurer enforcing Kelly sizing, daily caps, drawdown protection
- CLV automatically tracked

What's left after Phase 4 ships:

- **Operator activities** (not Claude Code builds):
  - Post-Matchday-1 and post-Matchday-2 calibration reviews
  - Beat reporter handle population for teams you actually bet on
  - Team profile refinement based on observed play
  - Pre-Round-of-32 review (June 25-26 per spec)
  - Pre-Final-week review (July 12-13 per spec)
- **v2 features** (defer until post-tournament):
  - Player props
  - Tournament futures
  - Live in-play
  - ML / learning from settled bets

## START HERE

Inspect Phase 3 implementation, especially the Treasurer stub. Re-read `06_AGENT_TREASURER.md`. Reply with drift report and Phase 4 build plan before writing any code.
