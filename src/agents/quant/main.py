"""The Quant — FastAPI service entry. Run: uv run uvicorn main:app --port 8001"""
from __future__ import annotations

from fastapi import FastAPI

from api.routes import router

app = FastAPI(title="The Pitch — Quant", version="1.0.0")
app.include_router(router)
