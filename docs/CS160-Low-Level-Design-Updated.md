# LOW-LEVEL DESIGN DOCUMENT (UPDATED)

Project: CS160 Team Project - Banking System  
Team 2  
Last updated: April 27, 2026

## 1. Introduction
This Low-Level Design (LLD) reflects the current implementation in this repository.

It documents:
- The implemented system architecture and module boundaries
- Backend routing and service-layer responsibilities
- Current Supabase/Postgres data model and ledger guarantees
- Security, validation, and idempotency behavior
- Frontend architecture and API contract handling
- Scheduler/internals, operational behavior, and known gaps

## 2. Current System Architecture

### 2.1 Technology Stack
- Frontend: React 19, Vite, TypeScript, React Router, TanStack Query, React Hook Form, Zod
- Backend: FastAPI (Python), Supabase-first API/data access
- Data layer: Supabase Postgres + Supabase Auth + Supabase Storage
- Scheduler: Dockerized internal runner calling protected `/internal/jobs/*` endpoints

### 2.2 High-Level Layers
- Client layer:
  - Public auth pages (`/`, `/login`, `/register`, `/reset-password`)
  - Protected banking shell (`/app/*`)
  - Admin shell (`/admin`, `/admin/accounts`, `/admin/reports`)
- Application layer:
  - FastAPI routers (`/api/*`, `/api/admin/*`, `/internal/jobs/*`)
  - Service modules for transfers, payments, account lifecycle, ledger behavior
- Data layer:
  - Supabase PostgREST + RPC functions + RLS policies

## 3. Backend Low-Level Design

### 3.1 Backend Entry and Router Composition
`backend/main.py` configures:
- CORS middleware
- OpenAPI bearer security scheme
- Router registration:
  - `banking_read_router` (`/api/*` customer-facing endpoints)
  - `admin_router` (`/api/admin/*`)
  - `me_admin_router` (`/api/me/admin`)
  - `accounts.router` (`/accounts/*`, legacy/development path)
  - `internal_jobs_router` (`/internal/jobs/*`)
- Health endpoint:
  - `GET /health` returns `{status, bootId}` where `bootId` is process-unique

### 3.2 Authentication and Authorization
- Authentication source: Supabase bearer token (`Authorization: Bearer <token>`)
- `get_current_user`:
  - Validates bearer header presence and token format
  - Uses Supabase Auth API to hydrate user context
- `require_admin`:
  - Resolves roles from `app_metadata.roles` or `user_metadata.roles`
  - Requires `'admin'` role, otherwise returns 403

### 3.3 Router Responsibilities

#### 3.3.1 Customer Banking Router (`backend/routers/banking_read.py`)
Implements `/api/*` contract used by frontend:
- Profile:
  - `GET /api/me/profile`
  - `PATCH /api/me/profile`
- Accounts:
  - `GET /api/accounts`
  - `GET /api/accounts/{account_id}`
  - `POST /api/accounts`
  - `POST /api/accounts/{account_id}/close`
- Transactions:
  - `GET /api/transactions`
- Transfers:
  - Internal transfer submit
  - Member transfer recipient resolve + submit + plan list/cancel/update/retry
  - External account list/create/link-session/link-complete
  - External transfer list/submit + plan list/cancel/update/retry
- Bill pay:
  - Payee list/create
  - Payment list/create/update/retry/cancel
  - Dev-only execution endpoint
- Deposits:
  - Deposit list/detail
  - Signed upload URL generation
  - Deposit submission
- Notifications:
  - List + mark read
- ATM:
  - Search endpoint (`/api/atms/search`) and static list endpoint (`/api/atms`)

#### 3.3.2 Admin Router (`backend/routers/admin.py`)
- `GET /api/admin/accounts`
  - Returns non-closed accounts for admin oversight
- `DELETE /api/admin/accounts/{account_id}`
  - Closes account via RPC (`close_customer_account`) rather than hard delete
  - Returns structured reasons when account is not closable
- `GET /api/admin/reports/accounts`
  - Account/customer reporting with filters:
    - search, min/max balance, ZIP/city/state, account type, status, limit
  - Returns row dataset + summary metrics

#### 3.3.3 Internal Jobs Router (`backend/routers/internal_jobs.py`)
- Protected by `X-Runner-Secret`
- Endpoints:
  - `/process-transfer-plans`
  - `/process-bill-payments`
  - `/process-member-transfer-plans`
  - `/process-external-transfers`
- Enforces bounded batch limits to avoid oversized runs

### 3.4 Service Layer Responsibilities
- `payment_service.py`:
  - Payment execution and scheduling
  - Idempotency reserve/replay/finalize lifecycle
  - Timezone-aware due-date behavior
- `transfer_service.py`:
  - Internal/member/external transfer orchestration
  - External account linking and provider integration
  - Plan processing and retry paths
- `account_service.py`:
  - Legacy account CRUD/close helpers for `/accounts/*`
- `ledger_service.py`:
  - Ensures ledger-account presence and posting consistency support

### 3.5 Supabase Access Layer
`utils/supabase.py` centralizes:
- HTTP requests to Supabase Auth/PostgREST/Storage/RPC
- CRUD wrappers (`select_rows`, `insert_row`, `update_rows`, `delete_rows`)
- Signed upload URL generation for deposit images
- Uniform error normalization and timeout/request error handling

## 4. Data Model and Persistence

### 4.1 Core Tables
From migrations (`001_init.sql` + subsequent patches), key entities include:
- Identity and profile:
  - `profiles`, `customer_private`
- Banking products and activity:
  - `accounts`, `transactions`, `transfers`, `deposits`, `notifications`
- Payments:
  - `payees`, `bill_payments`, `payment_idempotency_keys`
- Ledger:
  - `ledger_accounts`, `ledger_journals`, `ledger_postings`
- ATM:
  - `atm_locations`
- Extended transfer domain:
  - `member_transfer_plans`, `member_transfers`
  - `external_accounts`, `external_transfer_plans`, `external_transfers`

### 4.2 Key Constraints and Policies
- `accounts`:
  - Type check (`checking`, `savings`, `credit`)
  - Status check (`open`, `frozen`, `closed`)
  - Routing/account formatting constraints
- `transactions`:
  - Type, status, direction, positive amount constraints
- `bill_payments` and transfer plan tables:
  - Positive amount constraints
  - Cadence/status enums and timezone checks
- Ledger:
  - Trigger-enforced balanced posting constraint
- RLS:
  - Enabled broadly across user-facing tables
  - Ownership-based policies for customer-isolated reads/writes
  - Public read policy for ATM locations

### 4.3 Account Close Semantics
- Closure is performed through RPC (`close_customer_account`) with domain checks:
  - Account must be open
  - Current and available balances must be zero
  - No pending transactions/deposits/scheduled or processing bill payments
- RPC returns structured result (`closed`, `status`, `reasons`) consumed by customer and admin flows

## 5. Transaction and Ledger Design
- Core money movement follows a ledger-first pattern:
  - Journal + posting records created atomically with product-state updates
- Invariants:
  - No partial posting persistence on failure paths
  - Posting balance checks enforced at DB level
- State transitions propagate into customer-facing `transactions` rows for UI visibility

## 6. Frontend Low-Level Design

### 6.1 Route Structure
- Public:
  - `/`, `/login`, `/register`, `/reset-password`
- Protected customer app (`/app/*`):
  - dashboard, accounts, transfers, bill pay, deposits, transactions, ATM locator, notifications, settings
- Protected admin:
  - `/admin`
  - `/admin/accounts`
  - `/admin/reports`

### 6.2 Data and API Integration
- `apiClient.ts`:
  - Injects Supabase bearer token for authenticated calls
  - Normalizes backend error payloads for UI display
- `bankingApi.ts`:
  - Defines endpoint-specific service methods used by features
- `bankingContract.ts`:
  - Normalizes backend payload variants into stable frontend types

### 6.3 Auth Session Behavior
- `AuthProvider` hydrates user session from Supabase
- Role refresh via `/api/me/admin`
- Restart-aware logout:
  - Compares persisted backend `bootId` to `GET /health`
  - On mismatch, forces local sign-out and clears frontend session state

### 6.4 ATM Map Degradation Behavior
- If `VITE_GOOGLE_MAPS_API_KEY` is missing or map script fails:
  - ATM search/list remains functional
  - Embedded map enters explicit degraded mode with user-facing message

## 7. Error Handling, Validation, and Idempotency

### 7.1 Validation Patterns
- Request models use Pydantic schema constraints
- Domain validation in services/router helpers:
  - Account/routing number checks
  - ZIP/phone normalization
  - Ownership and eligibility guards

### 7.2 Error Responses
- FastAPI `HTTPException` used across routers/services
- Errors include actionable detail strings and, where needed, structured reason lists

### 7.3 Idempotency
- Bill payment create/retry operations require `Idempotency-Key`
- Request payload hash + status tracking in `payment_idempotency_keys`
- Replay returns prior response for duplicate key/payload submissions

## 8. Security Design
- Authentication:
  - Supabase JWT bearer tokens
- Authorization:
  - User ownership checks on customer data paths
  - `require_admin` role gate for admin endpoints
- Data protection:
  - RLS in Supabase tables
  - Server-side checks prevent cross-user access even with direct endpoint calls
- Internal automation hardening:
  - Scheduler endpoints protected by shared runner secret

## 9. Deployment and Operations
- Docker Compose services:
  - `backend` (FastAPI)
  - `frontend` (static served build)
  - `scheduler` (curl loop invoking internal jobs)
- Health and readiness:
  - Backend health endpoint includes process boot identifier
- Configuration:
  - Backend env: Supabase/service role, Stripe/provider settings, runner secret, etc.
  - Frontend env: API URL, Supabase public keys, optional Google Maps key

## 10. Testing and Quality Signals (Current)
- Frontend tests present for key pages/utilities and contract normalization
- Build/lint pipelines available via npm scripts
- Current gap:
  - Backend lacks broad automated pytest integration coverage for many critical workflows
- Recommended next step:
  - Add backend integration test suite around transfers, payments, account closure, and admin reporting

## 11. Current Known Gaps and Next Iteration Targets
- Expand backend automated tests and CI enforcement
- Add end-to-end browser tests for top user/admin flows
- Improve reporting scalability for very large account volumes
- Add stronger observability around scheduler run outcomes and retry behavior
- Optional: replace or augment embedded map provider for keyless fallback map rendering

## 12. Revision Note
This document supersedes the original Part 2 LLD assumptions where implementation has changed (for example, platform scope, auth integration, admin reporting, scheduler behavior, and account closure semantics).
