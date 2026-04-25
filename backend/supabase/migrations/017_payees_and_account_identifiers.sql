begin;

alter table public.accounts
  add column if not exists account_number text;

alter table public.payees
  add column if not exists routing_number text,
  add column if not exists account_number text;

-- Generate valid ABA routing numbers and account numbers for existing accounts.
create or replace function public._generate_routing_number() returns text
language plpgsql
as $$
declare
  prefix text;
  checksum int;
  check_digit int;
begin
  prefix := lpad(floor(random() * 100000000)::bigint::text, 8, '0');
  checksum :=
    3 * ((substr(prefix, 1, 1))::int + (substr(prefix, 4, 1))::int + (substr(prefix, 7, 1))::int)
    + 7 * ((substr(prefix, 2, 1))::int + (substr(prefix, 5, 1))::int + (substr(prefix, 8, 1))::int)
    + (substr(prefix, 3, 1))::int + (substr(prefix, 6, 1))::int;
  check_digit := (10 - (checksum % 10)) % 10;
  return prefix || check_digit::text;
end;
$$;

create or replace function public._generate_account_number(p_length int default 12) returns text
language plpgsql
as $$
begin
  return lpad(floor(random() * power(10::numeric, p_length))::numeric::text, p_length, '0');
end;
$$;

do $$
declare
  account_row record;
  candidate_routing text;
  candidate_account text;
  needs_refresh boolean;
begin
  for account_row in
    select id, routing_number, account_number
    from public.accounts
  loop
    needs_refresh :=
      account_row.routing_number is null
      or account_row.routing_number !~ '^[0-9]{9}$'
      or (
        (
          3 * ((substr(account_row.routing_number, 1, 1))::int + (substr(account_row.routing_number, 4, 1))::int + (substr(account_row.routing_number, 7, 1))::int)
          + 7 * ((substr(account_row.routing_number, 2, 1))::int + (substr(account_row.routing_number, 5, 1))::int + (substr(account_row.routing_number, 8, 1))::int)
          + (substr(account_row.routing_number, 3, 1))::int + (substr(account_row.routing_number, 6, 1))::int
        ) % 10
      ) <> 0
      or account_row.account_number is null
      or account_row.account_number !~ '^[0-9]{4,17}$'
      or exists (
        select 1
        from public.accounts duplicate
        where duplicate.id <> account_row.id
          and (
            duplicate.routing_number = account_row.routing_number
            or duplicate.account_number = account_row.account_number
          )
      );

    if needs_refresh then
      loop
        candidate_routing := public._generate_routing_number();
        candidate_account := public._generate_account_number(12);
        if candidate_routing = candidate_account then
          continue;
        end if;
        exit when not exists (
          select 1
          from public.accounts existing
          where existing.id <> account_row.id
            and (
              existing.routing_number = candidate_routing
              or existing.account_number = candidate_account
            )
        );
      end loop;

      update public.accounts
      set
        routing_number = candidate_routing,
        account_number = candidate_account,
        account_last4 = right(candidate_account, 4)
      where id = account_row.id;
    else
      update public.accounts
      set account_last4 = right(account_row.account_number, 4)
      where id = account_row.id
        and (
          account_last4 is null
          or account_last4 <> right(account_row.account_number, 4)
        );
    end if;
  end loop;

  update public.payees
  set account_last4 = right(account_number, 4)
  where account_number is not null
    and (
      account_last4 is null
      or account_last4 <> right(account_number, 4)
    );
end;
$$;

drop function if exists public._generate_routing_number();
drop function if exists public._generate_account_number(int);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'accounts_account_number_format') then
    alter table public.accounts
      add constraint accounts_account_number_format
      check (account_number is null or account_number ~ '^[0-9]{4,17}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'accounts_routing_checksum') then
    alter table public.accounts
      add constraint accounts_routing_checksum
      check (
        routing_number is null
        or (
          (3 * ((substr(routing_number, 1, 1))::int + (substr(routing_number, 4, 1))::int + (substr(routing_number, 7, 1))::int)
          + 7 * ((substr(routing_number, 2, 1))::int + (substr(routing_number, 5, 1))::int + (substr(routing_number, 8, 1))::int)
          + (substr(routing_number, 3, 1))::int + (substr(routing_number, 6, 1))::int) % 10 = 0
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payees_routing_format') then
    alter table public.payees
      add constraint payees_routing_format
      check (routing_number is null or routing_number ~ '^[0-9]{9}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payees_routing_checksum') then
    alter table public.payees
      add constraint payees_routing_checksum
      check (
        routing_number is null
        or (
          (3 * ((substr(routing_number, 1, 1))::int + (substr(routing_number, 4, 1))::int + (substr(routing_number, 7, 1))::int)
          + 7 * ((substr(routing_number, 2, 1))::int + (substr(routing_number, 5, 1))::int + (substr(routing_number, 8, 1))::int)
          + (substr(routing_number, 3, 1))::int + (substr(routing_number, 6, 1))::int) % 10 = 0
        )
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'payees_account_number_format') then
    alter table public.payees
      add constraint payees_account_number_format
      check (account_number is null or account_number ~ '^[0-9]{4,17}$');
  end if;
end;
$$;

create unique index if not exists accounts_routing_number_unique_idx
  on public.accounts (routing_number)
  where routing_number is not null;

create unique index if not exists accounts_account_number_unique_idx
  on public.accounts (account_number)
  where account_number is not null;

commit;
