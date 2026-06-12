"""API-Football client — team stats fallback. Entry tier = 100 req/day; cache 6h+."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import httpx

from data.db import connect, log_agent_run

BASE_URL = "https://v3.football.api-sports.io"
CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_TTL_S = 6 * 3600
WC_LEAGUE_ID = 1  # API-Football league id for the FIFA World Cup


def api_key() -> str | None:
    return os.environ.get("APIFOOTBALL_KEY") or None


def _cache_path(endpoint: str, params: dict[str, Any]) -> Path:
    key = endpoint.strip("/").replace("/", "_") + "_" + "_".join(f"{k}-{v}" for k, v in sorted(params.items()))
    return CACHE_DIR / f"{key}.json"


def fetch(endpoint: str, params: dict[str, Any], force: bool = False) -> dict[str, Any]:
    """Cached GET. Raises RuntimeError when no API key configured."""
    key = api_key()
    if not key:
        raise RuntimeError("APIFOOTBALL_KEY is not set — API-Football loader disabled")

    CACHE_DIR.mkdir(exist_ok=True)
    cache = _cache_path(endpoint, params)
    if not force and cache.exists() and (time.time() - cache.stat().st_mtime) < CACHE_TTL_S:
        return json.loads(cache.read_text())  # type: ignore[no-any-return]

    with httpx.Client(base_url=BASE_URL, headers={"x-apisports-key": key}, timeout=25) as client:
        resp = client.get(endpoint, params=params)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()

    if data.get("errors"):
        raise RuntimeError(f"API-Football error: {data['errors']}")

    cache.write_text(json.dumps(data))
    return data


def update_team_stats() -> dict[str, object]:
    """
    Pull tournament fixtures + team statistics, persist rolling stats JSON.
    Budgeted: 1 fixtures call + statistics calls only for teams with matches played.
    """
    start = time.monotonic()
    try:
        fixtures = fetch("/fixtures", {"league": WC_LEAGUE_ID, "season": 2026})
        n_fixtures = len(fixtures.get("response", []))

        updated = 0
        with connect() as conn:
            rows = conn.execute("SELECT id, short_name, name FROM teams").fetchall()
            # Map API team names → our rows via existing alias logic
            from data.team_names import resolve_team_code

            api_teams: dict[str, int] = {}
            for fx in fixtures.get("response", []):
                for side in ("home", "away"):
                    t = fx.get("teams", {}).get(side, {})
                    if t.get("name") and t.get("id"):
                        code = resolve_team_code(t["name"])
                        if code:
                            api_teams[code] = t["id"]

            for row in rows:
                api_id = api_teams.get(row["short_name"])
                if not api_id:
                    continue
                stats = fetch(
                    "/teams/statistics",
                    {"league": WC_LEAGUE_ID, "season": 2026, "team": api_id},
                )
                response = stats.get("response", {})
                if not response:
                    continue
                rolling = {
                    "source": "api-football",
                    "fixtures_played": response.get("fixtures", {}).get("played", {}).get("total", 0),
                    "goals_for_avg": response.get("goals", {}).get("for", {}).get("average", {}).get("total"),
                    "goals_against_avg": response.get("goals", {})
                    .get("against", {})
                    .get("average", {})
                    .get("total"),
                    "form": response.get("form"),
                }
                conn.execute(
                    "UPDATE teams SET rolling_8_match = %s, updated_at = NOW() WHERE id = %s",
                    (json.dumps(rolling), row["id"]),
                )
                updated += 1

        duration = int((time.monotonic() - start) * 1000)
        summary: dict[str, object] = {
            "source": "api-football",
            "fixtures_seen": n_fixtures,
            "teams_updated": updated,
        }
        log_agent_run("data_load_apifootball", "success", duration, outputs_summary=summary)
        return summary
    except Exception as err:
        log_agent_run(
            "data_load_apifootball",
            "failed_recoverable",
            int((time.monotonic() - start) * 1000),
            error=err,
        )
        raise
