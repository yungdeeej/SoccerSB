"""Load model parameters from config/model_params.yaml."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from model.types import ModelParams

CONFIG_DIR = Path(__file__).parent.parent / "config"


@lru_cache(maxsize=1)
def load_params() -> ModelParams:
    raw: dict[str, Any] = yaml.safe_load((CONFIG_DIR / "model_params.yaml").read_text())
    return ModelParams(
        model_version=raw["model_version"],
        goal_correlation=raw["bivariate_poisson"]["goal_correlation"],
        max_goals_grid=raw["bivariate_poisson"]["max_goals_grid"],
        dc_rho=raw["bivariate_poisson"]["dc_rho"],
        joint_temper=raw["bivariate_poisson"]["joint_temper"],
        draw_inflation=raw["draw_inflation"]["factor"],
        elo_weight=raw["composite_rating"]["elo_weight"],
        market_value_weight=raw["composite_rating"]["market_value_weight"],
        club_xg_weight=raw["composite_rating"]["club_xg_weight"],
        low_data_elo_weight=raw["composite_rating"]["low_data_elo_weight"],
        low_data_market_value_weight=raw["composite_rating"]["low_data_market_value_weight"],
        base_goals_per_team=raw["rating_to_goals"]["base_goals_per_team"],
        alpha=raw["rating_to_goals"]["alpha"],
        host_boosts=raw["venue_factor"]["host_boosts"],
        generic_host_boost=raw["venue_factor"]["generic_host_boost"],
        altitude_2000plus_swing=raw["venue_factor"]["altitude_2000plus_swing"],
        altitude_1500_2000_swing=raw["venue_factor"]["altitude_1500_2000_swing"],
        travel_advantage_per_1000km=raw["venue_factor"]["travel_advantage_per_1000km"],
        travel_advantage_cap=raw["venue_factor"]["travel_advantage_cap"],
        first_half_goal_share=raw["halftime"]["first_half_goal_share"],
        bootstrap_iterations=raw["bootstrap"]["iterations"],
        bootstrap_seed=raw["bootstrap"]["seed"],
        ci_width_threshold=raw["bootstrap"]["ci_width_threshold"],
        rating_noise_sigma=raw["bootstrap"]["rating_noise_sigma"],
        lambda_min=raw["lambda_bounds"]["min"],
        lambda_max=raw["lambda_bounds"]["max"],
        stage_adjustments=raw["tournament_stage_adjustments"],
        brier_target=raw["calibration"]["brier_target"],
        elo_max_age_days=raw["data_freshness"]["elo_max_age_days"],
        market_value_max_age_days=raw["data_freshness"]["market_value_max_age_days"],
    )


@lru_cache(maxsize=1)
def load_capitals() -> dict[str, dict[str, float]]:
    return yaml.safe_load((CONFIG_DIR / "capitals.yaml").read_text())  # type: ignore[no-any-return]


@lru_cache(maxsize=1)
def load_confederation_priors() -> dict[str, float]:
    return yaml.safe_load((CONFIG_DIR / "confederation_strength.yaml").read_text())  # type: ignore[no-any-return]
