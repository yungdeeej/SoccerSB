"""Backtest harness tests — Elo engine correctness + gate machinery."""
from __future__ import annotations

from datetime import date

import pytest

from calibration.elo_engine import EloEngine, expected_score, goal_diff_multiplier, k_factor
from calibration.results_loader import HistoricalMatch


def match(home: str, away: str, hs: int, as_: int, tournament: str = "Friendly",
          neutral: bool = False) -> HistoricalMatch:
    return HistoricalMatch(
        match_date=date(2020, 1, 1), home_team=home, away_team=away,
        home_score=hs, away_score=as_, tournament=tournament, country="X", neutral=neutral,
    )


class TestEloEngine:
    def test_k_factors(self) -> None:
        assert k_factor("FIFA World Cup") == 60
        assert k_factor("FIFA World Cup qualification") == 40
        assert k_factor("UEFA Euro") == 50
        assert k_factor("Copa América") == 50
        assert k_factor("UEFA Euro qualification") == 40
        assert k_factor("Friendly") == 20
        assert k_factor("Some Random Cup") == 30

    def test_goal_diff_multiplier(self) -> None:
        assert goal_diff_multiplier(1) == 1.0
        assert goal_diff_multiplier(2) == 1.5
        assert goal_diff_multiplier(3) == 1.75
        assert goal_diff_multiplier(5) == 1.75 + 2 / 8

    def test_expected_score_symmetry(self) -> None:
        assert expected_score(1800, 1800, 0) == pytest.approx(0.5)
        assert expected_score(1900, 1800, 0) + expected_score(1800, 1900, 0) == pytest.approx(1.0)

    def test_win_transfers_points(self) -> None:
        engine = EloEngine(seed={"A": 1800.0, "B": 1800.0})
        engine.update(match("A", "B", 2, 0, neutral=True))
        assert engine.get("A") > 1800
        assert engine.get("B") < 1800
        # Zero-sum
        assert engine.get("A") + engine.get("B") == pytest.approx(3600.0)

    def test_home_advantage_dampens_home_win_gain(self) -> None:
        neutral_engine = EloEngine(seed={"A": 1800.0, "B": 1800.0})
        neutral_engine.update(match("A", "B", 1, 0, neutral=True))
        home_engine = EloEngine(seed={"A": 1800.0, "B": 1800.0})
        home_engine.update(match("A", "B", 1, 0, neutral=False))
        # Winning at home is less impressive — smaller gain
        assert home_engine.get("A") < neutral_engine.get("A")

    def test_draw_against_stronger_team_gains_points(self) -> None:
        engine = EloEngine(seed={"Weak": 1600.0, "Strong": 2000.0})
        engine.update(match("Weak", "Strong", 1, 1, neutral=True))
        assert engine.get("Weak") > 1600

    def test_seeded_ratings_used(self) -> None:
        engine = EloEngine(seed={"Qatar": 1682.0})
        assert engine.get("Qatar") == 1682.0
        assert engine.get("Unknown Team") == 1500.0
