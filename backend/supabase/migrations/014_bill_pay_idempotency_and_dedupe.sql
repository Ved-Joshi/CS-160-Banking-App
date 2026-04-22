create table if not exists public.payment_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null,
  idempotency_key text not null,
  request_hash text not null,
  status text not null default 'in_progress',
  response_body jsonb,
  response_status integer,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_idempotency_status check (status in ('in_progress', 'completed'))
);

create unique index if not exists payment_idempotency_unique_idx
  on public.payment_idempotency_keys (user_id, endpoint, idempotency_key);

create index if not exists payment_idempotency_expires_idx
  on public.payment_idempotency_keys (expires_at);

create trigger payment_idempotency_set_updated_at
before update on public.payment_idempotency_keys
for each row execute function public.set_updated_at();

alter table public.notifications
  add column if not exists bill_payment_id uuid references public.bill_payments (id) on delete set null;

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_key_unique_idx
  on public.notifications (dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_bill_payment_idx
  on public.notifications (bill_payment_id, created_at desc);

alter table public.payment_idempotency_keys enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'payment_idempotency_keys'
      and policyname = 'payment_idempotency_own'
  ) then
    create policy payment_idempotency_own
    on public.payment_idempotency_keys for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end;
$$;
