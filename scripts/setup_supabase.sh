#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_ENV_FILE="${BACKEND_ENV_FILE:-$ROOT_DIR/backend/.env}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Error: Supabase CLI is required but not installed." >&2
  echo "Install: https://supabase.com/docs/guides/cli" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is required but was not found." >&2
  echo "Install PostgreSQL client tools, then retry." >&2
  exit 1
fi

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "Error: SUPABASE_PROJECT_REF is not set." >&2
  echo "Example: export SUPABASE_PROJECT_REF='your-project-ref'" >&2
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "Error: SUPABASE_DB_URL is not set." >&2
  echo "Example: export SUPABASE_DB_URL='postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require'" >&2
  exit 1
fi

if [[ ! -f "$BACKEND_ENV_FILE" ]]; then
  echo "Error: backend env file not found at $BACKEND_ENV_FILE" >&2
  exit 1
fi

extract_env() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$BACKEND_ENV_FILE" | tail -n1 | cut -d= -f2- || true)"
  echo "$value"
}

SUPABASE_URL_VALUE="${SUPABASE_URL_VALUE:-$(extract_env SUPABASE_URL)}"
SUPABASE_SERVICE_ROLE_KEY_VALUE="${SUPABASE_SERVICE_ROLE_KEY_VALUE:-$(extract_env SUPABASE_SERVICE_ROLE_KEY)}"

if [[ -z "$SUPABASE_URL_VALUE" || -z "$SUPABASE_SERVICE_ROLE_KEY_VALUE" ]]; then
  echo "Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be present in $BACKEND_ENV_FILE" >&2
  exit 1
fi

echo "[1/4] Applying SQL migrations..."
"$ROOT_DIR/scripts/apply_supabase_migrations.sh"

echo "[2/4] Linking Supabase project..."
(
  cd "$ROOT_DIR/backend/supabase"
  supabase link --project-ref "$SUPABASE_PROJECT_REF"
)

echo "[3/4] Setting edge function secrets..."
(
  cd "$ROOT_DIR/backend/supabase"
  supabase secrets set \
    SUPABASE_URL="$SUPABASE_URL_VALUE" \
    SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY_VALUE"
)

echo "[4/4] Deploying edge functions..."
(
  cd "$ROOT_DIR/backend/supabase"
  supabase functions deploy complete_registration
)

echo "Supabase setup complete: migrations applied, secrets set, and edge function deployed."
