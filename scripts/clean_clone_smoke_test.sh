#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git rev-parse --show-toplevel)"
TMP_DIR="$(mktemp -d)"
CLONE_DIR="$TMP_DIR/clone"

cleanup() {
  if [[ -d "$CLONE_DIR" ]]; then
    (
      cd "$CLONE_DIR"
      docker compose down -v --remove-orphans >/dev/null 2>&1 || true
    )
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    exit 1
  fi
}

replace_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local tmp
  tmp="$(mktemp)"
  awk -F= -v k="$key" -v v="$value" '
    BEGIN { updated = 0 }
    $1 == k {
      print k "=" v
      updated = 1
      next
    }
    { print $0 }
    END {
      if (!updated) {
        print k "=" v
      }
    }
  ' "$file" > "$tmp"
  mv "$tmp" "$file"
}

require_var SMOKE_SUPABASE_URL
require_var SMOKE_SUPABASE_SERVICE_ROLE_KEY
require_var SMOKE_SUPABASE_ANON_KEY
require_var SMOKE_TRANSFER_RUNNER_SECRET

echo "[1/5] Cloning repository into temporary directory"
git clone --depth 1 "file://$ROOT_DIR" "$CLONE_DIR" >/dev/null
rsync -a --delete --exclude '.git' "$ROOT_DIR/" "$CLONE_DIR/"

cd "$CLONE_DIR"
echo "[2/5] Preparing env files from documented examples"
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

replace_env_value backend/.env SUPABASE_URL "$SMOKE_SUPABASE_URL"
replace_env_value backend/.env SUPABASE_SERVICE_ROLE_KEY "$SMOKE_SUPABASE_SERVICE_ROLE_KEY"
replace_env_value backend/.env TRANSFER_RUNNER_SECRET "$SMOKE_TRANSFER_RUNNER_SECRET"
replace_env_value backend/.env JWT_SECRET "smoke-test-jwt-secret-not-default"

replace_env_value frontend/.env VITE_SUPABASE_URL "$SMOKE_SUPABASE_URL"
replace_env_value frontend/.env VITE_SUPABASE_ANON_KEY "$SMOKE_SUPABASE_ANON_KEY"
replace_env_value frontend/.env VITE_API_URL "http://localhost:8000"

echo "[3/5] Starting clean compose stack"
if ! docker compose up --build -d; then
  docker compose logs --no-color --tail=120 backend frontend scheduler || true
  exit 1
fi

echo "[4/5] Waiting for backend health"
backend_cid="$(docker compose ps -q backend)"
if [[ -z "$backend_cid" ]]; then
  echo "Unable to resolve backend container ID." >&2
  exit 1
fi
for _ in $(seq 1 45); do
  status="$(docker inspect "$backend_cid" --format '{{.State.Health.Status}}' 2>/dev/null || echo unknown)"
  if [[ "$status" == "healthy" ]]; then
    break
  fi
  sleep 2
done

backend_status="$(docker inspect "$backend_cid" --format '{{.State.Health.Status}}')"
if [[ "$backend_status" != "healthy" ]]; then
  echo "Backend never became healthy." >&2
  docker compose logs --no-color --tail=120 backend
  exit 1
fi

echo "[5/5] Verifying frontend and scheduler are running"
frontend_cid="$(docker compose ps -q frontend)"
scheduler_cid="$(docker compose ps -q scheduler)"
if [[ -z "$frontend_cid" || -z "$scheduler_cid" ]]; then
  echo "Unable to resolve frontend and scheduler container IDs." >&2
  docker compose ps
  exit 1
fi

frontend_status="$(docker inspect "$frontend_cid" --format '{{.State.Status}}')"
scheduler_status="$(docker inspect "$scheduler_cid" --format '{{.State.Status}}')"
if [[ "$frontend_status" != "running" || "$scheduler_status" != "running" ]]; then
  echo "Expected frontend and scheduler to be running, got frontend=$frontend_status scheduler=$scheduler_status" >&2
  docker compose ps
  exit 1
fi

echo "Smoke test passed"
