/**
 * Tournament stage inference from kickoff date (UTC) + deterministic
 * placeholder match IDs derived from The Odds API event IDs.
 */

export type TournamentStage =
  | 'group_md1' | 'group_md2' | 'group_md3'
  | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';

/**
 * Date-window stage inference per the 2026 schedule.
 * Group stage runs June 11-25 in three matchday waves; knockouts per
 * 01_MASTER_ORCHESTRATION.md.
 */
export function inferTournamentStage(kickoffUtc: Date): TournamentStage {
  // Compare on UTC date only
  const d = Date.UTC(kickoffUtc.getUTCFullYear(), kickoffUtc.getUTCMonth(), kickoffUtc.getUTCDate());
  const day = (y: number, m: number, dd: number): number => Date.UTC(y, m - 1, dd);

  if (d <= day(2026, 6, 17)) return 'group_md1';
  if (d <= day(2026, 6, 21)) return 'group_md2';
  if (d <= day(2026, 6, 26)) return 'group_md3';
  if (d <= day(2026, 7, 3)) return 'r32';
  if (d <= day(2026, 7, 7)) return 'r16';
  if (d <= day(2026, 7, 11)) return 'qf';
  if (d <= day(2026, 7, 15)) return 'sf';
  if (d <= day(2026, 7, 18)) return 'third';
  return 'final';
}

export function isKnockoutStage(stage: string): boolean {
  return ['r32', 'r16', 'qf', 'sf', 'third', 'final'].includes(stage);
}

/**
 * Deterministic 31-bit FNV-1a hash of The Odds API event id.
 * Used as fifa_match_id placeholder until real FIFA IDs are backfilled —
 * stable across re-syncs so upserts hit the same row.
 */
export function placeholderMatchId(oddsApiEventId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < oddsApiEventId.length; i++) {
    hash ^= oddsApiEventId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0x7fffffff;
}
