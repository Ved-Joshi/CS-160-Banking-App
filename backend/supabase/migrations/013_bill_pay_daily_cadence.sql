alter table public.bill_payments
  drop constraint if exists bill_payments_cadence;

alter table public.bill_payments
  add constraint bill_payments_cadence
  check (cadence in ('once', 'daily', 'weekly', 'biweekly', 'monthly'));
