-- Security hardening: enforce RLS consistently and prevent owner bypass.

alter table if exists public.profiles enable row level security;
alter table if exists public.customer_private enable row level security;
alter table if exists public.accounts enable row level security;
alter table if exists public.ledger_accounts enable row level security;
alter table if exists public.ledger_journals enable row level security;
alter table if exists public.ledger_postings enable row level security;
alter table if exists public.transactions enable row level security;
alter table if exists public.transfers enable row level security;
alter table if exists public.transfer_plans enable row level security;
alter table if exists public.member_transfer_plans enable row level security;
alter table if exists public.member_transfers enable row level security;
alter table if exists public.external_accounts enable row level security;
alter table if exists public.external_transfer_plans enable row level security;
alter table if exists public.external_transfers enable row level security;
alter table if exists public.payees enable row level security;
alter table if exists public.bill_payments enable row level security;
alter table if exists public.deposits enable row level security;
alter table if exists public.notifications enable row level security;
alter table if exists public.payment_idempotency_keys enable row level security;
alter table if exists public.deposit_upload_sessions enable row level security;
alter table if exists public.atm_locations enable row level security;
do $$
begin
  begin
    alter table if exists storage.objects enable row level security;
  exception
    when insufficient_privilege then
      raise notice 'Skipping RLS enable on storage.objects: insufficient privilege.';
  end;
end;
$$;

alter table if exists public.profiles force row level security;
alter table if exists public.customer_private force row level security;
alter table if exists public.accounts force row level security;
alter table if exists public.ledger_accounts force row level security;
alter table if exists public.ledger_journals force row level security;
alter table if exists public.ledger_postings force row level security;
alter table if exists public.transactions force row level security;
alter table if exists public.transfers force row level security;
alter table if exists public.transfer_plans force row level security;
alter table if exists public.member_transfer_plans force row level security;
alter table if exists public.member_transfers force row level security;
alter table if exists public.external_accounts force row level security;
alter table if exists public.external_transfer_plans force row level security;
alter table if exists public.external_transfers force row level security;
alter table if exists public.payees force row level security;
alter table if exists public.bill_payments force row level security;
alter table if exists public.deposits force row level security;
alter table if exists public.notifications force row level security;
alter table if exists public.payment_idempotency_keys force row level security;
alter table if exists public.deposit_upload_sessions force row level security;
alter table if exists public.atm_locations force row level security;
do $$
begin
  begin
    alter table if exists storage.objects force row level security;
  exception
    when insufficient_privilege then
      raise notice 'Skipping FORCE RLS on storage.objects: insufficient privilege.';
  end;
end;
$$;
