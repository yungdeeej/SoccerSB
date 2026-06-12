"""Market derivation tests — all 8 v1 market types from one joint distribution."""
from __future__ import annotations

import pytest

from model.bivariate_poisson import build_joint_distribution, predict_match
from model.markets import derive_market_probabilities
from model.params import load_params
from model.types import TeamRating, VenueInfo


@pytest.fixture(scope="module")
def prediction():  # type: ignore[no-untyped-def]
    params = load_params()
    home = TeamRating(short_name="ESP", composite_z=0, rating_points=2000, elo_z=0, rating_basis="elo_only")
    away = TeamRating(short_name="CPV", composite_z=0, rating_points=1600, elo_z=0, rating_basis="elo_only")
    return predict_match(home, away, VenueInfo(is_neutral=True), params)


class TestMarketDerivation:
    def test_all_eight_market_families_present(self, prediction) -> None:  # type: ignore[no-untyped-def]
        keys = set(prediction.predictions.keys())
        assert keys == {
            "match_outcome", "double_chance", "draw_no_bet", "totals",
            "asian_handicap", "both_teams_to_score", "halftime_fulltime", "halftime_totals",
        }

    def test_double_chance_consistency(self, prediction) -> None:  # type: ignore[no-untyped-def]
        mo = prediction.predictions["match_outcome"]
        dc = prediction.predictions["double_chance"]
        assert dc["home_or_draw"] == pytest.approx(mo["home_win_prob"] + mo["draw_prob"], abs=1e-9)
        assert dc["home_or_away"] == pytest.approx(mo["home_win_prob"] + mo["away_win_prob"], abs=1e-9)

    def test_draw_no_bet_is_conditional(self, prediction) -> None:  # type: ignore[no-untyped-def]
        mo = prediction.predictions["match_outcome"]
        dnb = prediction.predictions["draw_no_bet"]
        no_draw = mo["home_win_prob"] + mo["away_win_prob"]
        assert dnb["home_dnb_prob"] == pytest.approx(mo["home_win_prob"] / no_draw, abs=1e-9)
        assert dnb["home_dnb_prob"] + dnb["away_dnb_prob"] == pytest.approx(1.0, abs=1e-9)

    def test_totals_monotonic_in_line(self, prediction) -> None:  # type: ignore[no-untyped-def]
        totals = prediction.predictions["totals"]
        overs = [totals[line]["over"] for line in ["0.5", "1.5", "2.5", "3.5", "4.5"]]
        assert overs == sorted(overs, reverse=True)
        for line in totals.values():
            assert line["over"] + line["under"] == pytest.approx(1.0, abs=1e-9)

    def test_asian_handicap_all_lines_present(self, prediction) -> None:  # type: ignore[no-untyped-def]
        ah = prediction.predictions["asian_handicap"]
        assert len(ah) == 17  # -2.0 … +2.0 in 0.25 steps
        for probs in ah.values():
            assert probs["home_covers"] + probs["away_covers"] == pytest.approx(1.0, abs=1e-9)

    def test_asian_handicap_quarter_line_is_average_of_adjacent(self, prediction) -> None:  # type: ignore[no-untyped-def]
        ah = prediction.predictions["asian_handicap"]
        expected = (ah["-0.5"]["home_covers"] + ah["-1.0"]["home_covers"]) / 2
        assert ah["-0.75"]["home_covers"] == pytest.approx(expected, abs=1e-9)

    def test_asian_handicap_monotonic_in_line(self, prediction) -> None:  # type: ignore[no-untyped-def]
        ah = prediction.predictions["asian_handicap"]
        lines = ["-2.0", "-1.0", "0.0", "+1.0", "+2.0"]
        covers = [ah[ln]["home_covers"] for ln in lines]
        assert covers == sorted(covers)  # more positive handicap → home covers more

    def test_btts_matches_joint_mass(self) -> None:
        params = load_params()
        joint = build_joint_distribution(1.4, 1.2, params)
        pred = derive_market_probabilities(joint, 1.4, 1.2, params)
        btts = pred.predictions["both_teams_to_score"]
        assert isinstance(btts, dict)
        assert btts["yes_prob"] == pytest.approx(float(joint[1:, 1:].sum()), abs=1e-9)
        assert btts["yes_prob"] + btts["no_prob"] == pytest.approx(1.0, abs=1e-9)

    def test_halftime_fulltime_normalized_nine_cells(self, prediction) -> None:  # type: ignore[no-untyped-def]
        ht_ft = prediction.predictions["halftime_fulltime"]
        assert set(ht_ft.keys()) == {"H/H", "H/D", "H/A", "D/H", "D/D", "D/A", "A/H", "A/D", "A/A"}
        assert sum(ht_ft.values()) == pytest.approx(1.0, abs=1e-6)

    def test_halftime_totals_lower_than_fulltime(self, prediction) -> None:  # type: ignore[no-untyped-def]
        ht = prediction.predictions["halftime_totals"]
        ft = prediction.predictions["totals"]
        assert ht["0.5"]["over"] < ft["0.5"]["over"]
        assert ht["1.5"]["over"] < ft["1.5"]["over"]
