"""Postgres access — psycopg with explicit SQL (no ORM, per Phase 2a constraints)."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parents[4]  # src/agents/quant/data/db.py → repo root


def _load_env() -> None:
    """Minimal .env loader (repo root) — no python-dotenv dependency."""
    env_file = REPO_ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_env()


def database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    return url


def connect() -> psycopg.Connection[dict[str, Any]]:
    return psycopg.connect(database_url(), row_factory=dict_row)


def log_agent_run(
    run_phase: str,
    status: str,
    duration_ms: int,
    match_id: str | None = None,
    error: Exception | None = None,
    outputs_summary: dict[str, Any] | None = None,
) -> None:
    """Every Quant operation logs to agent_runs — no silent failures."""
    try:
        with connect() as conn:
            conn.execute(
                """
                INSERT INTO agent_runs
                  (agent, run_phase, status, duration_ms, match_id, error_message, error_stack, outputs_summary)
                VALUES ('quant', %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run_phase,
                    status,
                    duration_ms,
                    match_id,
                    str(error) if error else None,
                    getattr(error, "__traceback__", None) and _format_tb(error) or None,
                    json.dumps(outputs_summary) if outputs_summary else None,
                ),
            )
    except Exception as log_err:  # noqa: BLE001 — logging must never crash the pipeline
        print(f"agent_runs logging failed: {log_err}")


def _format_tb(error: Exception | None) -> str | None:
    if error is None:
        return None
    import traceback

    return "".join(traceback.format_exception(type(error), error, error.__traceback__))[:4000]


class Timer:
    def __enter__(self) -> Timer:
        self.start = time.monotonic()
        return self

    def __exit__(self, *args: object) -> None:
        self.elapsed_ms = int((time.monotonic() - self.start) * 1000)
