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
  payment_row public.bill_payments%rowtype;
  account_row public.accounts%rowtype;
  journal_id uuid;
  ledger_id uuid;
  effective_ts timestamptz := timezone('utc', now());
begin
  if p_payment_id is null then
    raise exception 'Payment ID is required.';
  end if;

  if p_account_id is null then
    raise exception 'Account ID is required.';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  -- Lock account row for update to prevent race conditions
  perform 1
  from public.accounts
  where id = p_account_id
    and user_id = p_user_id
  for update;

  -- Fetch the payment
  select *
  into payment_row
  from public.bill_payments
  where id = p_payment_id
    and user_id = p_user_id
    and account_id = p_account_id;

  if payment_row.id is null then
    raise exception 'Payment not found.';
  end if;

  if payment_row.status not in ('scheduled', 'processing') then
    raise exception 'Only scheduled or processing payments can be executed.';
  end if;

  -- Fetch the account
  select *
  into account_row
  from public.accounts
  where id = p_account_id
    and user_id = p_user_id;

  if account_row.id is null then
    raise exception 'Account not found.';
  end if;

  if account_row.status <> 'open' then
    raise exception 'Account must be open to process payments.';
  end if;

  -- Check available balance - MUST have sufficient funds
  if account_row.available_balance_cents < p_amount_cents then
    raise exception 'Insufficient available balance.';
  end if;

  -- Verify payment amount matches request
  if payment_row.amount_cents <> p_amount_cents then
    raise exception 'Payment amount mismatch.';
  end if;

  -- Create or get ledger account for this product account
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
  into ledger_id
  from public.ledger_accounts
  where product_account_id = account_row.id
  limit 1;

  if ledger_id is null then
    raise exception 'Unable to locate customer ledger account for this payment.';
  end if;

  -- Insert journal entry
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
    format('Bill payment to payee %s', payment_row.payee_id),
    effective_ts,
    p_user_id
  )
  returning id
  into journal_id;

  -- Insert ledger posting
  insert into public.ledger_postings (
    journal_id,
    ledger_account_id,
    amount_cents,
    entry_side,
    posted_at
  )
  values (journal_id, ledger_id, p_amount_cents, 'debit', effective_ts);

  -- Debit the account
  update public.accounts
  set
    available_balance_cents = available_balance_cents - p_amount_cents,
    current_balance_cents = current_balance_cents - p_amount_cents
  where id = account_row.id;

  -- Mark payment as completed
  update public.bill_payments
  set
    status = 'completed',
    processed_at = effective_ts,
    failure_reason = null,
    next_run_at = null
  where id = payment_row.id;

  -- Insert transaction record
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
    'Bill payment',
    'posted',
    effective_ts,
    payment_row.id
  );

  return query
  select payment_row.id, 'completed'::text, effective_ts;
end;
$$;

grant execute on function public.submit_bill_payment(uuid, uuid, uuid, bigint) to service_role;
