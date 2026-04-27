alter table public.deposits
  add column if not exists settle_after_at timestamptz;

update public.deposits
set deposit_type = case
  when deposit_type = 'cash' then 'atm'
  when deposit_type is null then 'check'
  else deposit_type
end;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'deposits_deposit_type_check'
  ) then
    alter table public.deposits
      drop constraint deposits_deposit_type_check;
  end if;

  alter table public.deposits
    add constraint deposits_deposit_type_check
      check (deposit_type in ('atm', 'check'));
end;
$$;

create or replace function public.submit_customer_deposit(
  p_user_id uuid,
  p_account_id uuid,
  p_amount_cents bigint,
  p_deposit_method text,
  p_front_image_path text default null,
  p_back_image_path text default null
)
returns table (
  id uuid,
  account_id uuid,
  amount_cents bigint,
  deposit_type text,
  status text,
  note text,
  front_image_path text,
  back_image_path text,
  settle_after_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
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
  bank_cash_ledger_id uuid;
  effective_ts timestamptz := timezone('utc', now());
  deposit_description text;
begin
  if p_amount_cents <= 0 then
    raise exception 'Deposit amount must be greater than zero.';
  end if;

  if p_deposit_method not in ('atm', 'check') then
    raise exception 'Deposit method must be atm or check.';
  end if;

  if p_deposit_method = 'check' then
    if p_front_image_path is null or p_back_image_path is null then
      raise exception 'Check deposits require front and back image paths.';
    end if;
  end if;

  select a.*
  into account_row
  from public.accounts as a
  where a.id = p_account_id
    and a.user_id = p_user_id
  for update;

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

  select la.id
  into customer_ledger_id
  from public.ledger_accounts as la
  where la.product_account_id = account_row.id
  limit 1;

  if customer_ledger_id is null then
    raise exception 'Unable to locate customer ledger account.';
  end if;

  if p_deposit_method = 'atm' then
    select la.id
    into bank_cash_ledger_id
    from public.ledger_accounts as la
    where la.ledger_code = 'BANK_VAULT_CASH'
    limit 1;

    if bank_cash_ledger_id is null then
      raise exception 'Unable to locate bank vault cash ledger account.';
    end if;

    deposit_description := 'ATM deposit';

    insert into public.deposits (
      user_id,
      account_id,
      amount_cents,
      deposit_type,
      status,
      note,
      submitted_at,
      reviewed_at,
      settle_after_at
    )
    values (
      p_user_id,
      account_row.id,
      p_amount_cents,
      'atm',
      'approved',
      'ATM deposit completed successfully.',
      effective_ts,
      effective_ts,
      null
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
      (journal_id, bank_cash_ledger_id, p_amount_cents, 'debit', effective_ts),
      (journal_id, customer_ledger_id, p_amount_cents, 'credit', effective_ts);

    update public.accounts as a
    set
      available_balance_cents = a.available_balance_cents + p_amount_cents,
      current_balance_cents = a.current_balance_cents + p_amount_cents
    where a.id = account_row.id;

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
        'Your ATM deposit of $%s was credited to %s.',
        to_char((p_amount_cents::numeric / 100.0), 'FM999999990.00'),
        coalesce(account_row.nickname, 'your account')
      ),
      effective_ts
    );
  else
    insert into public.deposits (
      user_id,
      account_id,
      amount_cents,
      deposit_type,
      status,
      note,
      front_image_path,
      back_image_path,
      submitted_at,
      reviewed_at,
      settle_after_at
    )
    values (
      p_user_id,
      account_row.id,
      p_amount_cents,
      'check',
      'under_review',
      'Check deposit pending review.',
      p_front_image_path,
      p_back_image_path,
      effective_ts,
      null,
      effective_ts + interval '10 seconds'
    )
    returning *
    into deposit_row;

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
      'Check deposit pending',
      format(
        'Your check deposit of $%s is pending review.',
        to_char((p_amount_cents::numeric / 100.0), 'FM999999990.00')
      ),
      effective_ts
    );
  end if;

  return query
  select
    deposit_row.id,
    deposit_row.account_id,
    deposit_row.amount_cents,
    deposit_row.deposit_type,
    deposit_row.status,
    deposit_row.note,
    deposit_row.front_image_path,
    deposit_row.back_image_path,
    deposit_row.settle_after_at,
    deposit_row.submitted_at,
    deposit_row.reviewed_at,
    deposit_row.created_at,
    deposit_row.updated_at;
end;
$$;

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
  front_image_path text,
  back_image_path text,
  settle_after_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_method text := case when p_deposit_type = 'cash' then 'atm' else 'check' end;
begin
  return query
  select *
  from public.submit_customer_deposit(
    p_user_id,
    p_account_id,
    p_amount_cents,
    normalized_method,
    null,
    null
  );
end;
$$;

create or replace function public.submit_atm_withdrawal(
  p_user_id uuid,
  p_account_id uuid,
  p_amount_cents bigint
)
returns table (
  id uuid,
  account_id uuid,
  amount_cents bigint,
  status text,
  submitted_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.accounts%rowtype;
  journal_id uuid;
  customer_ledger_id uuid;
  bank_cash_ledger_id uuid;
  effective_ts timestamptz := timezone('utc', now());
  transaction_row public.transactions%rowtype;
begin
  if p_amount_cents <= 0 then
    raise exception 'Withdrawal amount must be greater than zero.';
  end if;

  select a.*
  into account_row
  from public.accounts as a
  where a.id = p_account_id
    and a.user_id = p_user_id
  for update;

  if account_row.id is null then
    raise exception 'Account not found.';
  end if;

  if account_row.status <> 'open' then
    raise exception 'Withdrawals require an open account.';
  end if;

  if account_row.account_type not in ('checking', 'savings') then
    raise exception 'ATM withdrawals are only supported for checking and savings accounts.';
  end if;

  if account_row.available_balance_cents < p_amount_cents then
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
  into bank_cash_ledger_id
  from public.ledger_accounts as la
  where la.ledger_code = 'BANK_VAULT_CASH'
  limit 1;

  if customer_ledger_id is null then
    raise exception 'Unable to locate customer ledger account.';
  end if;

  if bank_cash_ledger_id is null then
    raise exception 'Unable to locate bank vault cash ledger account.';
  end if;

  insert into public.ledger_journals (
    event_type,
    reference_type,
    reference_id,
    description,
    effective_at,
    created_by
  )
  values (
    'withdrawal',
    'atm_withdrawal',
    account_row.id,
    'ATM withdrawal',
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
    (journal_id, bank_cash_ledger_id, p_amount_cents, 'credit', effective_ts);

  update public.accounts as a
  set
    available_balance_cents = a.available_balance_cents - p_amount_cents,
    current_balance_cents = a.current_balance_cents - p_amount_cents
  where a.id = account_row.id;

  insert into public.transactions (
    user_id,
    account_id,
    journal_id,
    type,
    direction,
    amount_cents,
    description,
    status,
    posted_at
  )
  values (
    p_user_id,
    account_row.id,
    journal_id,
    'fee',
    'out',
    p_amount_cents,
    'ATM withdrawal',
    'posted',
    effective_ts
  )
  returning *
  into transaction_row;

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
    'ATM withdrawal completed',
    format(
      'Your ATM withdrawal of $%s from %s is complete.',
      to_char((p_amount_cents::numeric / 100.0), 'FM999999990.00'),
      coalesce(account_row.nickname, 'your account')
    ),
    effective_ts
  );

  return query
  select
    transaction_row.id,
    transaction_row.account_id,
    transaction_row.amount_cents,
    transaction_row.status,
    transaction_row.posted_at;
end;
$$;

create or replace function public.process_due_check_deposits(
  p_limit int default 50
)
returns table (
  processed_count int,
  failed_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  due_row public.deposits%rowtype;
  account_row public.accounts%rowtype;
  journal_id uuid;
  customer_ledger_id uuid;
  bank_cash_ledger_id uuid;
  effective_ts timestamptz;
  processed int := 0;
  failed int := 0;
begin
  for due_row in
    select d.*
    from public.deposits as d
    where d.status = 'under_review'
      and d.deposit_type = 'check'
      and d.settle_after_at is not null
      and d.settle_after_at <= timezone('utc', now())
    order by d.submitted_at asc
    limit greatest(1, least(p_limit, 250))
    for update skip locked
  loop
    begin
      effective_ts := timezone('utc', now());

      select a.*
      into account_row
      from public.accounts as a
      where a.id = due_row.account_id
      for update;

      if account_row.id is null or account_row.status <> 'open' then
        update public.deposits as d
        set
          status = 'rejected',
          reviewed_at = effective_ts,
          note = 'Check deposit was declined because destination account is not open.'
        where d.id = due_row.id;
        failed := failed + 1;
        continue;
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
        due_row.user_id,
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
      into bank_cash_ledger_id
      from public.ledger_accounts as la
      where la.ledger_code = 'BANK_VAULT_CASH'
      limit 1;

      if customer_ledger_id is null or bank_cash_ledger_id is null then
        update public.deposits as d
        set
          status = 'rejected',
          reviewed_at = effective_ts,
          note = 'Check deposit was declined due to internal ledger configuration.'
        where d.id = due_row.id;
        failed := failed + 1;
        continue;
      end if;

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
        due_row.id,
        'Check deposit',
        effective_ts,
        due_row.user_id
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
        (journal_id, bank_cash_ledger_id, due_row.amount_cents, 'debit', effective_ts),
        (journal_id, customer_ledger_id, due_row.amount_cents, 'credit', effective_ts);

      update public.accounts as a
      set
        available_balance_cents = a.available_balance_cents + due_row.amount_cents,
        current_balance_cents = a.current_balance_cents + due_row.amount_cents
      where a.id = account_row.id;

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
        due_row.user_id,
        account_row.id,
        journal_id,
        'deposit',
        'in',
        due_row.amount_cents,
        'Check deposit',
        'posted',
        effective_ts,
        due_row.id
      );

      update public.deposits as d
      set
        status = 'approved',
        reviewed_at = effective_ts,
        note = 'Check deposit completed successfully.',
        settle_after_at = null
      where d.id = due_row.id;

      insert into public.notifications (
        user_id,
        type,
        title,
        body,
        created_at
      )
      values (
        due_row.user_id,
        'deposit',
        'Deposit completed',
        format(
          'Your check deposit of $%s was credited to %s.',
          to_char((due_row.amount_cents::numeric / 100.0), 'FM999999990.00'),
          coalesce(account_row.nickname, 'your account')
        ),
        effective_ts
      );

      processed := processed + 1;
    exception
      when others then
        failed := failed + 1;
        update public.deposits as d
        set
          status = 'rejected',
          reviewed_at = timezone('utc', now()),
          note = 'Check deposit failed during processing.'
        where d.id = due_row.id;
    end;
  end loop;

  return query select processed, failed;
end;
$$;

grant execute on function public.submit_customer_deposit(uuid, uuid, bigint, text, text, text) to service_role;
grant execute on function public.submit_customer_deposit(uuid, uuid, bigint, text) to service_role;
grant execute on function public.submit_atm_withdrawal(uuid, uuid, bigint) to service_role;
grant execute on function public.process_due_check_deposits(int) to service_role;
