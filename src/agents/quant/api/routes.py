"""FastAPI routes — thin wrappers over api.service."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.service import (
    QuantError,
    health_status,
    predict_for_match,
    run_backtest_and_record,
    update_all_ratings,
)
from model.types import BacktestResult

router = APIRouter()


class PredictRequest(BaseModel):
    match_id: str
    force_refresh: bool = False


class RatingsUpdateRequest(BaseModel):
    include_market_values: bool = False


class BacktestRequest(BaseModel):
    tournament: str = "2022_world_cup"
    calibrate: bool = False


@router.post("/predict")
def predict(req: PredictRequest) -> dict[str, Any]:
    try:
        return predict_for_match(req.match_id)
    except QuantError as err:
        raise HTTPException(status_code=400, detail={"error": str(err), "code": err.code}) from err


@router.post("/ratings/update")
def ratings_update(req: RatingsUpdateRequest) -> dict[str, Any]:
    return update_all_ratings(include_market_values=req.include_market_values)


@router.post("/backtest")
def backtest(req: BacktestRequest) -> BacktestResult:
    try:
        return run_backtest_and_record(req.tournament, run_calibration=req.calibrate)
    except (ValueError, RuntimeError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/health")
def health() -> dict[str, Any]:
    return health_status()
