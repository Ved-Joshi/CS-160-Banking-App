-- Remove SSN/TIN storage from customer_private.
-- Keep the table for future private attributes that do not store tax identifiers.

alter table if exists public.customer_private
  drop constraint if exists customer_private_last4_format;

alter table if exists public.customer_private
  drop column if exists tax_identifier_ciphertext,
  drop column if exists tax_identifier_last4,
  drop column if exists encryption_key_version;
