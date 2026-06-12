/** Factor 4 — tactical weather effects (the Quant prices raw xG; we price tactics). */
import type { Coefficients } from '../config';
import type { FactorEffect, MatchContext } from '../types';
import { NULL_EFFECT } from '../types';

export function computeWeather(ctx: MatchContext, coef: Coefficients): FactorEffect {
  const w = ctx.weather;
  if (!w) return NULL_EFFECT('weather_unavailable');

  const c = coef.weather;

  // Heat: bench depth decides late-game survival
  if (w.temp_c > 32) {
    const depthDiff = ctx.home.profile.bench_quality_z - ctx.away.profile.bench_quality_z;
    return {
      home_effect: c.hot_above_32c_depth_multiplier * depthDiff,
      away_effect: -c.hot_above_32c_depth_multiplier * depthDiff,
      totals_modifier: c.hot_total_xg_offset / 10,  // suppressed scoring → small under lean
      metadata: { temp_c: w.temp_c, home_bench_z: ctx.home.profile.bench_quality_z, away_bench_z: ctx.away.profile.bench_quality_z, source: w.source }
    };
  }

  // Wet pitch: favors direct/physical sides, raises set-piece chaos → BTTS up
  if (w.condition === 'heavy_rain') {
    const directnessDiff = ctx.home.profile.style_directness_score - ctx.away.profile.style_directness_score;
    return {
      home_effect: c.wet_directness_multiplier * directnessDiff,
      away_effect: -c.wet_directness_multiplier * directnessDiff,
      btts_modifier: c.wet_btts_adjustment,
      totals_modifier: c.heavy_rain_total_xg_offset / 10,
      metadata: { condition: w.condition, directness_diff: directnessDiff, source: w.source }
    };
  }

  // High wind: long balls and crosses disrupted — totals drag only
  if (w.wind_kph > 25) {
    return {
      home_effect: 0,
      away_effect: 0,
      totals_modifier: c.high_wind_total_xg_offset / 10,
      metadata: { wind_kph: w.wind_kph, source: w.source }
    };
  }

  return NULL_EFFECT(`benign_conditions (${w.temp_c}°C, ${w.condition}, ${w.wind_kph}km/h)`);
}
