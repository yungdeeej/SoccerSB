#!/usr/bin/env bash
# The Pitch — single-command startup for Replit (and local).
# Boots: migrations → lean seed → Quant (Python, internal :8001) → web (:3000).
set -e

echo "[start] applying migrations…"
npm run db:migrate

echo "[start] lean seed (idempotent — skips existing rows)…"
npm run db:seed || echo "[start] seed skipped/failed non-fatally (already seeded?)"

echo "[start] launching Quant service on 127.0.0.1:8001…"
(
  cd src/agents/quant
  if command -v uv >/dev/null 2>&1; then
    exec uv run uvicorn main:app --host 127.0.0.1 --port 8001
  else
    echo "[start] uv not found — installing Python deps via pip"
    pip install -q -r requirements.txt
    exec python -m uvicorn main:app --host 127.0.0.1 --port 8001
  fi
) &
QUANT_PID=$!
trap 'kill $QUANT_PID 2>/dev/null || true' EXIT

echo "[start] launching web terminal on :${PORT:-3000}…"
exec npm run start
