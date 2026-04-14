-- Relax profiles phone constraint to accept normalized E.164 digits

alter table public.profiles
  drop constraint if exists profiles_phone_format;

alter table public.profiles
  add constraint profiles_phone_format
  check (mobile_phone_e164 ~ '^\\+[0-9]{10,15}$');
