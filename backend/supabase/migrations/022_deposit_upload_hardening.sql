create table if not exists public.deposit_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  front_image_path text not null,
  back_image_path text not null,
  front_content_type text,
  back_content_type text,
  front_size_bytes bigint,
  back_size_bytes bigint,
  status text not null default 'reserved',
  deposit_id uuid references public.deposits (id) on delete set null,
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  consumed_at timestamptz,
  cleaned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deposit_upload_sessions_status_check check (status in ('reserved', 'consumed', 'cleaned'))
);

create unique index if not exists deposit_upload_sessions_user_paths_unique_idx
  on public.deposit_upload_sessions (user_id, front_image_path, back_image_path);

create index if not exists deposit_upload_sessions_status_expires_idx
  on public.deposit_upload_sessions (status, expires_at);

create index if not exists deposit_upload_sessions_user_status_idx
  on public.deposit_upload_sessions (user_id, status, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'deposit_upload_sessions_set_updated_at'
  ) then
    create trigger deposit_upload_sessions_set_updated_at
    before update on public.deposit_upload_sessions
    for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.deposit_upload_sessions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'deposit_upload_sessions'
      and policyname = 'deposit_upload_sessions_own'
  ) then
    create policy deposit_upload_sessions_own
    on public.deposit_upload_sessions for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);
  end if;
end;
$$;
