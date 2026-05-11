alter table public.profiles
add constraint profiles_dob_floor
check (date_of_birth >= date '1900-01-01') not valid;
