alter table public.accounts
  add column if not exists is_default_internal_receive boolean not null default false;

create unique index if not exists accounts_one_default_internal_receive_idx
  on public.accounts (user_id)
  where is_default_internal_receive = true
    and account_type = 'checking'
    and status = 'open';

with users_without_default as (
  select distinct a.user_id
  from public.accounts a
  where a.account_type = 'checking'
    and a.status = 'open'
    and not exists (
      select 1
      from public.accounts existing
      where existing.user_id = a.user_id
        and existing.account_type = 'checking'
        and existing.status = 'open'
        and existing.is_default_internal_receive = true
    )
),
ranked_accounts as (
  select
    a.id,
    a.user_id,
    row_number() over (partition by a.user_id order by a.opened_at asc, a.created_at asc, a.id asc) as row_num
  from public.accounts a
  join users_without_default missing
    on missing.user_id = a.user_id
  where a.account_type = 'checking'
    and a.status = 'open'
)
update public.accounts target
set is_default_internal_receive = true
from ranked_accounts ranked
where target.id = ranked.id
  and ranked.row_num = 1;

create table if not exists public.member_transfer_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  recipient_user_id uuid not null references public.profiles (id) on delete restrict,
  recipient_handle text not null,
  amount_cents bigint not null,
  memo text,
  cadence text not null,
  start_date date not null,
  end_date date,
  run_time time not null,
  timezone text not null,
  status text not null default 'scheduled',
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_transfer_plans_amount_positive check (amount_cents > 0),
  constraint member_transfer_plans_cadence check (cadence in ('once', 'daily', 'weekly', 'biweekly', 'monthly')),
  constraint member_transfer_plans_status check (status in ('scheduled', 'processing', 'completed', 'cancelled')),
  constraint member_transfer_plans_timezone_valid check (public.timezone_name_exists(timezone)),
  constraint member_transfer_plans_date_range check (end_date is null or end_date >= start_date),
  constraint member_transfer_plans_recipient_not_self check (recipient_user_id <> user_id)
);

create index if not exists member_transfer_plans_due_idx
  on public.member_transfer_plans (status, next_run_at);

create index if not exists member_transfer_plans_user_idx
  on public.member_transfer_plans (user_id, created_at desc);

create trigger member_transfer_plans_set_updated_at
before update on public.member_transfer_plans
for each row execute function public.set_updated_at();

create table if not exists public.member_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  recipient_user_id uuid not null references public.profiles (id) on delete restrict,
  recipient_account_id uuid references public.accounts (id) on delete restrict,
  amount_cents bigint not null,
  memo text,
  transfer_date date not null,
  status text not null,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text,
  member_transfer_plan_id uuid references public.member_transfer_plans (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_transfers_amount_positive check (amount_cents > 0),
  constraint member_transfers_status check (status in ('pending', 'completed', 'failed', 'cancelled'))
);

create index if not exists member_transfers_user_idx
  on public.member_transfers (user_id, created_at desc);

create index if not exists member_transfers_plan_idx
  on public.member_transfers (member_transfer_plan_id);

create trigger member_transfers_set_updated_at
before update on public.member_transfers
for each row execute function public.set_updated_at();

create table if not exists public.external_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  bank_name text not null,
  nickname text not null,
  account_type text not null,
  masked_account_number text not null,
  routing_number text not null,
  verification_status text not null default 'verified',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_accounts_account_type check (account_type in ('checking', 'savings')),
  constraint external_accounts_verification_status check (verification_status in ('pending', 'verified', 'failed'))
);

create index if not exists external_accounts_user_idx
  on public.external_accounts (user_id, created_at desc);

create trigger external_accounts_set_updated_at
before update on public.external_accounts
for each row execute function public.set_updated_at();

create table if not exists public.external_transfer_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  external_account_id uuid not null references public.external_accounts (id) on delete restrict,
  amount_cents bigint not null,
  memo text,
  cadence text not null,
  start_date date not null,
  end_date date,
  run_time time not null,
  timezone text not null,
  status text not null default 'scheduled',
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_transfer_plans_amount_positive check (amount_cents > 0),
  constraint external_transfer_plans_cadence check (cadence in ('once', 'daily', 'weekly', 'biweekly', 'monthly')),
  constraint external_transfer_plans_status check (status in ('scheduled', 'processing', 'completed', 'cancelled')),
  constraint external_transfer_plans_timezone_valid check (public.timezone_name_exists(timezone)),
  constraint external_transfer_plans_date_range check (end_date is null or end_date >= start_date)
);

create index if not exists external_transfer_plans_due_idx
  on public.external_transfer_plans (status, next_run_at);

create index if not exists external_transfer_plans_user_idx
  on public.external_transfer_plans (user_id, created_at desc);

create trigger external_transfer_plans_set_updated_at
before update on public.external_transfer_plans
for each row execute function public.set_updated_at();

create table if not exists public.external_transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  external_account_id uuid not null references public.external_accounts (id) on delete restrict,
  amount_cents bigint not null,
  memo text,
  transfer_date date not null,
  status text not null,
  submitted_at timestamptz not null default now(),
  processed_at timestamptz,
  completed_at timestamptz,
  settle_after timestamptz not null,
  failure_reason text,
  external_transfer_plan_id uuid references public.external_transfer_plans (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_transfers_amount_positive check (amount_cents > 0),
  constraint external_transfers_status check (status in ('processing', 'completed', 'failed', 'cancelled'))
);

create index if not exists external_transfers_user_idx
  on public.external_transfers (user_id, created_at desc);

create index if not exists external_transfers_settle_idx
  on public.external_transfers (status, settle_after);

create index if not exists external_transfers_plan_idx
  on public.external_transfers (external_transfer_plan_id);

create trigger external_transfers_set_updated_at
before update on public.external_transfers
for each row execute function public.set_updated_at();

alter table public.transactions
  add column if not exists member_transfer_id uuid references public.member_transfers (id) on delete set null,
  add column if not exists external_transfer_id uuid references public.external_transfers (id) on delete set null;

create index if not exists transactions_member_transfer_idx
  on public.transactions (member_transfer_id);

create index if not exists transactions_external_transfer_idx
  on public.transactions (external_transfer_id);

alter table public.member_transfer_plans enable row level security;
alter table public.member_transfers enable row level security;
alter table public.external_accounts enable row level security;
alter table public.external_transfer_plans enable row level security;
alter table public.external_transfers enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'member_transfer_plans'
      and policyname = 'member_transfer_plans_own'
  ) then
    create policy member_transfer_plans_own
    on public.member_transfer_plans for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'member_transfers'
      and policyname = 'member_transfers_own'
  ) then
    create policy member_transfers_own
    on public.member_transfers for all
    using (auth.uid() = user_id or auth.uid() = recipient_user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'external_accounts'
      and policyname = 'external_accounts_own'
  ) then
    create policy external_accounts_own
    on public.external_accounts for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'external_transfer_plans'
      and policyname = 'external_transfer_plans_own'
  ) then
    create policy external_transfer_plans_own
    on public.external_transfer_plans for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'external_transfers'
      and policyname = 'external_transfers_own'
  ) then
    create policy external_transfers_own
    on public.external_transfers for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end;
$$;

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

  select *
  into from_account
  from public.accounts
  where id = p_from_account_id
    and user_id = p_user_id
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

  select *
  into to_account
  from public.accounts
  where user_id = p_recipient_user_id
    and account_type = 'checking'
    and status = 'open'
    and is_default_internal_receive = true
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

  select id into from_ledger_id
  from public.ledger_accounts
  where product_account_id = from_account.id
  limit 1;

  select id into to_ledger_id
  from public.ledger_accounts
  where product_account_id = to_account.id
  limit 1;

  select trim(concat_ws(' ', first_name, last_name))
  into sender_name
  from public.profiles
  where id = p_user_id;

  select trim(concat_ws(' ', first_name, last_name))
  into recipient_name
  from public.profiles
  where id = p_recipient_user_id;

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

  select *
  into from_account
  from public.accounts
  where id = p_from_account_id
    and user_id = p_user_id
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

  select *
  into ext_account
  from public.external_accounts
  where id = p_external_account_id
    and user_id = p_user_id
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

  select id into from_ledger_id
  from public.ledger_accounts
  where product_account_id = from_account.id
  limit 1;

  select id into clearing_ledger_id
  from public.ledger_accounts
  where ledger_code = 'BANK_EXT_OUTBOUND_CLEARING'
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
  returning id into journal_id;

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

  update public.accounts
  set
    available_balance_cents = available_balance_cents - p_amount_cents,
    current_balance_cents = current_balance_cents - p_amount_cents
  where id = from_account.id;

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
  select *
  into transfer_row
  from public.external_transfers
  where id = p_external_transfer_id
    and user_id = p_user_id
  for update;

  if transfer_row.id is null then
    raise exception 'External transfer not found.';
  end if;

  if transfer_row.status <> 'processing' then
    raise exception 'Only processing transfers can be completed.';
  end if;

  update public.external_transfers
  set
    status = 'completed',
    completed_at = completion_ts
  where id = transfer_row.id;

  update public.transactions
  set
    status = 'posted',
    posted_at = completion_ts
  where external_transfer_id = transfer_row.id;

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
  select *
  into transfer_row
  from public.external_transfers
  where id = p_external_transfer_id
    and user_id = p_user_id
  for update;

  if transfer_row.id is null then
    raise exception 'External transfer not found.';
  end if;

  if transfer_row.status <> 'processing' then
    raise exception 'Only processing transfers can be failed.';
  end if;

  select *
  into from_account
  from public.accounts
  where id = transfer_row.from_account_id
  for update;

  select id into from_ledger_id
  from public.ledger_accounts
  where product_account_id = transfer_row.from_account_id
  limit 1;

  select id into clearing_ledger_id
  from public.ledger_accounts
  where ledger_code = 'BANK_EXT_OUTBOUND_CLEARING'
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
  returning id into journal_id;

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

  update public.accounts
  set
    available_balance_cents = available_balance_cents + transfer_row.amount_cents,
    current_balance_cents = current_balance_cents + transfer_row.amount_cents
  where id = transfer_row.from_account_id;

  update public.external_transfers
  set
    status = 'failed',
    completed_at = completion_ts,
    failure_reason = reason_text
  where id = transfer_row.id;

  update public.transactions
  set
    status = 'failed',
    posted_at = null
  where external_transfer_id = transfer_row.id;

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
