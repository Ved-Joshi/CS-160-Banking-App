#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"

if [[ ! -x "$BACKEND_PYTHON" ]]; then
  echo "Missing backend virtualenv at $BACKEND_PYTHON"
  echo "Create it first with:"
  echo "  cd backend && python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
  echo "Missing frontend dependencies in $FRONTEND_DIR/node_modules"
  echo "Install them first with:"
  echo "  cd frontend && npm install"
  exit 1
fi

BACKEND_PID=""
FRONTEND_PID=""
SCHEDULER_PID=""

RUNNER_SECRET="${TRANSFER_RUNNER_SECRET:-}"
if [[ -z "$RUNNER_SECRET" ]] && [[ -f "$BACKEND_DIR/.env" ]]; then
  RUNNER_SECRET="$(sed -n 's/^TRANSFER_RUNNER_SECRET=\(.*\)$/\1/p' "$BACKEND_DIR/.env" | tail -n 1 | tr -d '"' | tr -d "'" )"
fi

cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$SCHEDULER_PID" ]] && kill -0 "$SCHEDULER_PID" >/dev/null 2>&1; then
    kill "$SCHEDULER_PID" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting backend on http://localhost:8000"
(
  cd "$BACKEND_DIR"
  exec "$BACKEND_PYTHON" -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
) &
BACKEND_PID=$!

echo "Starting frontend on http://localhost:5173"
(
  cd "$FRONTEND_DIR"
  exec npm run dev -- --host 0.0.0.0
) &
FRONTEND_PID=$!

if [[ -n "$RUNNER_SECRET" ]]; then
echo "Starting internal scheduler runner loop (check deposits every 10s; upload cleanup + others every 60s)"
  (
    tick=0
    while true; do
      curl -fsS -X POST "http://localhost:8000/internal/jobs/process-pending-check-deposits?limit=50" \
        -H "X-Runner-Secret: $RUNNER_SECRET" >/dev/null || true

      if [[ "$tick" -eq 0 ]]; then
        curl -fsS -X POST "http://localhost:8000/internal/jobs/cleanup-orphaned-deposit-uploads?limit=100" \
          -H "X-Runner-Secret: $RUNNER_SECRET" >/dev/null || true
        curl -fsS -X POST "http://localhost:8000/internal/jobs/process-transfer-plans?limit=50" \
          -H "X-Runner-Secret: $RUNNER_SECRET" >/dev/null || true
        curl -fsS -X POST "http://localhost:8000/internal/jobs/process-member-transfer-plans?limit=50" \
          -H "X-Runner-Secret: $RUNNER_SECRET" >/dev/null || true
        curl -fsS -X POST "http://localhost:8000/internal/jobs/process-external-transfers?limit=50" \
          -H "X-Runner-Secret: $RUNNER_SECRET" >/dev/null || true
        curl -fsS -X POST "http://localhost:8000/internal/jobs/process-bill-payments?limit=50" \
          -H "X-Runner-Secret: $RUNNER_SECRET" >/dev/null || true
      fi

      tick=$(( (tick + 1) % 6 ))
      sleep 10
    done
  ) &
  SCHEDULER_PID=$!
else
  echo "Skipping scheduler runner loop: TRANSFER_RUNNER_SECRET is not set."
fi

echo
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
if [[ -n "$SCHEDULER_PID" ]]; then
  echo "Scheduler PID: $SCHEDULER_PID"
fi
echo "Press Ctrl+C to stop both servers."
echo

while true; do
  if ! kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    echo "Backend process exited."
    exit 1
  fi
  if ! kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    echo "Frontend process exited."
    exit 1
  fi
  if [[ -n "$SCHEDULER_PID" ]] && ! kill -0 "$SCHEDULER_PID" >/dev/null 2>&1; then
    echo "Scheduler process exited."
    exit 1
  fi
  sleep 1
done
