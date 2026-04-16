# Frontend API Contract

The frontend consumes the backend through `/api/*` routes as the public UI contract.

- Use `/api/accounts`, `/api/transactions`, and `/api/transfers` in frontend services.
- Do not call raw ledger routes like `/accounts/*` directly from UI components.
- Any backend shape drift (snake_case fields, cents values, status casing) is normalized in `src/lib/bankingContract.ts`.

This keeps component-facing types (`BankAccount`, `Transaction`, `TransferSubmissionResult`, `TransferPlan`) stable while backend internals evolve.
