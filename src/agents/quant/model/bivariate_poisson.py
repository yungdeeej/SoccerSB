"""Bivariate Poisson core — joint goal distribution with correlation + draw inflation."""
from __future__ import annotations

import numpy as np
import numpy.typing as npt
from scipy import stats

from model.composite_rating import attack_multiplier
from model.draw_inflation import apply_draw_inflation
from model.markets import derive_market_probabilities
from model.types import MatchPrediction, ModelParams, TeamRating, VenueInfo
from model.venue_factor import venue_factor


def compute_lambdas(
    home: TeamRating,
    away: TeamRating,
    venue: VenueInfo,
    params: ModelParams,
    stage: str = "group_md1",
    weather_xg_offset: float = 0.0,
    generic_host: str | None = None,
) -> tuple[float, float]:
    """Expected goals per side from composite ratings + venue + stage."""
    vf = venue_factor(venue, home.short_name, away.short_name, params, generic_host=generic_host)
    stage_adj = params.stage_adjustments.get(stage, 1.0)

    # Absolute Elo-difference → goal expectation (alpha calibrated via backtest)
    diff = home.rating_points - away.rating_points
    lambda_home = (
        params.base_goals_per_team
        * attack_multiplier(diff, params)
        * vf
        * stage_adj
    )
    lambda_away = (
        params.base_goals_per_team
        * attack_multiplier(-diff, params)
        * (1.0 / vf)
        * stage_adj
    )

    # Weather shifts total xG, split evenly
    lambda_home += weather_xg_offset / 2
    lambda_away += weather_xg_offset / 2

    lambda_home = float(np.clip(lambda_home, params.lambda_min, params.lambda_max))
    lambda_away = float(np.clip(lambda_away, params.lambda_min, params.lambda_max))
    return lambda_home, lambda_away


def dixon_coles_correction(
    joint: npt.NDArray[np.float64], lambda_home: float, lambda_away: float, rho: float
) -> npt.NDArray[np.float64]:
    """
    Dixon-Coles (1997) low-score dependency correction — the canonical fix for
    Poisson models under-predicting draws and low-scoring results.
    Adjusts only the 0-0, 1-0, 0-1, 1-1 cells; rho < 0 boosts 0-0 and 1-1.
    """
    if rho == 0.0:
        return joint
    corrected = joint.copy()
    corrected[0, 0] *= 1 - lambda_home * lambda_away * rho
    corrected[0, 1] *= 1 + lambda_home * rho
    corrected[1, 0] *= 1 + lambda_away * rho
    corrected[1, 1] *= 1 - rho
    corrected = np.maximum(corrected, 0.0)
    normalized: npt.NDArray[np.float64] = corrected / corrected.sum()
    return normalized


def build_joint_distribution(
    lambda_home: float, lambda_away: float, params: ModelParams
) -> npt.NDArray[np.float64]:
    """Joint score grid: correlation + Dixon-Coles + draw inflation, normalized."""
    n = params.max_goals_grid + 1
    goals = np.arange(n)
    p_h = stats.poisson.pmf(goals, lambda_home)
    p_a = stats.poisson.pmf(goals, lambda_away)

    joint = np.outer(p_h, p_a)

    # Correlation adjustment (game-flow dependency)
    h_dev = goals - lambda_home
    a_dev = goals - lambda_away
    denom = float(np.sqrt(lambda_home * lambda_away)) + 0.01
    adj = 1.0 + params.goal_correlation * np.outer(h_dev, a_dev) / denom
    joint = joint * np.maximum(adj, 0.0)

    joint = joint / joint.sum()
    joint = dixon_coles_correction(joint, lambda_home, lambda_away, params.dc_rho)
    joint = apply_draw_inflation(joint, params.draw_inflation)

    # Tempering: raise entropy to account for rating uncertainty (tau < 1 flattens).
    # Applied to the joint so every derived market stays internally coherent.
    if params.joint_temper != 1.0:
        joint = np.power(joint, params.joint_temper)
        joint = joint / joint.sum()
    return joint


def predict_match(
    home: TeamRating,
    away: TeamRating,
    venue: VenueInfo,
    params: ModelParams,
    stage: str = "group_md1",
    weather_xg_offset: float = 0.0,
    generic_host: str | None = None,
) -> MatchPrediction:
    lambda_home, lambda_away = compute_lambdas(
        home, away, venue, params, stage, weather_xg_offset, generic_host
    )
    joint = build_joint_distribution(lambda_home, lambda_away, params)
    return derive_market_probabilities(joint, lambda_home, lambda_away, params)
