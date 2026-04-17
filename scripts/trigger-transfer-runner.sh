#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/backend/.env"
RUNNER_URL="http://localhost:8000/internal/jobs/process-transfer-plans?limit=100"
NOW() {
  date "+%Y-%m-%dT%H:%M:%S%z"
}

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[$(NOW)] missing env file: $ENV_FILE"
  exit 1
fi

SECRET="$(awk -F= '/^TRANSFER_RUNNER_SECRET=/{print $2}' "$ENV_FILE" | tr -d '[:space:]')"
if [[ -z "$SECRET" ]]; then
  echo "[$(NOW)] TRANSFER_RUNNER_SECRET is empty"
  exit 1
fi

RESPONSE="$(curl -sS -X POST "$RUNNER_URL" -H "X-Runner-Secret: $SECRET")"
echo "[$(NOW)] $RESPONSE"
