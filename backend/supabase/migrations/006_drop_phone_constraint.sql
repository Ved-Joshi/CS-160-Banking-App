-- Drop phone constraint to unblock registration (validated in edge function)

alter table public.profiles
  drop constraint if exists profiles_phone_format;
