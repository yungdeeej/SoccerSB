"""Bootstrap confidence intervals — seeded, reproducible (rule 5: same inputs → same outputs)."""
from __future__ import annotations

import numpy as np

from model.bivariate_poisson import predict_match
from model.types import ConfidenceInterval, ModelParams, TeamRating, VenueInfo


def _noise_sigma(team: TeamRating, base_sigma: float) -> float:
    """Noise scales with data quality: thinner rating bases get wider noise."""
    multiplier = {"full": 1.0, "low_data": 1.4, "elo_only": 1.8}.get(team.rating_basis, 1.8)
    return base_sigma * multiplier


def bootstrap_confidence(
    home: TeamRating,
    away: TeamRating,
    venue: VenueInfo,
    params: ModelParams,
    stage: str = "group_md1",
    weather_xg_offset: float = 0.0,
    generic_host: str | None = None,
    n_iterations: int | None = None,
) -> ConfidenceInterval:
    iters = n_iterations if n_iterations is not None else params.bootstrap_iterations
    rng = np.random.default_rng(params.bootstrap_seed)

    home_sigma = _noise_sigma(home, params.rating_noise_sigma)
    away_sigma = _noise_sigma(away, params.rating_noise_sigma)

    home_samples = np.empty(iters)
    draw_samples = np.empty(iters)
    away_samples = np.empty(iters)

    for i in range(iters):
        home_resampled = home.model_copy(
            update={"rating_points": home.rating_points + float(rng.normal(0, home_sigma))}
        )
        away_resampled = away.model_copy(
            update={"rating_points": away.rating_points + float(rng.normal(0, away_sigma))}
        )
        pred = predict_match(
            home_resampled, away_resampled, venue, params, stage, weather_xg_offset, generic_host
        )
        home_samples[i] = pred.match_outcome.home_win_prob
        draw_samples[i] = pred.match_outcome.draw_prob
        away_samples[i] = pred.match_outcome.away_win_prob

    def width(samples: np.ndarray[tuple[int], np.dtype[np.float64]]) -> float:
        return float(np.percentile(samples, 95) - np.percentile(samples, 5))

    h_w, d_w, a_w = width(home_samples), width(draw_samples), width(away_samples)
    return ConfidenceInterval(
        iterations=iters,
        home_win_ci_width=h_w,
        draw_ci_width=d_w,
        away_win_ci_width=a_w,
        low_confidence_flag=any(w > params.ci_width_threshold for w in (h_w, d_w, a_w)),
    )
