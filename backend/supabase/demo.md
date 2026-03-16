## Demo Steps (Supabase-first MVP)

### 1) Apply the schema in Supabase
1. Open Supabase Dashboard for your project.
2. Go to `SQL Editor`.
3. Paste and run the contents of `backend/supabase/migrations/001_init.sql`.

### 2) Seed bank-owned ledger accounts
Run `backend/supabase/migrations/002_seed_ledger_accounts.sql` in `SQL Editor`.

### 3) Seed a couple of ATM locations (optional but useful for UI)
Run this in `SQL Editor`:

```sql
insert into public.atm_locations (name, address, city, state, zip_code, latitude, longitude, features, hours_text)
values
  ('Downtown ATM', '100 Market St', 'San Francisco', 'CA', '94105', 37.7936, -122.3966, array['drive-up','deposit'], 'Mon-Sun 6am-10pm'),
  ('Campus ATM', '500 College Ave', 'Berkeley', 'CA', '94704', 37.8715, -122.2730, array['24hr'], '24 hours');
```

### 4) Create a test user in the app
1. Start the frontend (`cd frontend` then `npm install` if needed, then `npm run dev`).
2. Open the app and register a user with a valid email + password.
3. After sign-in, use the app to reach any page that lists accounts, transactions, or ATMs to confirm reads work.

### 5) Sanity-check RLS (optional)
1. In Supabase `SQL Editor`, run a query as the `authenticated` role for your user.
2. Confirm `accounts`, `transactions`, and `deposits` only return rows where `user_id = auth.uid()`.

### 6) Storage smoke check (optional)
1. In the app, attempt a deposit image upload if/when the UI is wired.
2. Verify the object path uses `{user_id}/{deposit_id}/front.ext` and the file appears in `deposit-check-images`.

## Quick demo narrative
1. Show signup and login.
2. Show empty states for accounts/transactions (new user).
3. Navigate to the ATM locator and show seeded ATMs.
4. Explain that money movement will be ledger-backed, with RLS enforcing user isolation.
