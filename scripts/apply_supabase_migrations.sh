#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/backend/supabase/migrations"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is required but was not found." >&2
  echo "Install PostgreSQL client tools, then retry." >&2
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  cat >&2 <<'EOF'
Error: SUPABASE_DB_URL is not set.

Set it to your Supabase Postgres connection string, then rerun:
  export SUPABASE_DB_URL='postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require'
  ./scripts/apply_supabase_migrations.sh
EOF
  exit 1
fi

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "Error: no migration files found in $MIGRATIONS_DIR" >&2
  exit 1
fi

IFS=$'\n' migration_files_sorted=($(printf '%s\n' "${migration_files[@]}" | sort))
unset IFS

echo "Applying ${#migration_files_sorted[@]} migration files to Supabase..."
for file in "${migration_files_sorted[@]}"; do
  base="$(basename "$file")"
  echo " -> $base"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$file" >/dev/null
done

echo "Done. All migrations applied successfully."
