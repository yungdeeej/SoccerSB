/**
 * The Treasurer (Phase 4) — real implementation. The Phase 3 stub interface is
 * the contract: getTreasurerSnapshot(knockoutStage) and the stake math keep
 * their shapes; everything is now derived live from ledger + bets.
 */
export { getTreasurerSnapshot, computeLedgerStats, classifyCLV, type TreasurerSnapshot } from './snapshot';
export { evaluateStopLossState, drawdownPct, type StopLossState, type StopLossLevel } from './stop_loss';
export { calculateStake, computeStakeFromSnapshot, validateBetPlacement, type StakeRequest, type StakeResponse } from './sizing';
export { evaluateCooldown, evaluateCooldownFromBets, type CooldownState } from './cooldown';
export { computeCLVForBet, scheduleCLVComputation, computeTwoWayCLV, computeThreeWayCLV, opposingMarketKey } from './clv';
export { generateDailyReport, sendDailyReport, checkCompoundWithdrawTrigger, getCurrentBaseline, compoundGainPct } from './daily_report';
export { handleTreasurerCommand } from './commands';
export { withMatchLock } from './locking';
