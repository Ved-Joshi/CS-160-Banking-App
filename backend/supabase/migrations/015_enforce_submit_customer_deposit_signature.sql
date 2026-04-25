-- Enforce a single canonical RPC signature for customer deposits.
-- Canonical signature:
--   submit_customer_deposit(p_user_id uuid, p_account_id uuid, p_amount_cents bigint, p_deposit_type text)

drop function if exists public.submit_customer_deposit(uuid, uuid, bigint);
drop function if exists public.submit_customer_deposit(uuid, bigint, uuid);
drop function if exists public.submit_customer_deposit(uuid, bigint);
drop function if exists public.submit_customer_deposit(uuid, uuid, bigint, text);

create or replace function public.submit_customer_deposit(
  p_user_id uuid,
  p_account_id uuid,
  p_amount_cents bigint,
  p_deposit_type text
)
returns table (
  id uuid,
  account_id uuid,
  amount_cents bigint,
  deposit_type text,
  status text,
  note text,
  submitted_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.accounts%rowtype;
  deposit_row public.deposits%rowtype;
  journal_id uuid;
  customer_ledger_id uuid;
  clearing_ledger_id uuid;
  effective_ts timestamptz := timezone('utc', now());
  deposit_description text;
begin
  if p_amount_cents <= 0 then
    raise exception 'Deposit amount must be greater than zero.';
  end if;

  if p_deposit_type not in ('cash', 'check') then
    raise exception 'Deposit type must be either cash or check.';
  end if;

  perform 1
  from public.accounts
  where id = p_account_id
    and user_id = p_user_id
  for update;

  select *
  into account_row
  from public.accounts
  where id = p_account_id
    and user_id = p_user_id;

  if account_row.id is null then
    raise exception 'Account not found.';
  end if;

  if account_row.status <> 'open' then
    raise exception 'Deposits require an open account.';
  end if;

  insert into public.ledger_accounts (
    owner_type,
    owner_user_id,
    product_account_id,
    ledger_code,
    name,
    account_class,
    normal_balance,
    currency,
    is_active
  )
  values (
    'customer',
    p_user_id,
    account_row.id,
    'CUST_ACCT_' || replace(account_row.id::text, '-', ''),
    coalesce(account_row.nickname, 'Customer Account'),
    'liability',
    'credit',
    'USD',
    true
  )
  on conflict (ledger_code) do nothing;

  select id
  into customer_ledger_id
  from public.ledger_accounts
  where product_account_id = account_row.id
  limit 1;

  select id
  into clearing_ledger_id
  from public.ledger_accounts
  where ledger_code = 'DEPOSIT_CLEARING'
  limit 1;

  if customer_ledger_id is null then
    raise exception 'Unable to locate the customer ledger account for this deposit.';
  end if;

  if clearing_ledger_id is null then
    raise exception 'Unable to locate the bank deposit clearing ledger account.';
  end if;

  deposit_description := case
    when p_deposit_type = 'cash' then 'Cash deposit'
    else 'Check deposit'
  end;

  insert into public.deposits (
    user_id,
    account_id,
    amount_cents,
    deposit_type,
    status,
    note,
    submitted_at,
    reviewed_at
  )
  values (
    p_user_id,
    account_row.id,
    p_amount_cents,
    p_deposit_type,
    'approved',
    deposit_description || ' completed successfully.',
    effective_ts,
    effective_ts
  )
  returning *
  into deposit_row;

  insert into public.ledger_journals (
    event_type,
    reference_type,
    reference_id,
    description,
    effective_at,
    created_by
  )
  values (
    'deposit',
    'deposit',
    deposit_row.id,
    deposit_description,
    effective_ts,
    p_user_id
  )
  returning id
  into journal_id;

  insert into public.ledger_postings (
    journal_id,
    ledger_account_id,
    amount_cents,
    entry_side,
    posted_at
  )
  values
    (journal_id, clearing_ledger_id, p_amount_cents, 'debit', effective_ts),
    (journal_id, customer_ledger_id, p_amount_cents, 'credit', effective_ts);

  update public.accounts
  set
    available_balance_cents = available_balance_cents + p_amount_cents,
    current_balance_cents = current_balance_cents + p_amount_cents
  where id = account_row.id;

  insert into public.transactions (
    user_id,
    account_id,
    journal_id,
    type,
    direction,
    amount_cents,
    description,
    status,
    posted_at,
    deposit_id
  )
  values (
    p_user_id,
    account_row.id,
    journal_id,
    'deposit',
    'in',
    p_amount_cents,
    deposit_description,
    'posted',
    effective_ts,
    deposit_row.id
  );

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    created_at
  )
  values (
    p_user_id,
    'deposit',
    'Deposit completed',
    format(
      'Your %s of $%s was deposited into %s.',
      p_deposit_type,
      to_char((p_amount_cents::numeric / 100.0), 'FM999999990.00'),
      coalesce(account_row.nickname, 'your account')
    ),
    effective_ts
  );

  return query
  select
    deposit_row.id,
    deposit_row.account_id,
    deposit_row.amount_cents,
    deposit_row.deposit_type,
    deposit_row.status,
    deposit_row.note,
    deposit_row.submitted_at,
    deposit_row.created_at,
    deposit_row.updated_at;
end;
$$;

grant execute on function public.submit_customer_deposit(uuid, uuid, bigint, text) to service_role;
