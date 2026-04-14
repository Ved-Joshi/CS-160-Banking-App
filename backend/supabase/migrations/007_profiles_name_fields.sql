alter table public.profiles
  add column if not exists middle_name text;

alter table public.profiles
  drop constraint if exists profiles_username_unique;

alter table public.profiles
  drop constraint if exists profiles_username_lower;

alter table public.profiles
  drop constraint if exists profiles_username_format;

alter table public.profiles
  drop column if exists username;
