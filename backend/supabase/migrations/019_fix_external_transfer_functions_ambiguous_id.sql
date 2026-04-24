create or replace function public.submit_external_outbound_transfer(
  p_user_id uuid,
  p_from_account_id uuid,
  p_external_account_id uuid,
  p_amount_cents bigint,
  p_transfer_date date,
  p_memo text default null,
  p_external_transfer_plan_id uuid default null,
  p_settle_after timestamptz default null
)
returns table (
  id uuid,
  status text,
  submitted_at timestamptz,
  settle_after timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  from_account public.accounts%rowtype;
  ext_account public.external_accounts%rowtype;
  transfer_row public.external_transfers%rowtype;
  journal_id uuid;
  from_ledger_id uuid;
  clearing_ledger_id uuid;
  effective_ts timestamptz := timezone('utc', now());
  settlement_ts timestamptz := coalesce(p_settle_after, effective_ts + interval '15 seconds');
  description_text text;
begin
  if p_transfer_date is null then
    raise exception 'Transfer date is required.';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Transfer amount must be greater than zero.';
  end if;

  select a.*
  into from_account
  from public.accounts as a
  where a.id = p_from_account_id
    and a.user_id = p_user_id
  for update;

  if from_account.id is null then
    raise exception 'Source account not found.';
  end if;

  if from_account.account_type <> 'checking' then
    raise exception 'External transfers require a checking account.';
  end if;

  if from_account.status <> 'open' then
    raise exception 'Source account must be open.';
  end if;

  if from_account.available_balance_cents < p_amount_cents then
    raise exception 'Insufficient available funds.';
  end if;

  select ea.*
  into ext_account
  from public.external_accounts as ea
  where ea.id = p_external_account_id
    and ea.user_id = p_user_id
  for update;

  if ext_account.id is null then
    raise exception 'External account not found.';
  end if;

  if ext_account.is_active is not true or ext_account.verification_status <> 'verified' then
    raise exception 'External account is not available.';
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
    'bank',
    null,
    null,
    'BANK_EXT_OUTBOUND_CLEARING',
    'External Outbound Clearing',
    'asset',
    'debit',
    'USD',
    true
  )
  on conflict (ledger_code) do nothing;

  select la.id
  into from_ledger_id
  from public.ledger_accounts as la
  where la.product_account_id = from_account.id
  limit 1;

  select la.id
  into clearing_ledger_id
  from public.ledger_accounts as la
  where la.ledger_code = 'BANK_EXT_OUTBOUND_CLEARING'
  limit 1;

  description_text := coalesce(
    nullif(trim(p_memo), ''),
    'External transfer to ' || ext_account.bank_name || ' ' || ext_account.masked_account_number
  );

  insert into public.external_transfers (
    user_id,
    from_account_id,
    external_account_id,
    amount_cents,
    memo,
    transfer_date,
    status,
    submitted_at,
    processed_at,
    settle_after,
    external_transfer_plan_id
  )
  values (
    p_user_id,
    from_account.id,
    ext_account.id,
    p_amount_cents,
    nullif(trim(p_memo), ''),
    p_transfer_date,
    'processing',
    effective_ts,
    effective_ts,
    settlement_ts,
    p_external_transfer_plan_id
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
    'external_transfer',
    transfer_row.id,
    description_text,
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
    (journal_id, from_ledger_id, p_amount_cents, 'debit', effective_ts),
    (journal_id, clearing_ledger_id, p_amount_cents, 'credit', effective_ts);

  update public.accounts as a
  set
    available_balance_cents = a.available_balance_cents - p_amount_cents,
    current_balance_cents = a.current_balance_cents - p_amount_cents
  where a.id = from_account.id;

  insert into public.transactions (
    user_id,
    account_id,
    journal_id,
    type,
    direction,
    amount_cents,
    description,
    status,
    external_transfer_id
  )
  values (
    p_user_id,
    from_account.id,
    journal_id,
    'transfer',
    'out',
    p_amount_cents,
    description_text,
    'pending',
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
    'External transfer submitted',
    description_text || ' is processing.',
    effective_ts
  );

  return query
  select transfer_row.id, transfer_row.status, transfer_row.submitted_at, transfer_row.settle_after;
end;
$$;

create or replace function public.complete_external_outbound_transfer(
  p_user_id uuid,
  p_external_transfer_id uuid
)
returns table (
  id uuid,
  status text,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer_row public.external_transfers%rowtype;
  completion_ts timestamptz := timezone('utc', now());
begin
  select et.*
  into transfer_row
  from public.external_transfers as et
  where et.id = p_external_transfer_id
    and et.user_id = p_user_id
  for update;

  if transfer_row.id is null then
    raise exception 'External transfer not found.';
  end if;

  if transfer_row.status <> 'processing' then
    raise exception 'Only processing transfers can be completed.';
  end if;

  update public.external_transfers as et
  set
    status = 'completed',
    completed_at = completion_ts
  where et.id = transfer_row.id;

  update public.transactions as t
  set
    status = 'posted',
    posted_at = completion_ts
  where t.external_transfer_id = transfer_row.id;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    created_at
  )
  values (
    transfer_row.user_id,
    'transfer',
    'External transfer completed',
    'Your external transfer was completed successfully.',
    completion_ts
  );

  return query
  select transfer_row.id, 'completed'::text, completion_ts;
end;
$$;

create or replace function public.fail_external_outbound_transfer(
  p_user_id uuid,
  p_external_transfer_id uuid,
  p_failure_reason text default null
)
returns table (
  id uuid,
  status text,
  completed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  transfer_row public.external_transfers%rowtype;
  from_account public.accounts%rowtype;
  journal_id uuid;
  from_ledger_id uuid;
  clearing_ledger_id uuid;
  completion_ts timestamptz := timezone('utc', now());
  reason_text text := coalesce(nullif(trim(p_failure_reason), ''), 'External transfer failed.');
begin
  select et.*
  into transfer_row
  from public.external_transfers as et
  where et.id = p_external_transfer_id
    and et.user_id = p_user_id
  for update;

  if transfer_row.id is null then
    raise exception 'External transfer not found.';
  end if;

  if transfer_row.status <> 'processing' then
    raise exception 'Only processing transfers can be failed.';
  end if;

  select a.*
  into from_account
  from public.accounts as a
  where a.id = transfer_row.from_account_id
  for update;

  select la.id
  into from_ledger_id
  from public.ledger_accounts as la
  where la.product_account_id = transfer_row.from_account_id
  limit 1;

  select la.id
  into clearing_ledger_id
  from public.ledger_accounts as la
  where la.ledger_code = 'BANK_EXT_OUTBOUND_CLEARING'
  limit 1;

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
    'external_transfer_reversal',
    transfer_row.id,
    reason_text,
    completion_ts,
    transfer_row.user_id
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
    (journal_id, clearing_ledger_id, transfer_row.amount_cents, 'debit', completion_ts),
    (journal_id, from_ledger_id, transfer_row.amount_cents, 'credit', completion_ts);

  update public.accounts as a
  set
    available_balance_cents = a.available_balance_cents + transfer_row.amount_cents,
    current_balance_cents = a.current_balance_cents + transfer_row.amount_cents
  where a.id = transfer_row.from_account_id;

  update public.external_transfers as et
  set
    status = 'failed',
    completed_at = completion_ts,
    failure_reason = reason_text
  where et.id = transfer_row.id;

  update public.transactions as t
  set
    status = 'failed',
    posted_at = null
  where t.external_transfer_id = transfer_row.id;

  insert into public.notifications (
    user_id,
    type,
    title,
    body,
    created_at
  )
  values (
    transfer_row.user_id,
    'transfer',
    'External transfer failed',
    reason_text,
    completion_ts
  );

  return query
  select transfer_row.id, 'failed'::text, completion_ts;
end;
$$;

grant execute on function public.submit_external_outbound_transfer(uuid, uuid, uuid, bigint, date, text, uuid, timestamptz) to service_role;
grant execute on function public.complete_external_outbound_transfer(uuid, uuid) to service_role;
grant execute on function public.fail_external_outbound_transfer(uuid, uuid, text) to service_role;
