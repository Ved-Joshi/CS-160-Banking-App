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

## Tester Account (Seeded)

By default, compose seeds this tester login:
- Email: `demo.tester@example.com`
- Password: `DemoPass123!`

Seeded data includes:
- Multiple accounts (checking/savings/credit) with balances
- Payee and bill pay sample
- Deposit sample
- Transfer/external-transfer sample
- A recipient account for member-transfer flow

You can override seed credentials in `backend/.env`:
- `DEMO_TEST_EMAIL`
- `DEMO_TEST_PASSWORD`
- `DEMO_RECIPIENT_EMAIL`
- `DEMO_RECIPIENT_PASSWORD`

Disable seeding by setting:
- `SEED_DEMO_DATA=false`

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

## Test Suites

Frontend:
```bash
cd frontend
npm test
```

Backend (inside backend container):
```bash
docker exec banking-backend python -m pytest -q /app/tests
```
