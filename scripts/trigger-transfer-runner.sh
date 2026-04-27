#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/backend/.env"
RUNNER_BASE="http://localhost:8000/internal/jobs"
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

LEGACY_RESPONSE="$(curl -sS -X POST "$RUNNER_BASE/process-transfer-plans?limit=100" -H "X-Runner-Secret: $SECRET")"
MEMBER_RESPONSE="$(curl -sS -X POST "$RUNNER_BASE/process-member-transfer-plans?limit=100" -H "X-Runner-Secret: $SECRET")"
EXTERNAL_RESPONSE="$(curl -sS -X POST "$RUNNER_BASE/process-external-transfers?limit=100" -H "X-Runner-Secret: $SECRET")"
BILL_PAY_RESPONSE="$(curl -sS -X POST "$RUNNER_BASE/process-bill-payments?limit=100" -H "X-Runner-Secret: $SECRET")"
CHECK_DEPOSIT_RESPONSE="$(curl -sS -X POST "$RUNNER_BASE/process-pending-check-deposits?limit=100" -H "X-Runner-Secret: $SECRET")"
UPLOAD_CLEANUP_RESPONSE="$(curl -sS -X POST "$RUNNER_BASE/cleanup-orphaned-deposit-uploads?limit=100" -H "X-Runner-Secret: $SECRET")"

echo "[$(NOW)] process-transfer-plans: $LEGACY_RESPONSE"
echo "[$(NOW)] process-member-transfer-plans: $MEMBER_RESPONSE"
echo "[$(NOW)] process-external-transfers: $EXTERNAL_RESPONSE"
echo "[$(NOW)] process-bill-payments: $BILL_PAY_RESPONSE"
echo "[$(NOW)] process-pending-check-deposits: $CHECK_DEPOSIT_RESPONSE"
echo "[$(NOW)] cleanup-orphaned-deposit-uploads: $UPLOAD_CLEANUP_RESPONSE"
