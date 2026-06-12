"""Point-in-time Elo engine — eloratings.net methodology over the full match history.

Replaying chronologically gives the rating any team had on any historical date,
which is what makes the backtest leak-free (no information from the future).
"""
from __future__ import annotations

from collections.abc import Iterator

from calibration.results_loader import HistoricalMatch

INITIAL_ELO = 1500.0
HOME_ADVANTAGE = 100.0


def k_factor(tournament: str) -> float:
    t = tournament.lower()
    if t == "fifa world cup":
        return 60.0
    if "world cup" in t and "qualification" in t:
        return 40.0
    if any(
        name in t
        for name in (
            "uefa euro", "copa américa", "copa america", "african cup of nations",
            "africa cup of nations", "afc asian cup", "gold cup", "concacaf championship",
            "oceania nations cup", "ofc nations cup",
        )
    ):
        return 40.0 if "qualification" in t else 50.0
    if any(name in t for name in ("confederations cup", "nations league", "intercontinental")):
        return 40.0
    if t == "friendly":
        return 20.0
    return 30.0


def goal_diff_multiplier(diff: int) -> float:
    d = abs(diff)
    if d <= 1:
        return 1.0
    if d == 2:
        return 1.5
    return 1.75 + max(0, d - 3) / 8.0


def expected_score(elo_a: float, elo_b: float, home_advantage: float) -> float:
    return 1.0 / (1.0 + 10 ** (-(elo_a + home_advantage - elo_b) / 400.0))


class EloEngine:
    """Stateful Elo table updated match by match."""

    def __init__(self, seed: dict[str, float] | None = None) -> None:
        self.ratings: dict[str, float] = dict(seed) if seed else {}

    def get(self, team: str) -> float:
        return self.ratings.get(team, INITIAL_ELO)

    def update(self, match: HistoricalMatch) -> None:
        home, away = match.home_team, match.away_team
        r_home, r_away = self.get(home), self.get(away)

        home_adv = 0.0 if match.neutral else HOME_ADVANTAGE
        exp_home = expected_score(r_home, r_away, home_adv)

        if match.home_score > match.away_score:
            actual = 1.0
        elif match.home_score < match.away_score:
            actual = 0.0
        else:
            actual = 0.5

        k = k_factor(match.tournament) * goal_diff_multiplier(match.home_score - match.away_score)
        delta = k * (actual - exp_home)
        self.ratings[home] = r_home + delta
        self.ratings[away] = r_away - delta


def replay_until(
    matches: list[HistoricalMatch],
    stop_predicate: object = None,
) -> Iterator[tuple[EloEngine, HistoricalMatch]]:
    """
    Yield (engine_state_before_match, match) for every match, updating after the yield.
    Caller inspects ratings BEFORE the match is applied — point-in-time correctness.
    """
    engine = EloEngine()
    for match in matches:
        yield engine, match
        engine.update(match)
