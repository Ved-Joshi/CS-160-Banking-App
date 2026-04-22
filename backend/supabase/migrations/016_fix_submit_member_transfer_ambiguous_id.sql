create or replace function public.submit_member_transfer(
  p_user_id uuid,
  p_from_account_id uuid,
  p_recipient_user_id uuid,
  p_amount_cents bigint,
  p_transfer_date date,
  p_memo text default null,
  p_member_transfer_plan_id uuid default null
)
returns table (
  id uuid,
  status text,
  submitted_at timestamptz,
  recipient_account_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  from_account public.accounts%rowtype;
  to_account public.accounts%rowtype;
  transfer_row public.member_transfers%rowtype;
  journal_id uuid;
  from_ledger_id uuid;
  to_ledger_id uuid;
  effective_ts timestamptz := timezone('utc', now());
  sender_name text;
  recipient_name text;
  description_for_sender text;
  description_for_recipient text;
begin
  if p_transfer_date is null then
    raise exception 'Transfer date is required.';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'Transfer amount must be greater than zero.';
  end if;

  if p_user_id = p_recipient_user_id then
    raise exception 'Choose another member.';
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
    raise exception 'Member transfers require a checking account.';
  end if;

  if from_account.status <> 'open' then
    raise exception 'Source account must be open.';
  end if;

  if from_account.available_balance_cents < p_amount_cents then
    raise exception 'Insufficient available funds.';
  end if;

  select a.*
  into to_account
  from public.accounts as a
  where a.user_id = p_recipient_user_id
    and a.account_type = 'checking'
    and a.status = 'open'
    and a.is_default_internal_receive = true
  for update;

  if to_account.id is null then
    raise exception 'Recipient does not have a default checking account.';
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
    p_recipient_user_id,
    to_account.id,
    'CUST_ACCT_' || replace(to_account.id::text, '-', ''),
    coalesce(to_account.nickname, 'Customer Account'),
    'liability',
    'credit',
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
  into to_ledger_id
  from public.ledger_accounts as la
  where la.product_account_id = to_account.id
  limit 1;

  select trim(concat_ws(' ', p.first_name, p.last_name))
  into sender_name
  from public.profiles as p
  where p.id = p_user_id;

  select trim(concat_ws(' ', p.first_name, p.last_name))
  into recipient_name
  from public.profiles as p
  where p.id = p_recipient_user_id;

  description_for_sender := coalesce(nullif(trim(p_memo), ''), 'Transfer to ' || coalesce(nullif(recipient_name, ''), 'member'));
  description_for_recipient := coalesce(nullif(trim(p_memo), ''), 'Transfer from ' || coalesce(nullif(sender_name, ''), 'member'));

  insert into public.member_transfers (
    user_id,
    from_account_id,
    recipient_user_id,
    recipient_account_id,
    amount_cents,
    memo,
    transfer_date,
    status,
    submitted_at,
    completed_at,
    member_transfer_plan_id
  )
  values (
    p_user_id,
    from_account.id,
    p_recipient_user_id,
    to_account.id,
    p_amount_cents,
    nullif(trim(p_memo), ''),
    p_transfer_date,
    'completed',
    effective_ts,
    effective_ts,
    p_member_transfer_plan_id
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
    'member_transfer',
    transfer_row.id,
    description_for_sender,
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
    (journal_id, to_ledger_id, p_amount_cents, 'credit', effective_ts);

  update public.accounts as a
  set
    available_balance_cents = a.available_balance_cents - p_amount_cents,
    current_balance_cents = a.current_balance_cents - p_amount_cents
  where a.id = from_account.id;

  update public.accounts as a
  set
    available_balance_cents = a.available_balance_cents + p_amount_cents,
    current_balance_cents = a.current_balance_cents + p_amount_cents
  where a.id = to_account.id;

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
    member_transfer_id
  )
  values
    (
      p_user_id,
      from_account.id,
      journal_id,
      'transfer',
      'out',
      p_amount_cents,
      description_for_sender,
      'posted',
      effective_ts,
      transfer_row.id
    ),
    (
      p_recipient_user_id,
      to_account.id,
      journal_id,
      'transfer',
      'in',
      p_amount_cents,
      description_for_recipient,
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
  values
    (
      p_user_id,
      'transfer',
      'Transfer sent',
      description_for_sender || ' was completed.',
      effective_ts
    ),
    (
      p_recipient_user_id,
      'transfer',
      'Transfer received',
      description_for_recipient || ' was completed.',
      effective_ts
    );

  return query
  select transfer_row.id, 'completed'::text, transfer_row.submitted_at, transfer_row.recipient_account_id;
end;
$$;
