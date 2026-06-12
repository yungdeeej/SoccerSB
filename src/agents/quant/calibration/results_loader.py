"""Historical international results — martj42 open dataset (1872-present).

Used for (a) point-in-time Elo in backtests, (b) Elo fallback if eloratings.net
is unreachable. Cached locally; never re-downloaded per run.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx
import pandas as pd

RESULTS_URL = "https://raw.githubusercontent.com/martj42/international_results/master/results.csv"
DATA_DIR = Path(__file__).parent / "data"
RESULTS_CSV = DATA_DIR / "results.csv"


@dataclass(frozen=True)
class HistoricalMatch:
    match_date: date
    home_team: str
    away_team: str
    home_score: int
    away_score: int
    tournament: str
    country: str
    neutral: bool


def download_results(force: bool = False) -> Path:
    DATA_DIR.mkdir(exist_ok=True)
    if RESULTS_CSV.exists() and not force:
        return RESULTS_CSV
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        resp = client.get(RESULTS_URL)
        resp.raise_for_status()
        RESULTS_CSV.write_bytes(resp.content)
    return RESULTS_CSV


def load_results() -> list[HistoricalMatch]:
    """All completed internationals, chronological."""
    path = download_results()
    df = pd.read_csv(path)
    df = df.dropna(subset=["home_score", "away_score"])
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df = df.sort_values("date")

    matches: list[HistoricalMatch] = []
    for row in df.itertuples(index=False):
        matches.append(
            HistoricalMatch(
                match_date=row.date,
                home_team=str(row.home_team),
                away_team=str(row.away_team),
                home_score=int(row.home_score),
                away_score=int(row.away_score),
                tournament=str(row.tournament),
                country=str(row.country),
                neutral=bool(row.neutral),
            )
        )
    return matches
