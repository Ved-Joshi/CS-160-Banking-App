-- Patch constraints and RLS policies for existing installations

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ledger_accounts_ledger_code_unique'
  ) then
    alter table public.ledger_accounts
      add constraint ledger_accounts_ledger_code_unique unique (ledger_code);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transfers_amount_positive'
  ) then
    alter table public.transfers
      add constraint transfers_amount_positive check (amount_cents > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bill_payments_amount_positive'
  ) then
    alter table public.bill_payments
      add constraint bill_payments_amount_positive check (amount_cents > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deposits_amount_positive'
  ) then
    alter table public.deposits
      add constraint deposits_amount_positive check (amount_cents > 0);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_amount_positive'
  ) then
    alter table public.transactions
      add constraint transactions_amount_positive check (amount_cents > 0);
  end if;
end $$;

-- Ensure transactions.account_id does not cascade delete
alter table public.transactions
  drop constraint if exists transactions_account_id_fkey;

alter table public.transactions
  add constraint transactions_account_id_fkey
  foreign key (account_id) references public.accounts (id) on delete restrict;

-- RLS policy tightening
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists accounts_own on public.accounts;
drop policy if exists transactions_own on public.transactions;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'accounts'
      and policyname = 'accounts_select_own'
  ) then
    create policy accounts_select_own
      on public.accounts for select
      using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'transactions'
      and policyname = 'transactions_select_own'
  ) then
    create policy transactions_select_own
      on public.transactions for select
      using (auth.uid() = user_id);
  end if;
end $$;
