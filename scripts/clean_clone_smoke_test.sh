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

echo "[1/7] Cloning repository into temporary directory"
git clone --depth 1 "file://$ROOT_DIR" "$CLONE_DIR" >/dev/null
rsync -a --delete --exclude '.git' "$ROOT_DIR/" "$CLONE_DIR/"

cd "$CLONE_DIR"
echo "[2/7] Preparing env files from documented examples"
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

replace_env_value backend/.env SUPABASE_URL "$SMOKE_SUPABASE_URL"
replace_env_value backend/.env SUPABASE_SERVICE_ROLE_KEY "$SMOKE_SUPABASE_SERVICE_ROLE_KEY"
replace_env_value backend/.env TRANSFER_RUNNER_SECRET "$SMOKE_TRANSFER_RUNNER_SECRET"
replace_env_value backend/.env JWT_SECRET "smoke-test-jwt-secret-not-default"

replace_env_value frontend/.env VITE_SUPABASE_URL "$SMOKE_SUPABASE_URL"
replace_env_value frontend/.env VITE_SUPABASE_ANON_KEY "$SMOKE_SUPABASE_ANON_KEY"
replace_env_value frontend/.env VITE_API_URL "http://localhost:8000"

echo "[3/7] Starting clean compose stack"
if ! docker compose up --build -d; then
  docker compose logs --no-color --tail=120 backend seed frontend scheduler || true
  exit 1
fi

echo "[4/7] Waiting for backend health"
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

echo "[5/7] Verifying seed job exit status"
seed_cid="$(docker compose ps -aq seed)"
if [[ -z "$seed_cid" ]]; then
  echo "Unable to resolve seed container ID." >&2
  exit 1
fi
for _ in $(seq 1 30); do
  seed_status="$(docker inspect "$seed_cid" --format '{{.State.Status}}' 2>/dev/null || echo unknown)"
  if [[ "$seed_status" == "exited" ]]; then
    break
  fi
  sleep 2
done
seed_state="$(docker inspect "$seed_cid" --format '{{.State.Status}} {{.State.ExitCode}}')"
if [[ "$seed_state" != "exited 0" ]]; then
  echo "Seed service did not finish cleanly: $seed_state" >&2
  docker compose logs --no-color --tail=120 seed
  exit 1
fi

echo "[6/7] Performing seeded-user API smoke checks"
export SMOKE_SUPABASE_URL
export SMOKE_SUPABASE_SERVICE_ROLE_KEY
python3 - <<'PY'
import json
import os
import urllib.request

supabase_url = os.environ["SMOKE_SUPABASE_URL"].rstrip("/")
service_role = os.environ["SMOKE_SUPABASE_SERVICE_ROLE_KEY"]

payload = json.dumps({"email": "demo.tester@example.com", "password": "DemoPass123!"}).encode()
req = urllib.request.Request(
    f"{supabase_url}/auth/v1/token?grant_type=password",
    data=payload,
    headers={"apikey": service_role, "Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req, timeout=20) as response:
    token_payload = json.loads(response.read().decode())

token = token_payload.get("access_token")
if not token:
    raise SystemExit("No access token returned for seeded tester account.")

base = "http://localhost:8000/api"
for path in [
    "accounts",
    "payees",
    "external-accounts",
    "deposits",
    "payments",
    "member-transfers/plans",
]:
    req = urllib.request.Request(f"{base}/{path}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=20) as response:
        payload = json.loads(response.read().decode())
    if not isinstance(payload, list):
        raise SystemExit(f"Unexpected payload type for {path}: {type(payload)!r}")
    if len(payload) == 0:
        raise SystemExit(f"Expected seeded data for {path}, found none.")
PY

echo "[7/7] Smoke test passed"
