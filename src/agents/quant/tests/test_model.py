"""Model core tests — Bivariate Poisson, draw inflation, venue factor, bootstrap."""
from __future__ import annotations

import numpy as np
import pytest

from model.bivariate_poisson import build_joint_distribution, compute_lambdas, predict_match
from model.bootstrap import bootstrap_confidence
from model.composite_rating import TeamSignals, compute_composite_rating, compute_field_stats
from model.draw_inflation import apply_draw_inflation
from model.params import load_params
from model.types import TeamRating, VenueInfo
from model.venue_factor import venue_factor


def team(code: str, points: float) -> TeamRating:
    return TeamRating(short_name=code, composite_z=0.0, rating_points=points, elo_z=0.0, rating_basis="elo_only")


NEUTRAL = VenueInfo(is_neutral=True)


@pytest.fixture(scope="module")
def params():  # type: ignore[no-untyped-def]
    return load_params()


class TestBivariatePoisson:
    def test_joint_distribution_sums_to_one(self, params) -> None:  # type: ignore[no-untyped-def]
        joint = build_joint_distribution(1.5, 1.1, params)
        assert joint.sum() == pytest.approx(1.0, abs=1e-9)
        assert (joint >= 0).all()

    def test_stronger_team_gets_higher_lambda(self, params) -> None:  # type: ignore[no-untyped-def]
        lh, la = compute_lambdas(team("A", 2000), team("B", 1700), NEUTRAL, params)
        assert lh > la

    def test_equal_teams_equal_lambdas_on_neutral(self, params) -> None:  # type: ignore[no-untyped-def]
        lh, la = compute_lambdas(team("A", 1800), team("B", 1800), NEUTRAL, params)
        assert lh == pytest.approx(la, abs=1e-9)

    def test_lambdas_clipped_to_bounds(self, params) -> None:  # type: ignore[no-untyped-def]
        lh, la = compute_lambdas(team("A", 2600), team("B", 1000), NEUTRAL, params)
        assert params.lambda_min <= lh <= params.lambda_max
        assert params.lambda_min <= la <= params.lambda_max

    def test_outcome_probs_ordered_by_strength(self, params) -> None:  # type: ignore[no-untyped-def]
        pred = predict_match(team("A", 2050), team("B", 1750), NEUTRAL, params)
        mo = pred.match_outcome
        assert mo.home_win_prob > mo.away_win_prob
        assert mo.home_win_prob + mo.draw_prob + mo.away_win_prob == pytest.approx(1.0, abs=1e-9)

    def test_knockout_stage_reduces_goals(self, params) -> None:  # type: ignore[no-untyped-def]
        lh_group, _ = compute_lambdas(team("A", 1900), team("B", 1800), NEUTRAL, params, stage="group_md1")
        lh_final, _ = compute_lambdas(team("A", 1900), team("B", 1800), NEUTRAL, params, stage="final")
        assert lh_final < lh_group


class TestDrawInflation:
    def test_raises_draw_probability(self) -> None:
        joint = np.outer(
            np.array([0.3, 0.4, 0.2, 0.1]), np.array([0.35, 0.35, 0.2, 0.1])
        )
        joint = joint / joint.sum()
        before = float(np.trace(joint))
        inflated = apply_draw_inflation(joint, 1.2)
        after = float(np.trace(inflated))
        assert after > before
        assert inflated.sum() == pytest.approx(1.0, abs=1e-12)

    def test_factor_one_is_identity(self) -> None:
        joint = np.full((3, 3), 1 / 9)
        out = apply_draw_inflation(joint, 1.0)
        np.testing.assert_allclose(out, joint)

    def test_invalid_factor_raises(self) -> None:
        with pytest.raises(ValueError):
            apply_draw_inflation(np.full((3, 3), 1 / 9), 0.0)


class TestVenueFactor:
    def test_host_nation_boost(self, params) -> None:  # type: ignore[no-untyped-def]
        azteca = VenueInfo(country="Mexico", altitude_meters=2240, is_high_altitude=True, is_neutral=False)
        f = venue_factor(azteca, "MEX", "ARG", params)
        # Host boost 1.14 × altitude swing 1.06 (MEX acclimated, ARG sea level)
        assert f == pytest.approx(1.14 * 1.06, rel=1e-6)

    def test_altitude_penalty_when_away_acclimated(self, params) -> None:  # type: ignore[no-untyped-def]
        azteca_neutral = VenueInfo(country="Mexico", altitude_meters=2240, is_high_altitude=True)
        # ECU (Quito 2850m) acclimated vs ENG sea level — ECU as away side
        f = venue_factor(azteca_neutral, "ENG", "ECU", params)
        assert f < 1.0

    def test_neutral_no_factors(self, params) -> None:  # type: ignore[no-untyped-def]
        f = venue_factor(VenueInfo(is_neutral=True), "FRA", "SEN", params)
        assert f == pytest.approx(1.0)

    def test_travel_asymmetry(self, params) -> None:  # type: ignore[no-untyped-def]
        # Vancouver venue: JPN travels far less than... actually use MEX (close) vs AUS (far)
        bc_place = VenueInfo(country="Canada", latitude=49.2768, longitude=-123.1119, altitude_meters=5)
        f = venue_factor(bc_place, "MEX", "AUS", params)
        assert f > 1.0  # Mexico's travel burden is far smaller


class TestCompositeRating:
    def make_field(self) -> list[TeamSignals]:
        return [
            TeamSignals("AAA", 2000, 800, {"xg90_attacking": 2.0, "xga90_defensive": 1.0, "weighted_minutes": 5000}),
            TeamSignals("BBB", 1800, 200, {"xg90_attacking": 1.5, "xga90_defensive": 1.2, "weighted_minutes": 4000}),
            TeamSignals("CCC", 1600, 50, None),
            TeamSignals("DDD", 1700, None, None),
        ]

    def test_full_basis_when_all_signals(self) -> None:
        field = compute_field_stats(self.make_field())
        r = compute_composite_rating(self.make_field()[0], field, load_params())
        assert r.rating_basis == "full"
        assert r.composite_z > 0

    def test_low_data_basis_without_club_xg(self) -> None:
        field = compute_field_stats(self.make_field())
        r = compute_composite_rating(self.make_field()[2], field, load_params())
        assert r.rating_basis == "low_data"

    def test_elo_only_basis_without_market_value(self) -> None:
        field = compute_field_stats(self.make_field())
        r = compute_composite_rating(self.make_field()[3], field, load_params())
        assert r.rating_basis == "elo_only"
        assert r.rating_points == pytest.approx(field.elo_mean + r.composite_z * field.elo_stddev)


class TestBootstrap:
    def test_reproducible_with_same_seed(self, params) -> None:  # type: ignore[no-untyped-def]
        a = bootstrap_confidence(team("A", 1900), team("B", 1800), NEUTRAL, params, n_iterations=100)
        b = bootstrap_confidence(team("A", 1900), team("B", 1800), NEUTRAL, params, n_iterations=100)
        assert a.home_win_ci_width == b.home_win_ci_width
        assert a.draw_ci_width == b.draw_ci_width

    def test_low_confidence_flag_logic(self, params) -> None:  # type: ignore[no-untyped-def]
        ci = bootstrap_confidence(team("A", 1900), team("B", 1800), NEUTRAL, params, n_iterations=200)
        expected = any(
            w > params.ci_width_threshold
            for w in (ci.home_win_ci_width, ci.draw_ci_width, ci.away_win_ci_width)
        )
        assert ci.low_confidence_flag == expected
