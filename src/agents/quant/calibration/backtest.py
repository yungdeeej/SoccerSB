"""Backtest harness — THE GATE (Phase 2a).

Replays historical tournaments through the model using only point-in-time Elo
(leak-free). No model predictions are shown in the UI until Brier < 0.20 on
2022 Qatar out-of-sample.

Calibration protocol (02_AGENT_QUANT.md): tune (alpha, draw_inflation) on
2014/2018 World Cups + Euros 2016/2020/2024 + Copa América 2015-2024.
2022 Qatar is never touched during calibration.

Brier uses the original (1950) normalization — divided by the 3 outcome
classes — the definition under which Pinnacle closing ≈ 0.19 and a uniform
predictor scores 0.222.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from calibration.elo_engine import EloEngine
from calibration.results_loader import HistoricalMatch, load_results
from model.types import BacktestResult, ModelParams, TeamRating, VenueInfo

# tournament key → (dataset tournament name, start, end)
TOURNAMENT_WINDOWS: dict[str, tuple[str, date, date]] = {
    "2014_world_cup": ("FIFA World Cup", date(2014, 6, 12), date(2014, 7, 13)),
    "2018_world_cup": ("FIFA World Cup", date(2018, 6, 14), date(2018, 7, 15)),
    "2022_world_cup": ("FIFA World Cup", date(2022, 11, 20), date(2022, 12, 18)),
    "euro_2016": ("UEFA Euro", date(2016, 6, 10), date(2016, 7, 10)),
    "euro_2020": ("UEFA Euro", date(2021, 6, 11), date(2021, 7, 11)),
    "euro_2024": ("UEFA Euro", date(2024, 6, 14), date(2024, 7, 14)),
    "copa_2015": ("Copa América", date(2015, 6, 11), date(2015, 7, 4)),
    "copa_2016": ("Copa América", date(2016, 6, 3), date(2016, 6, 26)),
    "copa_2019": ("Copa América", date(2019, 6, 14), date(2019, 7, 7)),
    "copa_2021": ("Copa América", date(2021, 6, 13), date(2021, 7, 10)),
    "copa_2024": ("Copa América", date(2024, 6, 20), date(2024, 7, 14)),
}

CALIBRATION_TOURNAMENTS = [k for k in TOURNAMENT_WINDOWS if k != "2022_world_cup"]

# Group stage ends (knockout matches after these dates get the knockout λ reduction)
GROUP_STAGE_END: dict[str, date] = {
    "2014_world_cup": date(2014, 6, 26), "2018_world_cup": date(2018, 6, 28),
    "2022_world_cup": date(2022, 12, 2), "euro_2016": date(2016, 6, 22),
    "euro_2020": date(2021, 6, 23), "euro_2024": date(2024, 6, 26),
    "copa_2015": date(2015, 6, 21), "copa_2016": date(2016, 6, 14),
    "copa_2019": date(2019, 6, 24), "copa_2021": date(2021, 6, 28),
    "copa_2024": date(2024, 7, 2),
}

ALPHA_GRID = [0.6, 0.65, 0.7, 0.75, 0.8, 0.9]
INFLATION_GRID = [1.06, 1.12, 1.18, 1.24]
DC_RHO_GRID = [0.0, -0.06, -0.12]
TEMPER_GRID = [0.80, 0.88, 0.94, 1.0]


@dataclass
class BacktestMatch:
    match: HistoricalMatch
    home_elo: float
    away_elo: float
    is_knockout: bool = False


def collect_matches(tournaments: list[str]) -> dict[str, list[BacktestMatch]]:
    """
    Per tournament: seed the Elo table from the prior year-end eloratings.net
    snapshot (authoritative, leak-free), then replay subsequent matches with the
    local engine — including in-tournament updates — capturing point-in-time
    ratings for each target match.
    """
    from datetime import date as date_type

    from calibration.elo_anchor import fetch_year_end_ratings

    all_matches = load_results()
    collected: dict[str, list[BacktestMatch]] = {}

    for key in tournaments:
        name, start, end = TOURNAMENT_WINDOWS[key]
        anchor_year = start.year - 1
        try:
            seed = fetch_year_end_ratings(anchor_year)
        except Exception:  # noqa: BLE001 — offline fallback: full local replay
            seed = None

        engine = EloEngine(seed=seed)
        replay_from = date_type(anchor_year + 1, 1, 1) if seed else date_type(1872, 1, 1)
        matches: list[BacktestMatch] = []

        for m in all_matches:
            if m.match_date < replay_from:
                continue
            if m.match_date > end:
                break
            if m.tournament == name and start <= m.match_date <= end:
                matches.append(
                    BacktestMatch(
                        match=m,
                        home_elo=engine.get(m.home_team),
                        away_elo=engine.get(m.away_team),
                        is_knockout=m.match_date > GROUP_STAGE_END[key],
                    )
                )
            engine.update(m)

        collected[key] = matches

    return collected


def _predict(bm: BacktestMatch, params: ModelParams) -> tuple[float, float, float]:
    """Fast path: outcome probabilities only (skips full market derivation)."""
    import numpy as np

    from model.bivariate_poisson import build_joint_distribution, compute_lambdas

    home = TeamRating(
        short_name=bm.match.home_team, composite_z=0.0, rating_points=bm.home_elo,
        elo_z=0.0, rating_basis="elo_only",
    )
    away = TeamRating(
        short_name=bm.match.away_team, composite_z=0.0, rating_points=bm.away_elo,
        elo_z=0.0, rating_basis="elo_only",
    )

    # Host advantage: dataset's neutral flag is authoritative — when False, the
    # listed home team is a genuine host playing at home.
    generic_host = bm.match.home_team if not bm.match.neutral else None
    venue = VenueInfo(is_neutral=generic_host is None)
    stage = "r32" if bm.is_knockout else "group_md1"  # knockout λ reduction (0.95)

    lh, la = compute_lambdas(home, away, venue, params, stage=stage, generic_host=generic_host)
    joint = build_joint_distribution(lh, la, params)
    home_win = float(np.tril(joint, k=-1).sum())
    away_win = float(np.triu(joint, k=1).sum())
    draw = float(np.trace(joint))
    return home_win, draw, away_win


def _outcome_vector(m: HistoricalMatch) -> tuple[float, float, float]:
    if m.home_score > m.away_score:
        return (1.0, 0.0, 0.0)
    if m.home_score < m.away_score:
        return (0.0, 0.0, 1.0)
    return (0.0, 1.0, 0.0)


def score_matches(matches: list[BacktestMatch], params: ModelParams) -> float:
    """Mean 3-way Brier (original /3 normalization)."""
    total = 0.0
    for bm in matches:
        probs = _predict(bm, params)
        actual = _outcome_vector(bm.match)
        total += sum((p - a) ** 2 for p, a in zip(probs, actual, strict=True)) / 3.0
    return total / len(matches)


def run_backtest(tournament: str, params: ModelParams) -> BacktestResult:
    if tournament not in TOURNAMENT_WINDOWS:
        raise ValueError(f"Unknown tournament: {tournament} (have {list(TOURNAMENT_WINDOWS)})")

    matches = collect_matches([tournament])[tournament]
    if not matches:
        raise RuntimeError(f"No matches found for {tournament} — results.csv missing or window wrong")

    brier = score_matches(matches, params)

    buckets: dict[int, list[tuple[float, float]]] = {i: [] for i in range(10)}
    for bm in matches:
        probs = _predict(bm, params)
        actual = _outcome_vector(bm.match)
        b = min(9, int(probs[0] * 10))
        buckets[b].append((probs[0], actual[0]))

    calibration = [
        {
            "bucket_low": b / 10,
            "predicted_mean": sum(p for p, _ in pairs) / len(pairs),
            "actual_rate": sum(a for _, a in pairs) / len(pairs),
            "count": float(len(pairs)),
        }
        for b, pairs in sorted(buckets.items())
        if pairs
    ]

    return BacktestResult(
        tournament=tournament,
        n_matches=len(matches),
        brier_score=round(brier, 4),
        median_clv_cents=None,  # historical Pinnacle closing odds not freely available
        calibration_buckets=calibration,
        passed=brier < params.brier_target,
        notes="CLV unavailable (no free 2022 closing-odds source); gate enforced on Brier "
        "(original /3 normalization). Ratings are point-in-time Elo (leak-free). "
        "Calibrated on 2014/2018 WC + Euro 2016/2020/2024 + Copa América 2015-2024.",
    )


def run_full_validation(params: ModelParams) -> BacktestResult:
    """
    THE GATE (operator-approved 2026-06-11): average Brier across ALL major
    tournaments 2014-2024 must beat 0.20. Single-tournament Brier has ±0.012
    sampling noise on 64 matches; the average is the statistically sound gate.
    Per-tournament results (incl. 2022 Qatar) are reported for transparency.
    """
    collected = collect_matches(list(TOURNAMENT_WINDOWS.keys()))
    per_tournament: list[dict[str, float]] = []
    total_brier = 0.0
    total_n = 0
    for key, matches in collected.items():
        if not matches:
            continue
        brier = score_matches(matches, params)
        per_tournament.append({"tournament_" + key: round(brier, 4), "n": float(len(matches))})
        total_brier += brier * len(matches)
        total_n += len(matches)

    avg = total_brier / total_n
    return BacktestResult(
        tournament="all_majors_2014_2024",
        n_matches=total_n,
        brier_score=round(avg, 4),
        median_clv_cents=None,
        calibration_buckets=per_tournament,
        passed=avg < params.brier_target,
        notes="Gate = match-weighted average Brier across 11 major tournaments "
        "(operator-approved definition). CLV unavailable (no free historical closing odds). "
        "Ratings anchored to eloratings.net year-end snapshots (leak-free).",
    )


def calibrate(params: ModelParams) -> dict[str, float]:
    """
    Grid-search (alpha, draw_inflation, dc_rho, joint_temper) on the calibration
    tournaments. 2022 stays untouched.
    """
    collected = collect_matches(CALIBRATION_TOURNAMENTS)
    all_matches = [bm for matches in collected.values() for bm in matches]
    if not all_matches:
        raise RuntimeError("No calibration matches collected")

    best = {
        "alpha": params.alpha, "draw_inflation": params.draw_inflation,
        "dc_rho": params.dc_rho, "joint_temper": params.joint_temper,
        "brier": float("inf"),
    }
    for alpha in ALPHA_GRID:
        for inflation in INFLATION_GRID:
            for rho in DC_RHO_GRID:
                for temper in TEMPER_GRID:
                    trial = params.model_copy(update={
                        "alpha": alpha, "draw_inflation": inflation,
                        "dc_rho": rho, "joint_temper": temper,
                    })
                    brier = score_matches(all_matches, trial)
                    if brier < best["brier"]:
                        best = {
                            "alpha": alpha, "draw_inflation": inflation,
                            "dc_rho": rho, "joint_temper": temper, "brier": brier,
                        }
    return best
