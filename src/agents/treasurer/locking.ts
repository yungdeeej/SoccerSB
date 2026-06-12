/** Per-match async mutex — prevents stake-request races on the same match. */

const matchLocks = new Map<string, Promise<void>>();

export async function withMatchLock<T>(match_id: string, fn: () => Promise<T>): Promise<T> {
  while (matchLocks.has(match_id)) {
    await matchLocks.get(match_id);
  }

  let release!: () => void;
  const lockPromise = new Promise<void>((resolve) => { release = resolve; });
  matchLocks.set(match_id, lockPromise);

  try {
    return await fn();
  } finally {
    matchLocks.delete(match_id);
    release();
  }
}
