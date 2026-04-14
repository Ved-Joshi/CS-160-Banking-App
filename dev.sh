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

cleanup() {
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" >/dev/null 2>&1; then
    kill "$BACKEND_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" >/dev/null 2>&1; then
    kill "$FRONTEND_PID" >/dev/null 2>&1 || true
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

echo
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
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
  sleep 1
done
