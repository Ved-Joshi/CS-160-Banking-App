create or replace function public.close_customer_account(
  p_user_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.accounts%rowtype;
  close_reasons text[] := array[]::text[];
begin
  perform 1
  from public.accounts
  where id = p_account_id
    and user_id = p_user_id
  for update;

  select *
  into account_row
  from public.accounts
  where id = p_account_id
    and user_id = p_user_id;

  if account_row.id is null then
    return jsonb_build_object(
      'closed', false,
      'status', 404,
      'reasons', array['Account not found.']
    );
  end if;

  if account_row.status <> 'open' then
    close_reasons := array_append(close_reasons, 'Only open accounts can be closed.');
  end if;

  if account_row.available_balance_cents <> 0 or account_row.current_balance_cents <> 0 then
    close_reasons := array_append(close_reasons, 'Available and current balances must both be $0.00.');
  end if;

  if exists(
    select 1
    from public.transactions
    where user_id = p_user_id
      and account_id = p_account_id
      and status = 'pending'
  ) then
    close_reasons := array_append(close_reasons, 'Pending transactions must clear before you close this account.');
  end if;

  if exists(
    select 1
    from public.deposits
    where user_id = p_user_id
      and account_id = p_account_id
      and status in ('submitted', 'under_review')
  ) then
    close_reasons := array_append(close_reasons, 'Pending deposits must finish review before you close this account.');
  end if;

  if exists(
    select 1
    from public.bill_payments
    where user_id = p_user_id
      and account_id = p_account_id
      and status in ('scheduled', 'processing')
  ) then
    close_reasons := array_append(close_reasons, 'Scheduled or processing bill payments must be resolved before you close this account.');
  end if;

  if array_length(close_reasons, 1) is not null then
    return jsonb_build_object(
      'closed', false,
      'status', 409,
      'reasons', close_reasons
    );
  end if;

  update public.accounts
  set
    status = 'closed',
    close_eligible = false
  where id = p_account_id
    and user_id = p_user_id
    and status = 'open'
    and available_balance_cents = 0
    and current_balance_cents = 0;

  if not found then
    return jsonb_build_object(
      'closed', false,
      'status', 409,
      'reasons', array['This account is no longer available to close.']
    );
  end if;

  return jsonb_build_object(
    'closed', true,
    'status', 204,
    'reasons', array[]::text[]
  );
end;
$$;

grant execute on function public.close_customer_account(uuid, uuid) to service_role;
