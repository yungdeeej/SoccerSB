/**
 * Reverse line movement — public % vs line direction. Public bet data isn't
 * free; degrades gracefully until a provider is wired.
 * TODO: integrate VSiN or Action Network for public bet data when budget allows.
 */

export interface RLMSignal {
  detected: boolean;
  explanation: string | null;
}

export function detectRLM(public_bet_pct: number | null, line_movement_cents: number): RLMSignal {
  if (public_bet_pct === null) {
    return { detected: false, explanation: 'Public bet data unavailable' };
  }
  // Soccer threshold tighter than NHL: 65% public + 3¢ move against them
  if (public_bet_pct >= 0.65 && line_movement_cents > 3) {
    return {
      detected: true,
      explanation: `RLM: ${(public_bet_pct * 100).toFixed(0)}% public on favorite, line moved ${line_movement_cents}¢ toward dog`
    };
  }
  return { detected: false, explanation: null };
}
