-- Supabase schema for banking MVP (tables, constraints, RLS, and storage bucket)

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- Helper function for updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Core identity and profile tables
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext not null,
  username citext not null,
  first_name text not null,
  last_name text not null,
  mobile_phone_e164 text not null,
  street_address text not null,
  apartment_unit text,
  city text not null,
  state text not null,
  zip_code text not null,
  date_of_birth date not null,
  onboarding_status text not null default 'mfa_pending',
  mfa_required boolean not null default true,
  mfa_enrolled_at timestamptz,
  phone_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_unique unique (username),
  constraint profiles_mobile_unique unique (mobile_phone_e164),
  constraint profiles_email_lower check (email = lower(email)),
  constraint profiles_username_lower check (username = lower(username)),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,32}$'),
  constraint profiles_phone_format check (
    regexp_replace(mobile_phone_e164, '\\D', '', 'g') ~ '^[0-9]{10,15}$'
  ),
  constraint profiles_zip_format check (zip_code ~ '^[0-9]{5}(-[0-9]{4})?$'),
  constraint profiles_state_format check (
    state in (
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
      'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
      'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
    )
  ),
  constraint profiles_dob_min_age check (date_of_birth <= (current_date - interval '18 years')),
  constraint profiles_onboarding_status check (onboarding_status in ('mfa_pending', 'active', 'disabled'))
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.customer_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tax_identifier_ciphertext text not null,
  tax_identifier_last4 text not null,
  encryption_key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_private_last4_format check (tax_identifier_last4 ~ '^[0-9]{4}$')
);

create trigger customer_private_set_updated_at
before update on public.customer_private
for each row execute function public.set_updated_at();

-- Banking and activity tables
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  nickname text,
  account_type text not null,
  account_last4 text,
  routing_number text,
  status text not null default 'open',
  available_balance_cents bigint not null default 0,
  current_balance_cents bigint not null default 0,
  opened_at timestamptz not null default now(),
  close_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_account_type check (account_type in ('checking', 'savings', 'credit')),
  constraint accounts_status check (status in ('open', 'frozen', 'closed')),
  constraint accounts_last4 check (account_last4 is null or char_length(account_last4) = 4),
  constraint accounts_routing_format check (routing_number is null or routing_number ~ '^[0-9]{9}$')
);

create index if not exists accounts_user_id_idx on public.accounts (user_id);

create trigger accounts_set_updated_at
before update on public.accounts
for each row execute function public.set_updated_at();

create table if not exists public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null,
  owner_user_id uuid references public.profiles (id) on delete set null,
  product_account_id uuid references public.accounts (id) on delete set null,
  ledger_code text not null,
  name text not null,
  account_class text not null,
  normal_balance text not null,
  currency text not null default 'USD',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_accounts_ledger_code_unique unique (ledger_code),
  constraint ledger_accounts_owner_type check (owner_type in ('customer', 'bank', 'external')),
  constraint ledger_accounts_class check (account_class in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  constraint ledger_accounts_normal_balance check (normal_balance in ('debit', 'credit'))
);

create index if not exists ledger_accounts_owner_user_idx on public.ledger_accounts (owner_user_id);
create index if not exists ledger_accounts_product_account_idx on public.ledger_accounts (product_account_id);

create trigger ledger_accounts_set_updated_at
before update on public.ledger_accounts
for each row execute function public.set_updated_at();

create table if not exists public.ledger_journals (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  reference_type text,
  reference_id uuid,
  description text,
  effective_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ledger_journals_reference_idx on public.ledger_journals (reference_type, reference_id);

create trigger ledger_journals_set_updated_at
before update on public.ledger_journals
for each row execute function public.set_updated_at();

create table if not exists public.ledger_postings (
  id uuid primary key default gen_random_uuid(),
  journal_id uuid not null references public.ledger_journals (id) on delete cascade,
  ledger_account_id uuid not null references public.ledger_accounts (id) on delete restrict,
  amount_cents bigint not null,
  entry_side text not null,
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ledger_postings_amount_nonzero check (amount_cents <> 0),
  constraint ledger_postings_entry_side check (entry_side in ('debit', 'credit'))
);

create index if not exists ledger_postings_journal_idx on public.ledger_postings (journal_id);
create index if not exists ledger_postings_ledger_account_idx on public.ledger_postings (ledger_account_id);

create trigger ledger_postings_set_updated_at
before update on public.ledger_postings
for each row execute function public.set_updated_at();

create or replace function public.enforce_ledger_balance()
returns trigger
language plpgsql
as $$
declare
  target_journal uuid;
  debit_total bigint;
  credit_total bigint;
  posting_count integer;
begin
  if tg_op = 'DELETE' then
    target_journal = old.journal_id;
  else
    target_journal = new.journal_id;
  end if;

  select
    coalesce(sum(case when entry_side = 'debit' then amount_cents else 0 end), 0),
    coalesce(sum(case when entry_side = 'credit' then amount_cents else 0 end), 0),
    count(*)
  into debit_total, credit_total, posting_count
  from public.ledger_postings
  where journal_id = target_journal;

  if posting_count < 2 then
    raise exception 'Ledger journal % must have at least two postings', target_journal;
  end if;

  if debit_total <> credit_total then
    raise exception 'Ledger journal % is unbalanced: debits %, credits %', target_journal, debit_total, credit_total;
  end if;

  return null;
end;
$$;

create constraint trigger ledger_postings_balance_check
after insert or update or delete on public.ledger_postings
deferrable initially deferred
for each row execute function public.enforce_ledger_balance();

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete restrict,
  to_account_id uuid not null references public.accounts (id) on delete restrict,
  amount_cents bigint not null,
  memo text,
  transfer_date date not null,
  status text not null,
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transfers_amount_positive check (amount_cents > 0),
  constraint transfers_status check (status in ('pending', 'completed', 'failed', 'cancelled'))
);

create index if not exists transfers_user_id_idx on public.transfers (user_id);

create trigger transfers_set_updated_at
before update on public.transfers
for each row execute function public.set_updated_at();

create table if not exists public.payees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  category text,
  account_last4 text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payees_last4 check (account_last4 is null or char_length(account_last4) = 4)
);

create index if not exists payees_user_id_idx on public.payees (user_id);

create trigger payees_set_updated_at
before update on public.payees
for each row execute function public.set_updated_at();

create table if not exists public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  payee_id uuid not null references public.payees (id) on delete restrict,
  account_id uuid not null references public.accounts (id) on delete restrict,
  amount_cents bigint not null,
  cadence text not null,
  deliver_by date not null,
  status text not null,
  next_run_at timestamptz,
  processed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bill_payments_amount_positive check (amount_cents > 0),
  constraint bill_payments_cadence check (cadence in ('once', 'weekly', 'biweekly', 'monthly')),
  constraint bill_payments_status check (status in ('scheduled', 'processing', 'completed', 'failed', 'cancelled'))
);

create index if not exists bill_payments_user_id_idx on public.bill_payments (user_id);

create trigger bill_payments_set_updated_at
before update on public.bill_payments
for each row execute function public.set_updated_at();

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete restrict,
  amount_cents bigint not null,
  status text not null default 'submitted',
  note text,
  front_image_path text,
  back_image_path text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposits_amount_positive check (amount_cents > 0),
  constraint deposits_status check (status in ('submitted', 'under_review', 'approved', 'rejected'))
);

create index if not exists deposits_user_id_idx on public.deposits (user_id);

create trigger deposits_set_updated_at
before update on public.deposits
for each row execute function public.set_updated_at();

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete restrict,
  journal_id uuid not null references public.ledger_journals (id) on delete restrict,
  type text not null,
  direction text not null,
  amount_cents bigint not null,
  description text,
  status text not null,
  posted_at timestamptz,
  transfer_id uuid references public.transfers (id) on delete set null,
  bill_payment_id uuid references public.bill_payments (id) on delete set null,
  deposit_id uuid references public.deposits (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_amount_positive check (amount_cents > 0),
  constraint transactions_type check (type in ('transfer', 'bill_payment', 'deposit', 'fee', 'interest', 'adjustment')),
  constraint transactions_direction check (direction in ('in', 'out')),
  constraint transactions_status check (status in ('pending', 'posted', 'failed', 'reversed'))
);

create index if not exists transactions_user_id_idx on public.transactions (user_id);
create index if not exists transactions_account_id_idx on public.transactions (account_id);
create index if not exists transactions_journal_id_idx on public.transactions (journal_id);

create trigger transactions_set_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_user_id_idx on public.notifications (user_id);

create table if not exists public.atm_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  city text not null,
  state text not null,
  zip_code text not null,
  latitude double precision not null,
  longitude double precision not null,
  features text[] not null default '{}',
  hours_text text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint atm_locations_state_format check (
    state in (
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD',
      'MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC',
      'SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'
    )
  ),
  constraint atm_locations_zip_format check (zip_code ~ '^[0-9]{5}(-[0-9]{4})?$')
);

create trigger atm_locations_set_updated_at
before update on public.atm_locations
for each row execute function public.set_updated_at();

-- Storage bucket for deposit images
insert into storage.buckets (id, name, public)
values ('deposit-check-images', 'deposit-check-images', false)
on conflict (id) do nothing;

-- RLS and policies
alter table public.profiles enable row level security;
alter table public.customer_private enable row level security;
alter table public.accounts enable row level security;
alter table public.ledger_accounts enable row level security;
alter table public.ledger_journals enable row level security;
alter table public.ledger_postings enable row level security;
alter table public.transactions enable row level security;
alter table public.transfers enable row level security;
alter table public.payees enable row level security;
alter table public.bill_payments enable row level security;
alter table public.deposits enable row level security;
alter table public.notifications enable row level security;
alter table public.atm_locations enable row level security;

create policy profiles_select_own
on public.profiles for select
using (auth.uid() = id);

create policy accounts_select_own
on public.accounts for select
using (auth.uid() = user_id);

create policy transactions_select_own
on public.transactions for select
using (auth.uid() = user_id);

create policy transfers_own
on public.transfers for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy payees_own
on public.payees for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy bill_payments_own
on public.bill_payments for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy deposits_own
on public.deposits for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy notifications_own
on public.notifications for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy atm_locations_read_all
on public.atm_locations for select
using (true);

-- Storage policies for deposit images
alter table storage.objects enable row level security;

create policy deposit_images_select_own
on storage.objects for select
using (
  bucket_id = 'deposit-check-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy deposit_images_insert_own
on storage.objects for insert
with check (
  bucket_id = 'deposit-check-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy deposit_images_update_own
on storage.objects for update
using (
  bucket_id = 'deposit-check-images'
  and auth.uid()::text = split_part(name, '/', 1)
)
with check (
  bucket_id = 'deposit-check-images'
  and auth.uid()::text = split_part(name, '/', 1)
);

create policy deposit_images_delete_own
on storage.objects for delete
using (
  bucket_id = 'deposit-check-images'
  and auth.uid()::text = split_part(name, '/', 1)
);
