# CS160 Banking App Frontend

Responsive React web frontend for a mock-first banking application, built for the CS160 team project.

## Stack

- React 19
- Vite
- TypeScript
- React Router
- TanStack Query
- React Hook Form
- Zod
- Vitest

## Implemented Experience

- Public auth entry pages: welcome, sign in, register, reset password, MFA
- Authenticated banking shell with responsive side navigation
- Dashboard with balances, alerts, quick actions, recent transactions, and upcoming bill pay
- Accounts list and account detail pages
- Internal transfer flow with review and submission states
- Bill pay scheduling and payee reference pages
- Deposit submission flow and deposit detail tracking
- Transaction history with filters
- ATM locator with list/map split layout
- Notifications and settings pages

## Mock-First Architecture

The app uses typed mock services in [`src/lib/mockApi.ts`](/Users/vedjoshi/CS-160-Banking-App/frontend/src/lib/mockApi.ts) and deterministic fixtures in [`src/mocks/data.ts`](/Users/vedjoshi/CS-160-Banking-App/frontend/src/mocks/data.ts). The UI is already organized around backend-ready service boundaries so FastAPI integration can replace the mock layer later.

## Run

```bash
cd frontend
npm install
npm run dev
```

## Verify

```bash
cd frontend
npm run build
npm run lint
npm run test
```
