# CS160 Banking App

Full-stack banking demo project with:
- `backend/`: FastAPI + Supabase REST/RPC integration
- `frontend/`: React/Vite app
- `docker-compose.yml`: local one-command runtime (backend, frontend, scheduler)

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
docker compose logs -f backend frontend scheduler
```

## Release Process

Follow [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md) before submitting.
