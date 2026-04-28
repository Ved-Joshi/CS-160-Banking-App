# CS160 Banking App

Full-stack banking demo project with:
- `backend/`: FastAPI + Supabase REST/RPC integration
- `frontend/`: React/Vite app
- `docker-compose.yml`: local one-command runtime (backend, frontend, scheduler)

## User's Guide

This guide covers:
- Installation and configuration for the web app (Docker)
- Installation for the mobile app (APK)
- Day-to-day usage and troubleshooting basics

## Installation and Configuration

### Web App (Docker)

#### Prerequisites

- Docker Desktop running
- A Supabase project (URL, anon key, service-role key)

#### Environment Setup

1. Copy backend env file:
```bash
cp backend/.env.example backend/.env
```

2. Fill required backend values in `backend/.env`:
- `DEBUG` (example: `False` in `.env.example`)
- `HOST` (example: `0.0.0.0`)
- `PORT` (example: `8000`)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS` (JSON array, include local web origins you use)
- `TRANSFER_RUNNER_SECRET`
- `GOOGLE_MAPS_API_KEY` (optional backend integration)
- `EXTERNAL_ACCOUNT_PROVIDER` (default `stripe_sandbox`)
- `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` (optional; used for external-link flow)

3. Copy frontend env file:
```bash
cp frontend/.env.example frontend/.env
```

4. Fill required frontend values in `frontend/.env`:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_URL=http://localhost:8000`
- `VITE_GOOGLE_MAPS_API_KEY` (required for ATM Locator map/search on web)

#### Get Required API Keys

- Stripe API keys (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`):
  - [Stripe API keys docs](https://docs.stripe.com/keys)
- Google Maps API key (`VITE_GOOGLE_MAPS_API_KEY`):
  - [Google Maps Platform: Get API key](https://developers.google.com/maps/documentation/javascript/get-api-key)

#### Supabase Schema Setup

Schema setup is **not** automatic from `docker compose` in this project. You must apply the SQL migrations to your Supabase project first.

Recommended (single setup command for schema + edge function):

1. Set required env vars:
```bash
export SUPABASE_PROJECT_REF='<your-project-ref>'
export SUPABASE_DB_URL='postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require'
```

2. Run:
```bash
./scripts/setup_supabase.sh
```

What this does:
- Applies all SQL migrations from `backend/supabase/migrations/`
- Links your Supabase project via CLI
- Sets edge function secrets from `backend/.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Deploys `complete_registration` edge function

At minimum, ensure these are applied:
- `001_init.sql`
- All subsequent numbered migration files through the latest file in `backend/supabase/migrations/`

#### Run Web with Docker

```bash
docker compose up --build -d
```

Services:
- Backend: [http://localhost:8000](http://localhost:8000)
- Frontend: [http://localhost:5173](http://localhost:5173)

#### Stop / Restart / Logs

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
docker compose logs -f backend frontend scheduler
```

### Mobile App (APK)

1. Download the latest APK artifact from your project release/distribution channel.
2. Install it on an Android device or emulator.
3. Ensure the mobile build is configured to target the same backend/Supabase environment as web.
4. Sign in using an existing account, or register a new account through the app.

Recommended for testers:
- Use the same Supabase project and backend environment used by the web stack to keep data/flows consistent.

## Using the Application

1. Open [http://localhost:5173](http://localhost:5173) for web.
2. Create an account or sign in.
3. Validate core flows: accounts, transfers, bill pay, deposits, transactions, notifications, settings.
4. For ATM Locator, confirm `VITE_GOOGLE_MAPS_API_KEY` is set; otherwise map features will not function.

## Testing

### Test Suites

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

### CI Checks

GitHub Actions workflow (`.github/workflows/ci.yml`) runs:
- Backend tests
- Frontend tests + production build
- Docker compose config validation + image builds

## Troubleshooting

- Login or reset-password failures:
  - Verify Supabase Auth redirect URLs include `http://localhost:5173/reset-password`
  - Verify frontend env keys match the same Supabase project used by backend
- Blank/partial web UI:
  - Rebuild and restart: `docker compose up --build -d`
  - Check frontend logs: `docker compose logs -f frontend`
- ATM Locator not loading:
  - Confirm `VITE_GOOGLE_MAPS_API_KEY` is set in `frontend/.env`
  - Rebuild frontend container after env changes
