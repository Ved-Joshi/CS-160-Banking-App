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
  'bank',
  null,
  null,
  'BANK_BILLPAY_CLEARING_USD',
  'Bill Pay Clearing',
  'liability',
  'credit',
  'USD',
  true
)
on conflict (ledger_code) do update
set
  owner_type = excluded.owner_type,
  owner_user_id = excluded.owner_user_id,
  product_account_id = excluded.product_account_id,
  name = excluded.name,
  account_class = excluded.account_class,
  normal_balance = excluded.normal_balance,
  currency = excluded.currency,
  is_active = excluded.is_active;

create or replace function public.submit_bill_payment(
  p_user_id uuid,
  p_payment_id uuid,
  p_account_id uuid,
  p_amount_cents bigint
)
returns table (
  id uuid,
  status text,
  processed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.accounts%rowtype;
  payment_row public.bill_payments%rowtype;
  journal_id uuid;
  customer_ledger_id uuid;
  clearing_ledger_id uuid;
  effective_ts timestamptz := timezone('utc', now());
  payee_name text;
begin
  if p_amount_cents <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  select bp.*
  into payment_row
  from public.bill_payments as bp
  where bp.id = p_payment_id
    and bp.user_id = p_user_id
  for update;

  if payment_row.id is null then
    raise exception 'Payment not found.';
  end if;

  if payment_row.status not in ('scheduled', 'processing') then
    raise exception 'Only scheduled or processing payments can be executed.';
  end if;

  if payment_row.account_id <> p_account_id then
    raise exception 'Payment account mismatch.';
  end if;

  if payment_row.amount_cents <> p_amount_cents then
    raise exception 'Payment amount mismatch.';
  end if;

  select a.*
  into account_row
  from public.accounts as a
  where a.id = p_account_id
    and a.user_id = p_user_id
  for update;

  if account_row.id is null then
    raise exception 'Funding account not found.';
  end if;

  if account_row.status <> 'open' then
    raise exception 'Funding account must be open.';
  end if;

  if account_row.available_balance_cents < p_amount_cents then
    raise exception 'Insufficient available balance.';
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

  select la.id
  into customer_ledger_id
  from public.ledger_accounts as la
  where la.product_account_id = account_row.id
  limit 1;

  select la.id
  into clearing_ledger_id
  from public.ledger_accounts as la
  where la.ledger_code = 'BANK_BILLPAY_CLEARING_USD'
  limit 1;

  if customer_ledger_id is null then
    raise exception 'Unable to locate customer ledger account.';
  end if;

  if clearing_ledger_id is null then
    raise exception 'Unable to locate bill payment clearing ledger account.';
  end if;

  select p.name
  into payee_name
  from public.payees as p
  where p.id = payment_row.payee_id;

  insert into public.ledger_journals (
    event_type,
    reference_type,
    reference_id,
    description,
    effective_at,
    created_by
  )
  values (
    'bill_payment',
    'bill_payment',
    payment_row.id,
    coalesce('Bill payment to ' || nullif(payee_name, ''), 'Bill payment'),
    effective_ts,
    p_user_id
  )
  returning ledger_journals.id
  into journal_id;

  insert into public.ledger_postings (
    journal_id,
    ledger_account_id,
    amount_cents,
    entry_side,
    posted_at
  )
  values
    (journal_id, customer_ledger_id, p_amount_cents, 'debit', effective_ts),
    (journal_id, clearing_ledger_id, p_amount_cents, 'credit', effective_ts);

  update public.accounts as a
  set
    available_balance_cents = a.available_balance_cents - p_amount_cents,
    current_balance_cents = a.current_balance_cents - p_amount_cents
  where a.id = account_row.id;

  update public.bill_payments as bp
  set
    status = 'completed',
    processed_at = effective_ts,
    next_run_at = null,
    failure_reason = null
  where bp.id = payment_row.id;

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
    bill_payment_id
  )
  values (
    p_user_id,
    account_row.id,
    journal_id,
    'bill_payment',
    'out',
    p_amount_cents,
    coalesce('Bill payment to ' || nullif(payee_name, ''), 'Bill payment'),
    'posted',
    effective_ts,
    payment_row.id
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
    'payment',
    'Bill payment completed',
    format(
      'Your bill payment of $%s has completed.',
      to_char((p_amount_cents::numeric / 100.0), 'FM999999990.00')
    ),
    effective_ts
  );

  return query
  select payment_row.id, 'completed'::text, effective_ts;
end;
$$;

grant execute on function public.submit_bill_payment(uuid, uuid, uuid, bigint) to service_role;
