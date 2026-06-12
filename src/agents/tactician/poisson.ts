/**
 * TypeScript port of the Quant's joint-distribution pipeline — used to
 * recompute totals/AH/BTTS from Tactician-adjusted lambdas.
 *
 * Parameters are read from the SAME yaml the Python service uses
 * (src/agents/quant/config/model_params.yaml) so the implementations cannot
 * drift on config. A parity test pins outputs against Python-generated
 * reference values.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUANT_PARAMS_PATH = join(__dirname, '../quant/config/model_params.yaml');

const QuantParamsSchema = z.object({
  bivariate_poisson: z.object({
    goal_correlation: z.number(),
    max_goals_grid: z.number().int(),
    dc_rho: z.number(),
    joint_temper: z.number()
  }),
  draw_inflation: z.object({ factor: z.number() })
});

export interface JointParams {
  goal_correlation: number;
  max_goals_grid: number;
  dc_rho: number;
  joint_temper: number;
  draw_inflation: number;
}

let paramsCache: JointParams | null = null;

export function loadJointParams(): JointParams {
  if (!paramsCache) {
    const raw: unknown = parseYaml(readFileSync(QUANT_PARAMS_PATH, 'utf-8'));
    const parsed = QuantParamsSchema.parse(raw);
    paramsCache = {
      goal_correlation: parsed.bivariate_poisson.goal_correlation,
      max_goals_grid: parsed.bivariate_poisson.max_goals_grid,
      dc_rho: parsed.bivariate_poisson.dc_rho,
      joint_temper: parsed.bivariate_poisson.joint_temper,
      draw_inflation: parsed.draw_inflation.factor
    };
  }
  return paramsCache;
}

function poissonPmf(k: number, lambda: number): number {
  // exp(-λ) λ^k / k! — k is small (≤7), direct computation is exact enough
  let logP = -lambda + k * Math.log(lambda);
  for (let i = 2; i <= k; i++) logP -= Math.log(i);
  return Math.exp(logP);
}

/** Mirror of Python build_joint_distribution: correlation → DC → inflation → temper. */
export function buildJointDistribution(
  lambdaHome: number,
  lambdaAway: number,
  params: JointParams = loadJointParams()
): number[][] {
  const n = params.max_goals_grid + 1;
  const pH = Array.from({ length: n }, (_, k) => poissonPmf(k, lambdaHome));
  const pA = Array.from({ length: n }, (_, k) => poissonPmf(k, lambdaAway));

  const joint: number[][] = [];
  const denom = Math.sqrt(lambdaHome * lambdaAway) + 0.01;
  let sum = 0;
  for (let h = 0; h < n; h++) {
    joint.push([]);
    for (let a = 0; a < n; a++) {
      const adj = Math.max(
        0,
        1 + (params.goal_correlation * (h - lambdaHome) * (a - lambdaAway)) / denom
      );
      const v = pH[h] * pA[a] * adj;
      joint[h].push(v);
      sum += v;
    }
  }
  normalize(joint, sum);

  // Dixon-Coles low-score correction
  if (params.dc_rho !== 0) {
    const rho = params.dc_rho;
    joint[0][0] *= 1 - lambdaHome * lambdaAway * rho;
    joint[0][1] *= 1 + lambdaHome * rho;
    joint[1][0] *= 1 + lambdaAway * rho;
    joint[1][1] *= 1 - rho;
    clampAndNormalize(joint);
  }

  // Draw inflation
  if (params.draw_inflation !== 1) {
    for (let i = 0; i < n; i++) joint[i][i] *= params.draw_inflation;
    clampAndNormalize(joint);
  }

  // Tempering
  if (params.joint_temper !== 1) {
    for (let h = 0; h < n; h++) {
      for (let a = 0; a < n; a++) joint[h][a] = Math.pow(joint[h][a], params.joint_temper);
    }
    clampAndNormalize(joint);
  }

  return joint;
}

function normalize(joint: number[][], knownSum?: number): void {
  const sum = knownSum ?? joint.flat().reduce((s, v) => s + v, 0);
  for (const row of joint) {
    for (let i = 0; i < row.length; i++) row[i] /= sum;
  }
}

function clampAndNormalize(joint: number[][]): void {
  for (const row of joint) {
    for (let i = 0; i < row.length; i++) row[i] = Math.max(0, row[i]);
  }
  normalize(joint);
}

// ---------------------------------------------------------------------------
// Market derivation from a joint distribution (mirror of Python markets.py)
// ---------------------------------------------------------------------------

export const TOTALS_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
export const AH_LINES = Array.from({ length: 17 }, (_, i) => Math.round((i - 8) * 0.25 * 100) / 100);

export function deriveOutcome(joint: number[][]): { home: number; draw: number; away: number } {
  let home = 0, draw = 0, away = 0;
  for (let h = 0; h < joint.length; h++) {
    for (let a = 0; a < joint.length; a++) {
      if (h > a) home += joint[h][a];
      else if (h < a) away += joint[h][a];
      else draw += joint[h][a];
    }
  }
  return { home, draw, away };
}

export function deriveTotals(joint: number[][]): Record<string, { over: number; under: number }> {
  const totals: Record<string, { over: number; under: number }> = {};
  for (const line of TOTALS_LINES) {
    let over = 0;
    for (let h = 0; h < joint.length; h++) {
      for (let a = 0; a < joint.length; a++) {
        if (h + a > line) over += joint[h][a];
      }
    }
    totals[String(line)] = { over, under: 1 - over };
  }
  return totals;
}

export function deriveAsianHandicap(
  joint: number[][]
): Record<string, { home_covers: number; away_covers: number }> {
  const ahProbs = (line: number): { home_covers: number; away_covers: number } => {
    const isQuarter = Math.round(Math.abs(line * 4)) % 2 === 1;
    if (isQuarter) {
      const lo = ahProbs(Math.round((line - 0.25) * 100) / 100);
      const hi = ahProbs(Math.round((line + 0.25) * 100) / 100);
      return {
        home_covers: (lo.home_covers + hi.home_covers) / 2,
        away_covers: (lo.away_covers + hi.away_covers) / 2
      };
    }
    let homeWins = 0, push = 0;
    for (let h = 0; h < joint.length; h++) {
      for (let a = 0; a < joint.length; a++) {
        const adjusted = h - a + line;
        if (adjusted > 1e-9) homeWins += joint[h][a];
        else if (Math.abs(adjusted) <= 1e-9) push += joint[h][a];
      }
    }
    const awayWins = Math.max(0, 1 - homeWins - push);
    return { home_covers: homeWins + push / 2, away_covers: awayWins + push / 2 };
  };

  const result: Record<string, { home_covers: number; away_covers: number }> = {};
  for (const line of AH_LINES) {
    const key = line > 0 ? `+${line}` : String(line);
    result[key] = ahProbs(line);
  }
  return result;
}

export function deriveBtts(joint: number[][]): { yes_prob: number; no_prob: number } {
  let yes = 0;
  for (let h = 1; h < joint.length; h++) {
    for (let a = 1; a < joint.length; a++) yes += joint[h][a];
  }
  return { yes_prob: yes, no_prob: 1 - yes };
}
