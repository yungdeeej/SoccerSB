"""Core pydantic types shared across the Quant service."""
from __future__ import annotations

from pydantic import BaseModel


class ModelParams(BaseModel):
    """Flattened view of config/model_params.yaml."""

    model_version: str
    goal_correlation: float
    max_goals_grid: int
    draw_inflation: float
    dc_rho: float
    joint_temper: float
    elo_weight: float
    market_value_weight: float
    club_xg_weight: float
    low_data_elo_weight: float
    low_data_market_value_weight: float
    base_goals_per_team: float
    alpha: float
    host_boosts: dict[str, float]
    generic_host_boost: float
    altitude_2000plus_swing: float
    altitude_1500_2000_swing: float
    travel_advantage_per_1000km: float
    travel_advantage_cap: float
    first_half_goal_share: float
    bootstrap_iterations: int
    bootstrap_seed: int
    ci_width_threshold: float
    rating_noise_sigma: float
    lambda_min: float
    lambda_max: float
    stage_adjustments: dict[str, float]
    brier_target: float
    elo_max_age_days: int
    market_value_max_age_days: int


class TeamRating(BaseModel):
    short_name: str
    composite_z: float
    """Elo-like absolute rating points — the scale the goal model consumes.
    For pure-Elo ratings this IS the Elo; blended signals shift it within the field."""
    rating_points: float
    elo_z: float
    market_value_z: float | None = None
    xg_z: float | None = None
    rating_basis: str  # 'full' | 'low_data' | 'elo_only'


class FieldStats(BaseModel):
    """Distribution of rating signals across the 48-team World Cup field."""

    elo_mean: float
    elo_stddev: float
    market_value_log_mean: float | None = None
    market_value_log_stddev: float | None = None
    xg_mean: float | None = None
    xg_stddev: float | None = None


class VenueInfo(BaseModel):
    name: str | None = None
    country: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    altitude_meters: int = 0
    is_high_altitude: bool = False
    is_neutral: bool = True  # neither side is host nation playing at home


class MatchOutcome(BaseModel):
    home_win_prob: float
    draw_prob: float
    away_win_prob: float


class ConfidenceInterval(BaseModel):
    method: str = "bootstrap"
    iterations: int
    home_win_ci_width: float
    draw_ci_width: float
    away_win_ci_width: float
    low_confidence_flag: bool


class MatchPrediction(BaseModel):
    expected_goals_home: float
    expected_goals_away: float
    goal_correlation: float
    predictions: dict[str, object]  # full market tree per 07 contract
    match_outcome: MatchOutcome


class BacktestResult(BaseModel):
    tournament: str
    n_matches: int
    brier_score: float
    median_clv_cents: float | None
    calibration_buckets: list[dict[str, float]]
    passed: bool
    notes: str = ""
