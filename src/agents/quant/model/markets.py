"""Derive every v1 market deterministically from the joint goal distribution."""
from __future__ import annotations

import numpy as np
import numpy.typing as npt
from scipy import stats

from model.types import MatchOutcome, MatchPrediction, ModelParams

TOTALS_LINES = [0.5, 1.5, 2.5, 3.5, 4.5]
AH_LINES = [round(x * 0.25, 2) for x in range(-8, 9)]  # -2.0 … +2.0 in 0.25 steps
HT_TOTALS_LINES = [0.5, 1.5]


def derive_market_probabilities(
    joint: npt.NDArray[np.float64],
    lambda_home: float,
    lambda_away: float,
    params: ModelParams,
) -> MatchPrediction:
    n = joint.shape[0]
    h_idx, a_idx = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    diff = h_idx - a_idx
    total = h_idx + a_idx

    home_win = float(joint[diff > 0].sum())
    away_win = float(joint[diff < 0].sum())
    draw = float(joint[diff == 0].sum())

    # Double chance
    double_chance = {
        "home_or_draw": home_win + draw,
        "away_or_draw": away_win + draw,
        "home_or_away": home_win + away_win,
    }

    # Draw no bet (conditional on no draw)
    no_draw = home_win + away_win
    draw_no_bet = {
        "home_dnb_prob": home_win / no_draw if no_draw > 0 else 0.5,
        "away_dnb_prob": away_win / no_draw if no_draw > 0 else 0.5,
    }

    # Totals
    totals: dict[str, dict[str, float]] = {}
    for line in TOTALS_LINES:
        over = float(joint[total > line].sum())
        totals[str(line)] = {"over": over, "under": 1.0 - over}

    # Asian handicap
    asian_handicap: dict[str, dict[str, float]] = {}
    for line in AH_LINES:
        key = f"+{line}" if line > 0 else str(line)
        asian_handicap[key] = _asian_handicap_probs(joint, diff, line)

    # BTTS
    btts_yes = float(joint[1:, 1:].sum())

    # Halftime/fulltime + halftime totals
    ht_ft, ht_totals = _halftime_markets(lambda_home, lambda_away, params)

    return MatchPrediction(
        expected_goals_home=lambda_home,
        expected_goals_away=lambda_away,
        goal_correlation=params.goal_correlation,
        match_outcome=MatchOutcome(home_win_prob=home_win, draw_prob=draw, away_win_prob=away_win),
        predictions={
            "match_outcome": {
                "home_win_prob": home_win,
                "draw_prob": draw,
                "away_win_prob": away_win,
            },
            "double_chance": double_chance,
            "draw_no_bet": draw_no_bet,
            "totals": totals,
            "asian_handicap": asian_handicap,
            "both_teams_to_score": {"yes_prob": btts_yes, "no_prob": 1.0 - btts_yes},
            "halftime_fulltime": ht_ft,
            "halftime_totals": ht_totals,
        },
    )


def _asian_handicap_probs(
    joint: npt.NDArray[np.float64], diff: npt.NDArray[np.intp], line: float
) -> dict[str, float]:
    """
    Home covers when (home_goals - away_goals + line) > 0.
    Whole lines push when margin + line == 0 — push mass split 50/50
    (equivalent to stake-refund EV). Quarter lines split half-stake across
    the two adjacent half/whole lines.
    """
    quarter = round(abs(line * 4)) % 2 == 1  # .25 / .75 lines
    if quarter:
        lower = round(line - 0.25, 2)
        upper = round(line + 0.25, 2)
        lo = _asian_handicap_probs(joint, diff, lower)
        hi = _asian_handicap_probs(joint, diff, upper)
        return {
            "home_covers": (lo["home_covers"] + hi["home_covers"]) / 2,
            "away_covers": (lo["away_covers"] + hi["away_covers"]) / 2,
        }

    adjusted = diff + line
    home_wins = float(joint[adjusted > 1e-9].sum())
    push = float(joint[np.abs(adjusted) <= 1e-9].sum())
    away_wins = max(0.0, 1.0 - home_wins - push)
    return {
        "home_covers": home_wins + push / 2,
        "away_covers": away_wins + push / 2,
    }


def _halftime_markets(
    lambda_home: float, lambda_away: float, params: ModelParams
) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
    """
    First half carries ~45% of expected goals. Build independent first/second
    half grids, convolve for the FT outcome conditional on HT.
    """
    share = params.first_half_goal_share
    h1_lam, a1_lam = lambda_home * share, lambda_away * share
    h2_lam, a2_lam = lambda_home * (1 - share), lambda_away * (1 - share)

    n = 6  # 0-5 goals per team per half is plenty
    goals = np.arange(n)
    p_h1 = stats.poisson.pmf(goals, h1_lam)
    p_a1 = stats.poisson.pmf(goals, a1_lam)
    p_h2 = stats.poisson.pmf(goals, h2_lam)
    p_a2 = stats.poisson.pmf(goals, a2_lam)

    first = np.outer(p_h1, p_a1)
    second = np.outer(p_h2, p_a2)
    first /= first.sum()
    second /= second.sum()

    ht_ft = {k: 0.0 for k in ["H/H", "H/D", "H/A", "D/H", "D/D", "D/A", "A/H", "A/D", "A/A"]}
    for h1 in range(n):
        for a1 in range(n):
            p1 = first[h1, a1]
            if p1 < 1e-12:
                continue
            ht = "H" if h1 > a1 else "A" if a1 > h1 else "D"
            for h2 in range(n):
                for a2 in range(n):
                    p2 = second[h2, a2]
                    if p2 < 1e-12:
                        continue
                    fh, fa = h1 + h2, a1 + a2
                    ft = "H" if fh > fa else "A" if fa > fh else "D"
                    ht_ft[f"{ht}/{ft}"] += float(p1 * p2)

    norm = sum(ht_ft.values())
    ht_ft = {k: v / norm for k, v in ht_ft.items()}

    ht_total_grid = np.add.outer(goals, goals)
    ht_totals: dict[str, dict[str, float]] = {}
    for line in HT_TOTALS_LINES:
        over = float(first[ht_total_grid > line].sum())
        ht_totals[str(line)] = {"over": over, "under": 1.0 - over}

    return ht_ft, ht_totals
