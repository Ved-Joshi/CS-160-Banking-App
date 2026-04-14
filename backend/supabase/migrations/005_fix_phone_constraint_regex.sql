-- Replace phone constraint with digit-count check

alter table public.profiles
  drop constraint if exists profiles_phone_format;

alter table public.profiles
  add constraint profiles_phone_format
  check (regexp_replace(mobile_phone_e164, '\\D', '', 'g') ~ '^[0-9]{10,15}$');
