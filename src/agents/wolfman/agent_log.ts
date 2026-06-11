/**
 * agent_runs logging — no silent failures (operating rule 6).
 */
import { db } from '../../db/index';
import { agent_runs } from '../../db/schema';

export type RunStatus = 'success' | 'failed_recoverable' | 'failed_fatal';

export async function logAgentRun(args: {
  agent: string;
  run_phase: string;
  status: RunStatus;
  duration_ms: number;
  match_id?: string | null;
  error?: unknown;
  outputs_summary?: Record<string, unknown>;
}): Promise<void> {
  const err = args.error instanceof Error ? args.error : args.error !== undefined ? new Error(String(args.error)) : null;
  try {
    await db.insert(agent_runs).values({
      agent: args.agent,
      run_phase: args.run_phase,
      status: args.status,
      duration_ms: args.duration_ms,
      match_id: args.match_id ?? null,
      error_message: err?.message ?? null,
      error_stack: err?.stack ?? null,
      outputs_summary: args.outputs_summary ?? null
    });
  } catch (logErr) {
    // Logging must never take down the pipeline — but surface it on console.
    console.error('agent_runs logging failed:', logErr);
  }
}
