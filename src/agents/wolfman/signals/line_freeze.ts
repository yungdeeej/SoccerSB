/** Line freeze — Pinnacle going quiet during an active polling window. */
import type { SnapshotPoint } from './types';

const EXPECTED_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

export function detectLineFreeze(pinnacleSnapshots: SnapshotPoint[], now: Date = new Date()): boolean {
  if (pinnacleSnapshots.length < 2) return false;
  const latest = pinnacleSnapshots[pinnacleSnapshots.length - 1];
  return now.getTime() - latest.captured_at.getTime() > EXPECTED_UPDATE_INTERVAL_MS;
}
