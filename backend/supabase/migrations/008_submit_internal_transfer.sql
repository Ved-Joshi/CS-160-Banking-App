create or replace function public.submit_internal_transfer(
  p_user_id uuid,
  p_from_account_id uuid,
  p_to_account_id uuid,
  p_amount_cents bigint,
  p_transfer_date date,
  p_memo text default null
)
returns table (
  id uuid,
  status text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  from_account public.accounts%rowtype;
  to_account public.accounts%rowtype;
  transfer_row public.transfers%rowtype;
  journal_id uuid;
  from_ledger_id uuid;
  to_ledger_id uuid;
  created_notification_id uuid;
  effective_ts timestamptz := timezone('utc', now());
  transfer_description text;
begin
  if p_transfer_date is null then
    raise exception 'Transfer date is required.';
  end if;

  if p_transfer_date <> current_date then
    raise exception 'Only same-day transfers are supported.';
  end if;

  if p_from_account_id = p_to_account_id then
    raise exception 'Choose two different accounts.';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Transfer amount must be greater than zero.';
  end if;

  perform 1
  from public.accounts
  where id in (p_from_account_id, p_to_account_id)
    and user_id = p_user_id
  order by id
  for update;

  select *
  into from_account
  from public.accounts
  where id = p_from_account_id
    and user_id = p_user_id;

  select *
  into to_account
  from public.accounts
  where id = p_to_account_id
    and user_id = p_user_id;

  if from_account.id is null then
    raise exception 'Source account not found.';
  end if;

  if to_account.id is null then
    raise exception 'Destination account not found.';
  end if;

  if from_account.status <> 'open' or to_account.status <> 'open' then
    raise exception 'Transfers require both accounts to be open.';
  end if;

  if from_account.available_balance_cents < p_amount_cents then
    raise exception 'Insufficient available funds.';
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
    from_account.id,
    'CUST_ACCT_' || replace(from_account.id::text, '-', ''),
    coalesce(from_account.nickname, 'Customer Account'),
    'liability',
    'credit',
    'USD',
    true
  )
  on conflict (ledger_code) do nothing;

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
    to_account.id,
    'CUST_ACCT_' || replace(to_account.id::text, '-', ''),
    coalesce(to_account.nickname, 'Customer Account'),
    'liability',
    'credit',
    'USD',
    true
  )
  on conflict (ledger_code) do nothing;

  select id
  into from_ledger_id
  from public.ledger_accounts
  where product_account_id = from_account.id
  limit 1;

  select id
  into to_ledger_id
  from public.ledger_accounts
  where product_account_id = to_account.id
  limit 1;

  if from_ledger_id is null or to_ledger_id is null then
    raise exception 'Unable to locate customer ledger accounts for this transfer.';
  end if;

  transfer_description := coalesce(nullif(trim(p_memo), ''), 'Internal transfer');

  insert into public.transfers (
    user_id,
    from_account_id,
    to_account_id,
    amount_cents,
    memo,
    transfer_date,
    status,
    submitted_at,
    completed_at
  )
  values (
    p_user_id,
    from_account.id,
    to_account.id,
    p_amount_cents,
    nullif(trim(p_memo), ''),
    p_transfer_date,
    'completed',
    effective_ts,
    effective_ts
  )
  returning *
  into transfer_row;

  insert into public.ledger_journals (
    event_type,
    reference_type,
    reference_id,
    description,
    effective_at,
    created_by
  )
  values (
    'transfer',
    'transfer',
    transfer_row.id,
    transfer_description,
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
    (journal_id, from_ledger_id, p_amount_cents, 'debit', effective_ts),
    (journal_id, to_ledger_id, p_amount_cents, 'credit', effective_ts);

  update public.accounts
  set
    available_balance_cents = available_balance_cents - p_amount_cents,
    current_balance_cents = current_balance_cents - p_amount_cents
  where id = from_account.id;

  update public.accounts
  set
    available_balance_cents = available_balance_cents + p_amount_cents,
    current_balance_cents = current_balance_cents + p_amount_cents
  where id = to_account.id;

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
    transfer_id
  )
  values
    (
      p_user_id,
      from_account.id,
      journal_id,
      'transfer',
      'out',
      p_amount_cents,
      transfer_description,
      'posted',
      effective_ts,
      transfer_row.id
    ),
    (
      p_user_id,
      to_account.id,
      journal_id,
      'transfer',
      'in',
      p_amount_cents,
      transfer_description,
      'posted',
      effective_ts,
      transfer_row.id
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
    'transfer',
    'Transfer completed',
    format(
      'Your transfer of $%s from %s to %s has completed.',
      to_char((p_amount_cents::numeric / 100.0), 'FM999999990.00'),
      coalesce(from_account.nickname, 'your source account'),
      coalesce(to_account.nickname, 'your destination account')
    ),
    effective_ts
  )
  returning id
  into created_notification_id;

  return query
  select transfer_row.id, transfer_row.status, transfer_row.submitted_at;
end;
$$;

grant execute on function public.submit_internal_transfer(uuid, uuid, uuid, bigint, date, text) to service_role;
