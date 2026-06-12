"""Elo loader — eloratings.net data files (World.tsv + en.teams.tsv).

The site renders from TSV data files; we fetch those directly (no HTML parsing).
Writes teams.elo_rating + teams.elo_last_updated. Daily at 3am MT.
Failure mode: keep cached values (max 7 days stale per model_params).
"""
from __future__ import annotations

import time

import httpx

from data.db import connect, log_agent_run
from data.team_names import resolve_team_code

WORLD_TSV = "https://eloratings.net/World.tsv"
TEAMS_TSV = "https://eloratings.net/en.teams.tsv"
USER_AGENT = "ThePitch/1.0 (personal research tool)"


def fetch_elo_table(client: httpx.Client | None = None) -> dict[str, float]:
    """Returns short_name → current Elo for every resolvable team."""
    own_client = client is None
    c = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=20)
    try:
        teams_resp = c.get(TEAMS_TSV)
        teams_resp.raise_for_status()
        code_to_name: dict[str, str] = {}
        for line in teams_resp.text.splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                code_to_name[parts[0].strip()] = parts[1].strip()

        world_resp = c.get(WORLD_TSV)
        world_resp.raise_for_status()

        ratings: dict[str, float] = {}
        for line in world_resp.text.splitlines():
            parts = line.split("\t")
            if len(parts) < 4:
                continue
            elo_code = parts[2].strip()
            try:
                rating = float(parts[3])
            except ValueError:
                continue
            name = code_to_name.get(elo_code)
            if not name:
                continue
            short = resolve_team_code(name)
            if short:
                ratings[short] = rating
        return ratings
    finally:
        if own_client:
            c.close()


def update_elo_ratings() -> dict[str, object]:
    """Fetch and persist Elo for all 48 teams. Logs to agent_runs."""
    start = time.monotonic()
    try:
        ratings = fetch_elo_table()
        updated = 0
        missing: list[str] = []
        with connect() as conn:
            rows = conn.execute("SELECT short_name FROM teams").fetchall()
            for row in rows:
                code = row["short_name"]
                if code in ratings:
                    conn.execute(
                        "UPDATE teams SET elo_rating = %s, elo_last_updated = NOW(), updated_at = NOW() "
                        "WHERE short_name = %s",
                        (ratings[code], code),
                    )
                    updated += 1
                else:
                    missing.append(code)
        duration = int((time.monotonic() - start) * 1000)
        summary: dict[str, object] = {
            "source": "eloratings.net",
            "teams_updated": updated,
            "missing": missing,
        }
        log_agent_run(
            "data_load_elo",
            "success" if not missing else "failed_recoverable",
            duration,
            outputs_summary=summary,
        )
        return summary
    except Exception as err:
        log_agent_run("data_load_elo", "failed_recoverable", int((time.monotonic() - start) * 1000), error=err)
        raise
