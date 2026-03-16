-- Seed bank-owned ledger accounts (run after 001_init.sql)

insert into public.ledger_accounts (
  owner_type,
  owner_user_id,
  product_account_id,
  ledger_code,
  name,
  account_class,
  normal_balance,
  currency,
  is_active
) values
  ('bank', null, null, 'BANK_VAULT_CASH', 'Bank Vault Cash', 'asset', 'debit', 'USD', true),
  ('bank', null, null, 'CUSTOMER_DEPOSIT_LIAB', 'Customer Deposit Liability', 'liability', 'credit', 'USD', true),
  ('bank', null, null, 'TRANSFER_CLEARING', 'Internal Transfer Clearing', 'asset', 'debit', 'USD', true),
  ('bank', null, null, 'EXT_PAYMENT_SETTLE', 'External Payment Settlement', 'asset', 'debit', 'USD', true),
  ('bank', null, null, 'DEPOSIT_CLEARING', 'Deposit Clearing', 'asset', 'debit', 'USD', true),
  ('bank', null, null, 'FEE_INCOME', 'Fee Income', 'revenue', 'credit', 'USD', true),
  ('bank', null, null, 'INTEREST_EXPENSE', 'Interest Expense', 'expense', 'debit', 'USD', true)
on conflict do nothing;
