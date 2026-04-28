# Release Checklist

Use this checklist before submitting the project.

## 1) Verify Migrations

1. Confirm migration files are present in expected filename order:
```bash
ls -1 backend/supabase/migrations/*.sql | sort
```

2. Because duplicate numeric prefixes exist (`010_*`, `015_*`), verify exact applied order in Supabase migration history after deploy:
```sql
select version, name
from supabase_migrations.schema_migrations
order by version, name;
```

3. Confirm latest migration (`023_rls_force_and_policy_hardening.sql`) is applied.
4. Verify RLS/policies still pass your smoke tests after migration.

## 2) Verify Local Runtime (Docker)

1. Ensure env files exist from examples:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

2. Start stack:
```bash
docker compose up --build -d
```

3. Check service health:
```bash
docker compose ps
```

## 3) Verify Test Suites

1. Frontend:
```bash
cd frontend && npm ci && npm test && npm run build
```

2. Backend:
```bash
cd backend && python -m pip install -r requirements-dev.txt && pytest -q tests
```

## 4) Tag the Release

After all checks pass on `main`:

1. Create annotated tag:
```bash
git tag -a v1.0.0 -m "Release v1.0.0"
```

2. Push commits and tag:
```bash
git push origin main
git push origin v1.0.0
```

3. Record release notes with:
- migration version range included
- Docker image/build verification date
- CI run URL
