"""Prediction service — DB-facing orchestration for the FastAPI routes."""
from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from calibration.backtest import calibrate, run_backtest, run_full_validation
from data.db import connect, log_agent_run
from data.elo_loader import update_elo_ratings
from data.transfermarkt_loader import update_market_values
from model.bivariate_poisson import predict_match
from model.bootstrap import bootstrap_confidence
from model.composite_rating import TeamSignals, compute_composite_rating, compute_field_stats
from model.params import load_confederation_priors, load_params
from model.types import BacktestResult, FieldStats, TeamRating, VenueInfo


class QuantError(Exception):
    def __init__(self, message: str, code: str = "quant_error") -> None:
        super().__init__(message)
        self.code = code


def _load_team_signals() -> list[TeamSignals]:
    priors = load_confederation_priors()
    with connect() as conn:
        rows = conn.execute(
            "SELECT short_name, confederation, elo_rating, elo_last_updated, "
            "market_value_squad_eur_m, club_xg_aggregate FROM teams"
        ).fetchall()

    params = load_params()
    signals: list[TeamSignals] = []
    stale_cutoff = datetime.now(UTC) - timedelta(days=params.elo_max_age_days)
    for row in rows:
        elo = row["elo_rating"]
        if elo is None:
            elo = priors.get(row["confederation"], 1550.0)
        elif row["elo_last_updated"] is not None and row["elo_last_updated"] < stale_cutoff:
            raise QuantError(
                f"Elo for {row['short_name']} is older than {params.elo_max_age_days} days — refusing to "
                "predict on stale inputs (behavioral rule 2). Run POST /ratings/update.",
                code="stale_inputs",
            )
        signals.append(
            TeamSignals(
                short_name=row["short_name"],
                elo=float(elo),
                market_value_eur_m=float(row["market_value_squad_eur_m"])
                if row["market_value_squad_eur_m"] is not None
                else None,
                club_xg_aggregate=row["club_xg_aggregate"],
            )
        )
    return signals


def recompute_composite_ratings() -> dict[str, Any]:
    """Compute + persist composite/attack/defense ratings for all 48 teams."""
    params = load_params()
    signals = _load_team_signals()
    field = compute_field_stats(signals)

    from model.composite_rating import attack_multiplier, defense_multiplier

    updated = 0
    bases: dict[str, int] = {}
    with connect() as conn:
        for sig in signals:
            rating = compute_composite_rating(sig, field, params)
            conn.execute(
                "UPDATE teams SET composite_z = %s, attack_rating = %s, defense_rating = %s, "
                "updated_at = NOW() WHERE short_name = %s",
                (
                    round(rating.composite_z, 3),
                    round(attack_multiplier(rating.composite_z, params), 3),
                    round(defense_multiplier(rating.composite_z, params), 3),
                    sig.short_name,
                ),
            )
            updated += 1
            bases[rating.rating_basis] = bases.get(rating.rating_basis, 0) + 1
    return {"teams_updated": updated, "rating_bases": bases}


def _team_rating_for(short_name: str, signals: list[TeamSignals], field: FieldStats) -> TeamRating:
    params = load_params()
    for sig in signals:
        if sig.short_name == short_name:
            return compute_composite_rating(sig, field, params)
    raise QuantError(f"Team {short_name} not found in signals", code="team_not_found")


def predict_for_match(match_id: str) -> dict[str, Any]:
    """Full predict flow: load → rate → model → bootstrap → persist → return."""
    start = time.monotonic()
    params = load_params()
    try:
        with connect() as conn:
            match = conn.execute(
                """
                SELECT m.id, m.tournament_stage, m.scheduled_kickoff_utc,
                       ht.short_name AS home_code, at.short_name AS away_code,
                       v.name AS venue_name, v.country AS venue_country,
                       v.latitude, v.longitude, v.altitude_meters, v.is_high_altitude
                FROM matches m
                JOIN teams ht ON m.home_team_id = ht.id
                JOIN teams at ON m.away_team_id = at.id
                LEFT JOIN venues v ON m.venue_id = v.id
                WHERE m.id = %s
                """,
                (match_id,),
            ).fetchone()
        if match is None:
            raise QuantError(f"Match {match_id} not found", code="match_not_found")

        signals = _load_team_signals()
        field = compute_field_stats(signals)
        home = _team_rating_for(match["home_code"], signals, field)
        away = _team_rating_for(match["away_code"], signals, field)

        venue = VenueInfo(
            name=match["venue_name"],
            country=match["venue_country"],
            latitude=float(match["latitude"]) if match["latitude"] is not None else None,
            longitude=float(match["longitude"]) if match["longitude"] is not None else None,
            altitude_meters=match["altitude_meters"] or 0,
            is_high_altitude=bool(match["is_high_altitude"]),
        )
        stage = match["tournament_stage"]

        prediction = predict_match(home, away, venue, params, stage=stage)
        ci = bootstrap_confidence(home, away, venue, params, stage=stage)

        quality = 100
        warnings: list[str] = []
        for rating, code in ((home, match["home_code"]), (away, match["away_code"])):
            if rating.rating_basis == "elo_only":
                quality -= 20
                warnings.append(f"{code}: Elo-only rating (no market value / club xG)")
            elif rating.rating_basis == "low_data":
                quality -= 10
                warnings.append(f"{code}: low-data rating (no club xG aggregate)")
        if match["venue_name"] is None:
            quality -= 10
            warnings.append("venue unknown — no venue/altitude/travel factor applied")

        rating_components = {
            "home_elo_z": round(home.elo_z, 3),
            "home_market_value_z": round(home.market_value_z, 3) if home.market_value_z is not None else None,
            "home_club_xg_z": round(home.xg_z, 3) if home.xg_z is not None else None,
            "home_composite_z": round(home.composite_z, 3),
            "away_elo_z": round(away.elo_z, 3),
            "away_market_value_z": round(away.market_value_z, 3) if away.market_value_z is not None else None,
            "away_club_xg_z": round(away.xg_z, 3) if away.xg_z is not None else None,
            "away_composite_z": round(away.composite_z, 3),
        }

        with connect() as conn:
            row = conn.execute(
                """
                INSERT INTO model_predictions
                  (match_id, model_version, xi_status, expected_goals_home, expected_goals_away,
                   goal_correlation, predictions, confidence_interval, rating_components,
                   inputs_quality_score, warnings)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, predicted_at
                """,
                (
                    match_id,
                    params.model_version,
                    "unknown",  # lineup data arrives in Phase 2b
                    round(prediction.expected_goals_home, 3),
                    round(prediction.expected_goals_away, 3),
                    params.goal_correlation,
                    json.dumps(prediction.predictions),
                    json.dumps(ci.model_dump()),
                    json.dumps(rating_components),
                    quality,
                    json.dumps(warnings),
                ),
            ).fetchone()

        duration = int((time.monotonic() - start) * 1000)
        log_agent_run(
            "predict",
            "success",
            duration,
            match_id=match_id,
            outputs_summary={
                "model_version": params.model_version,
                "home": match["home_code"],
                "away": match["away_code"],
                "home_win": round(prediction.match_outcome.home_win_prob, 4),
                "draw": round(prediction.match_outcome.draw_prob, 4),
                "away_win": round(prediction.match_outcome.away_win_prob, 4),
                "low_confidence": ci.low_confidence_flag,
            },
        )

        assert row is not None
        return {
            "prediction_id": str(row["id"]),
            "match_id": match_id,
            "model_version": params.model_version,
            "predicted_at": row["predicted_at"].isoformat(),
            "expected_goals": {
                "home": round(prediction.expected_goals_home, 3),
                "away": round(prediction.expected_goals_away, 3),
                "total": round(prediction.expected_goals_home + prediction.expected_goals_away, 3),
            },
            "predictions": prediction.predictions,
            "confidence_interval": ci.model_dump(),
            "rating_components": rating_components,
            "diagnostic": {
                "inputs_quality_score": quality,
                "warnings": warnings,
                "xi_status": "unknown",
            },
        }
    except QuantError as err:
        log_agent_run(
            "predict", "failed_recoverable", int((time.monotonic() - start) * 1000),
            match_id=match_id, error=err,
        )
        raise
    except Exception as err:
        log_agent_run(
            "predict", "failed_fatal", int((time.monotonic() - start) * 1000),
            match_id=match_id, error=err,
        )
        raise


def update_all_ratings(include_market_values: bool = False) -> dict[str, Any]:
    """Nightly ratings refresh: Elo fetch → (optional Transfermarkt) → composite recompute."""
    summary: dict[str, Any] = {}
    try:
        summary["elo"] = update_elo_ratings()
    except Exception as err:  # noqa: BLE001 — keep cached Elo, continue
        summary["elo"] = {"error": str(err), "note": "using cached Elo values"}
    if include_market_values:
        try:
            summary["market_values"] = update_market_values()
        except Exception as err:  # noqa: BLE001
            summary["market_values"] = {"error": str(err), "note": "using cached market values"}
    summary["composite"] = recompute_composite_ratings()
    return summary


def run_backtest_and_record(tournament: str, run_calibration: bool) -> BacktestResult:
    """Run the gate; persist a model_versions row with the result."""
    start = time.monotonic()
    params = load_params()

    if run_calibration:
        tuned = calibrate(params)
        params = params.model_copy(update={
            "alpha": tuned["alpha"], "draw_inflation": tuned["draw_inflation"],
            "dc_rho": tuned["dc_rho"], "joint_temper": tuned["joint_temper"],
        })
    if tournament == "all_majors":
        result = run_full_validation(params)
    else:
        result = run_backtest(tournament, params)

    with connect() as conn:
        conn.execute(
            """
            INSERT INTO model_versions
              (agent, version, config_snapshot, change_notes, backtest_passed, backtest_brier,
               backtest_median_clv_cents)
            VALUES ('quant', %s, %s, %s, %s, %s, %s)
            """,
            (
                params.model_version,
                json.dumps({
                    "alpha": params.alpha,
                    "draw_inflation": params.draw_inflation,
                    "base_goals_per_team": params.base_goals_per_team,
                    "goal_correlation": params.goal_correlation,
                    "calibrated": run_calibration,
                }),
                f"Backtest {tournament}: Brier {result.brier_score} on {result.n_matches} matches. "
                f"{result.notes}",
                result.passed,
                result.brier_score,
                result.median_clv_cents,
            ),
        )

    log_agent_run(
        "backtest",
        "success",
        int((time.monotonic() - start) * 1000),
        outputs_summary={
            "tournament": tournament,
            "brier": result.brier_score,
            "n_matches": result.n_matches,
            "passed": result.passed,
            "alpha": params.alpha,
            "draw_inflation": params.draw_inflation,
        },
    )
    return result


def health_status() -> dict[str, Any]:
    params = load_params()
    status: dict[str, Any] = {"model_version": params.model_version}
    try:
        with connect() as conn:
            rated = conn.execute(
                "SELECT count(*) AS n FROM teams WHERE elo_rating IS NOT NULL"
            ).fetchone()
            last_update = conn.execute(
                "SELECT max(ran_at) AS t FROM agent_runs "
                "WHERE agent = 'quant' AND run_phase IN ('rating_update', 'data_load_elo') "
                "AND status = 'success'"
            ).fetchone()
            gate = conn.execute(
                "SELECT backtest_passed, backtest_brier FROM model_versions "
                "WHERE agent = 'quant' AND backtest_passed = true "
                "ORDER BY deployed_at DESC LIMIT 1"
            ).fetchone()
        status["database"] = "ok"
        status["teams_with_elo"] = rated["n"] if rated else 0
        status["last_rating_update"] = (
            last_update["t"].isoformat() if last_update and last_update["t"] else None
        )
        status["backtest_passed"] = bool(gate)
        status["backtest_brier"] = float(gate["backtest_brier"]) if gate else None
    except Exception as err:  # noqa: BLE001
        status["database"] = f"error: {err}"
        status["backtest_passed"] = False
    return status
