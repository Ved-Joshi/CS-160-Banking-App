# CS160 Banking App

Full-stack banking demo project with:
- `backend/`: FastAPI + Supabase REST/RPC integration
- `frontend/`: React/Vite app
- `docker-compose.yml`: local one-command runtime (backend, frontend, scheduler, demo seed)

## Prerequisites

- Docker Desktop running
- A Supabase project (URL, anon key, service-role key)

## Environment Setup

1. Copy backend env file:
```bash
cp backend/.env.example backend/.env
```

2. Fill required backend values in `backend/.env`:
- `JWT_SECRET` (must not be default placeholder)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRANSFER_RUNNER_SECRET`
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` (if testing external-link flow)

3. Copy frontend env file:
```bash
cp frontend/.env.example frontend/.env
```

4. Fill required frontend values in `frontend/.env`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL=http://localhost:8000`

## Run with Docker

```bash
docker compose up --build -d
```

Services:
- Backend: [http://localhost:8000](http://localhost:8000)
- Frontend: [http://localhost:5173](http://localhost:5173)

The `seed` service runs automatically once and creates/updates demo data.

## Fixed Tester Credentials (Seeded)

Use this exact account for QA/review:
- Email: `demo.tester@example.com`
- Password: `DemoPass123!`

Seeded data includes:
- Checking/Savings/Credit accounts with balances
- Payee and bill pay sample
- Deposit sample
- External account
- Member transfer plan with recipient user

You can disable seeding by setting `SEED_DEMO_DATA=false` in `backend/.env`.

## Tester Walkthrough Checklist

1. Sign in as `demo.tester@example.com`
2. Verify account cards render (checking/savings/credit)
3. Open transaction history and confirm entries exist
4. Create a transfer from checking to savings
5. Create a bill payment to seeded payee
6. Create an external transfer to seeded external account
7. Open deposits and submit a new ATM/check deposit
8. Open member transfers and confirm seeded plan exists

## Clean-Clone Smoke Test

This command validates reproducibility from a fresh clone using only documented `.env.example` setup values:

```bash
SMOKE_SUPABASE_URL=https://your-project.supabase.co \
SMOKE_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
SMOKE_SUPABASE_ANON_KEY=your-anon-key \
SMOKE_TRANSFER_RUNNER_SECRET=replace-with-long-random-secret \
./scripts/clean_clone_smoke_test.sh
```

It clones to a temporary directory, builds/starts compose, validates health, validates seed completion, runs seeded API checks, and tears down.

## Test Suites

Frontend:
```bash
cd frontend
npm ci
npm test
```

Backend (unit + integration-if-configured):
```bash
cd backend
python -m pip install -r requirements-dev.txt
pytest -q tests
```

## CI Checks

GitHub Actions workflow (`.github/workflows/ci.yml`) runs:
- Backend tests
- Frontend tests + production build
- Docker compose config validation + image builds

## Common Commands

Rebuild/restart:
```bash
docker compose up --build -d
```

Stop all services:
```bash
docker compose down
```

Tail logs:
```bash
docker compose logs -f backend frontend seed scheduler
```

## Release Process

Follow [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) before submitting.
