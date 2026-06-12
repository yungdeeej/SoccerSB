"""Composite power rating — Elo + market value + club xG blend (02_AGENT_QUANT.md)."""
from __future__ import annotations

import math

from model.types import FieldStats, ModelParams, TeamRating


class TeamSignals:
    """Raw rating signals for one team (from DB / loaders)."""

    def __init__(
        self,
        short_name: str,
        elo: float,
        market_value_eur_m: float | None = None,
        club_xg_aggregate: dict[str, float] | None = None,
    ) -> None:
        self.short_name = short_name
        self.elo = elo
        self.market_value_eur_m = market_value_eur_m
        self.club_xg_aggregate = club_xg_aggregate


def compute_field_stats(teams: list[TeamSignals]) -> FieldStats:
    """Distribution of each signal across the World Cup field."""
    elos = [t.elo for t in teams]
    elo_mean = sum(elos) / len(elos)
    elo_std = max(1e-9, _stddev(elos, elo_mean))

    mv_logs = [math.log(max(t.market_value_eur_m, 1.0)) for t in teams if t.market_value_eur_m is not None]
    mv_mean = sum(mv_logs) / len(mv_logs) if mv_logs else None
    mv_std = max(1e-9, _stddev(mv_logs, mv_mean)) if mv_mean is not None and len(mv_logs) > 1 else None

    xgs = [
        _xg_signal(t.club_xg_aggregate)
        for t in teams
        if t.club_xg_aggregate is not None and t.club_xg_aggregate.get("weighted_minutes", 0) >= 1000
    ]
    xg_mean = sum(xgs) / len(xgs) if xgs else None
    xg_std = max(1e-9, _stddev(xgs, xg_mean)) if xg_mean is not None and len(xgs) > 1 else None

    return FieldStats(
        elo_mean=elo_mean,
        elo_stddev=elo_std,
        market_value_log_mean=mv_mean,
        market_value_log_stddev=mv_std,
        xg_mean=xg_mean,
        xg_stddev=xg_std,
    )


def compute_composite_rating(team: TeamSignals, field: FieldStats, params: ModelParams) -> TeamRating:
    """Blend signals with z-scores; degrade gracefully when signals are missing."""
    elo_z = (team.elo - field.elo_mean) / field.elo_stddev

    mv_z: float | None = None
    if (
        team.market_value_eur_m is not None
        and field.market_value_log_mean is not None
        and field.market_value_log_stddev is not None
    ):
        mv_log = math.log(max(team.market_value_eur_m, 1.0))
        mv_z = (mv_log - field.market_value_log_mean) / field.market_value_log_stddev

    xg_z: float | None = None
    has_club_xg = (
        team.club_xg_aggregate is not None
        and team.club_xg_aggregate.get("weighted_minutes", 0) >= 1000
        and field.xg_mean is not None
        and field.xg_stddev is not None
    )
    if has_club_xg:
        assert team.club_xg_aggregate is not None and field.xg_mean is not None and field.xg_stddev is not None
        xg_z = (_xg_signal(team.club_xg_aggregate) - field.xg_mean) / field.xg_stddev

    if has_club_xg and mv_z is not None:
        assert xg_z is not None
        composite = params.elo_weight * elo_z + params.market_value_weight * mv_z + params.club_xg_weight * xg_z
        basis = "full"
    elif mv_z is not None:
        composite = params.low_data_elo_weight * elo_z + params.low_data_market_value_weight * mv_z
        basis = "low_data"
    else:
        composite = elo_z
        basis = "elo_only"

    return TeamRating(
        short_name=team.short_name,
        composite_z=composite,
        # Project the blended z back onto the Elo scale: market value / club xG
        # shift a team's effective Elo within the field distribution.
        rating_points=field.elo_mean + composite * field.elo_stddev,
        elo_z=elo_z,
        market_value_z=mv_z,
        xg_z=xg_z,
        rating_basis=basis,
    )


def attack_multiplier(rating_diff_points: float, params: ModelParams) -> float:
    """Elo-style rating difference (points) → goal multiplier for the stronger side."""
    return math.exp(params.alpha * rating_diff_points / 400.0)


def defense_multiplier(rating_diff_points: float, params: ModelParams) -> float:
    """Inverse multiplier — kept for symmetry with the spec's formula."""
    return math.exp(-params.alpha * rating_diff_points / 400.0)


def _xg_signal(agg: dict[str, float]) -> float:
    """Net club xG signal: attacking xG90 minus defensive xGA90."""
    return float(agg.get("xg90_attacking", 0.0)) - float(agg.get("xga90_defensive", 0.0))


def _stddev(values: list[float], mean: float | None) -> float:
    if mean is None or len(values) < 2:
        return 0.0
    return math.sqrt(sum((v - mean) ** 2 for v in values) / (len(values) - 1))
