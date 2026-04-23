begin;

alter table public.external_accounts
  add column if not exists provider text,
  add column if not exists provider_customer_id text,
  add column if not exists provider_account_id text;

update public.external_accounts
set provider = coalesce(provider, 'local')
where provider is null;

alter table public.external_accounts
  alter column provider set default 'local';

alter table public.external_accounts
  alter column provider set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'external_accounts_provider_check') then
    alter table public.external_accounts
      add constraint external_accounts_provider_check
      check (provider in ('local', 'stripe_sandbox'));
  end if;
end;
$$;

create unique index if not exists external_accounts_provider_account_unique_idx
  on public.external_accounts (provider, provider_account_id)
  where provider_account_id is not null;

commit;
