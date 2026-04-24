create or replace function public.timezone_name_exists(tz text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from pg_timezone_names
    where name = tz
  );
$$;

alter table public.profiles
  add column if not exists timezone text not null default 'America/Los_Angeles';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_timezone_valid'
  ) then
    alter table public.profiles
      add constraint profiles_timezone_valid check (public.timezone_name_exists(timezone));
  end if;
end;
$$;

create table if not exists public.transfer_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid not null references public.accounts (id) on delete restrict,
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
  constraint transfer_plans_amount_positive check (amount_cents > 0),
  constraint transfer_plans_cadence check (cadence in ('once', 'daily', 'weekly', 'biweekly', 'monthly')),
  constraint transfer_plans_status check (status in ('scheduled', 'processing', 'completed', 'cancelled')),
  constraint transfer_plans_timezone_valid check (public.timezone_name_exists(timezone)),
  constraint transfer_plans_date_range check (end_date is null or end_date >= start_date),
  constraint transfer_plans_accounts_distinct check (from_account_id <> to_account_id)
);

create index if not exists transfer_plans_due_idx
  on public.transfer_plans (status, next_run_at);

create index if not exists transfer_plans_user_id_idx
  on public.transfer_plans (user_id, created_at desc);

create trigger transfer_plans_set_updated_at
before update on public.transfer_plans
for each row execute function public.set_updated_at();

alter table public.transfers
  add column if not exists transfer_plan_id uuid references public.transfer_plans (id) on delete set null;

create index if not exists transfers_transfer_plan_id_idx
  on public.transfers (transfer_plan_id);

alter table public.transfer_plans enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'transfer_plans'
      and policyname = 'transfer_plans_own'
  ) then
    create policy transfer_plans_own
    on public.transfer_plans for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end;
$$;
