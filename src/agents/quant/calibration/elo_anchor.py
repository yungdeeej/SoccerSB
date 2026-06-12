"""Authoritative Elo anchors — eloratings.net year-end snapshots.

Backtests seed from the prior year-end snapshot (the same authoritative source
the live system uses), then replay the remaining months with the local engine.
Leak-free: the anchor predates the tournament.
"""
from __future__ import annotations

from pathlib import Path

import httpx

DATA_DIR = Path(__file__).parent / "data"
USER_AGENT = "ThePitch/1.0 (personal research tool)"

# eloratings name → martj42 dataset name, where they differ
NAME_FIXUPS: dict[str, str] = {
    "Czechia": "Czech Republic",
    "Türkiye": "Turkey",
    "Cabo Verde": "Cape Verde",
    "Korea Republic": "South Korea",
    "Côte d'Ivoire": "Ivory Coast",
    "Curaçao": "Curaçao",
    "Bosnia-Herzegovina": "Bosnia and Herzegovina",
    "Republic of Ireland": "Republic of Ireland",
}


def _fetch(url: str, cache: Path) -> str:
    if cache.exists():
        return cache.read_text()
    DATA_DIR.mkdir(exist_ok=True)
    with httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=30) as client:
        resp = client.get(url)
        resp.raise_for_status()
        cache.write_text(resp.text)
        return resp.text


def fetch_year_end_ratings(year: int) -> dict[str, float]:
    """Returns dataset-team-name → Elo at the end of `year`."""
    teams_text = _fetch("https://eloratings.net/en.teams.tsv", DATA_DIR / "elo_teams.tsv")
    code_to_name: dict[str, str] = {}
    for line in teams_text.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            code_to_name[parts[0].strip()] = parts[1].strip()

    year_text = _fetch(f"https://eloratings.net/{year}.tsv", DATA_DIR / f"elo_{year}.tsv")
    ratings: dict[str, float] = {}
    for line in year_text.splitlines():
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        code = parts[2].strip()
        try:
            rating = float(parts[3])
        except ValueError:
            continue
        name = code_to_name.get(code)
        if not name:
            continue
        dataset_name = NAME_FIXUPS.get(name, name)
        ratings[dataset_name] = rating
    return ratings
