import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, DataTable, EmptyState, Field, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, depositsService } from '../../lib/bankingApi';
import { formatCurrency, formatDateTime } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';

const depositSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive(),
  depositType: z.enum(['cash', 'check']),
});

function formatAmountDigits(digits: string): string {
  const cleaned = digits.replace(/\D/g, '').slice(0, 12);
  if (!cleaned) return '00.00';
  if (cleaned.length === 1) return `${cleaned}0.00`;
  if (cleaned.length === 2) return `${cleaned}.00`;
  if (cleaned.length === 3) return `${cleaned.slice(0, 2)}.${cleaned.slice(2)}0`;
  const integerPart = cleaned.slice(0, -2).replace(/^0+(?=\d)/, '') || '0';
  const centsPart = cleaned.slice(-2);
  return `${integerPart}.${centsPart}`;
}

export function DepositsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preferredAccountId = searchParams.get('accountId') ?? '';
  const [amountDigits, setAmountDigits] = useState('');
  const { data: deposits = [] } = useQuery({ queryKey: queryKeys.deposits(), queryFn: depositsService.list });
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });
  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof depositSchema>) => depositsService.create(values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.deposits() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.accounts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.transactions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications() }),
      ]);
    },
  });
  const form = useForm<z.infer<typeof depositSchema>>({
    resolver: zodResolver(depositSchema),
    defaultValues: {
      accountId: '',
      amount: 0,
      depositType: 'check',
    },
  });
  const hasAccounts = accounts.length > 0;
  const amountDisplay = formatAmountDigits(amountDigits);
  const amountInputValue = `$${amountDisplay}`;

  useEffect(() => {
    if (!hasAccounts) return;
    const currentAccountId = form.getValues('accountId');
    const requestedAccountId = accounts.some((account) => account.id === preferredAccountId)
      ? preferredAccountId
      : '';
    if (!currentAccountId || !accounts.some((account) => account.id === currentAccountId)) {
      form.setValue('accountId', requestedAccountId || accounts[0]?.id || '');
    }
  }, [accounts, form, hasAccounts, preferredAccountId]);

  useEffect(() => {
    const normalizedAmount = amountDigits ? Number(amountDisplay) : 0;
    form.setValue('amount', normalizedAmount);
  }, [amountDigits, amountDisplay, form]);

  const rows = deposits.map((deposit) => [
    <Link key={`${deposit.id}-link`} className="text-link" to={`/app/deposits/${deposit.id}`}>
      {deposit.id}
    </Link>,
    accounts.find((account) => account.id === deposit.accountId)?.nickname ?? 'Account unavailable',
    deposit.depositType === 'cash' ? 'Cash' : 'Check',
    formatDateTime(deposit.submittedAt),
    formatCurrency(deposit.amount),
    <StatusChip key={`${deposit.id}-status`} status={deposit.status} />,
  ]);

  return (
    <div className="stack-xl">
      <PageHeader title="Deposits" eyebrow="Add funds" subtitle="Choose an account, enter an amount, and submit a cash or check deposit." />
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit(async (values) => {
              if (!hasAccounts) return;
              const created = await mutation.mutateAsync(values);
              navigate(`/app/deposits/${created.id}`);
            })}
          >
            <h3>Make a deposit</h3>
            {mutation.error instanceof Error ? (
              <p className="muted">{mutation.error.message}</p>
            ) : null}
            <Field label="Deposit into" error={form.formState.errors.accountId?.message}>
              <select {...form.register('accountId')} disabled={!hasAccounts}>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.nickname} ({account.maskedNumber})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Deposit type" error={form.formState.errors.depositType?.message}>
              <select {...form.register('depositType')} disabled={!hasAccounts}>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
              </select>
            </Field>
            <Field label="Amount" error={form.formState.errors.amount?.message}>
              <input
                aria-label="Amount"
                disabled={!hasAccounts}
                inputMode="numeric"
                name="amount"
                onFocus={(event) => {
                  event.currentTarget.setSelectionRange(0, event.currentTarget.value.length);
                }}
                onKeyDown={(event) => {
                  if (event.key >= '0' && event.key <= '9') {
                    event.preventDefault();
                    setAmountDigits((prev) => `${prev}${event.key}`.slice(0, 12));
                    return;
                  }
                  if (event.key === 'Backspace') {
                    event.preventDefault();
                    setAmountDigits((prev) => prev.slice(0, -1));
                    return;
                  }
                  if (event.key === 'Delete') {
                    event.preventDefault();
                    setAmountDigits('');
                    return;
                  }
                  const allowedKeys = ['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'];
                  if (allowedKeys.includes(event.key)) return;
                  event.preventDefault();
                }}
                onPaste={(event) => {
                  event.preventDefault();
                  const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 12);
                  setAmountDigits(pasted);
                }}
                type="text"
                value={amountInputValue}
              />
            </Field>
            {!hasAccounts ? (
              <EmptyState
                title="Deposits need an account"
                description="Open an account before submitting a deposit."
                action={<Link className="button button--secondary" to="/app/accounts">Open account</Link>}
              />
            ) : null}
            <Button disabled={!hasAccounts || mutation.isPending} type="submit">
              {mutation.isPending ? 'Submitting deposit...' : 'Submit deposit'}
            </Button>
          </form>
        </Card>
        <Card>
          <h3>Deposit requirements</h3>
          <ol className="plain-list">
            <li>Choose one of your open accounts as the destination.</li>
            <li>Select whether you are depositing cash or a check.</li>
            <li>Enter the exact amount you want to deposit before submitting.</li>
          </ol>
        </Card>
      </div>
      {rows.length ? (
        <Card>
          <h3>Recent deposits</h3>
          <DataTable headers={['Reference', 'Account', 'Type', 'Submitted', 'Amount', 'Status']} rows={rows} />
        </Card>
      ) : (
        <EmptyState
          title="No deposits yet"
          description="Submitted cash and check deposits will appear here once you make one."
        />
      )}
    </div>
  );
}

export function DepositDetailPage() {
  const { depositId = '' } = useParams();
  const { data: deposit } = useQuery({ queryKey: ['deposit', depositId], queryFn: () => depositsService.get(depositId) });
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });

  if (!deposit) {
    return <EmptyState title="Deposit not found" description="The requested deposit could not be located. Please return to your deposit history and try again." />;
  }

  const accountName = accounts.find((account) => account.id === deposit.accountId)?.nickname ?? 'Account unavailable';

  return (
    <div className="stack-xl">
      <PageHeader title={`Deposit ${deposit.id}`} eyebrow="Deposit tracking" subtitle="Review the account, type, amount, and completion status for this deposit." />
      <div className="grid-two">
        <Card>
          <dl className="stat-list">
            <div>
              <dt>Account</dt>
              <dd>{accountName}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{deposit.depositType === 'cash' ? 'Cash' : 'Check'}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>{formatCurrency(deposit.amount)}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{formatDateTime(deposit.submittedAt)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><StatusChip status={deposit.status} /></dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h3>Deposit summary</h3>
          <div className="timeline">
            <div className="timeline__item timeline__item--complete">Deposit submitted</div>
            <div className="timeline__item timeline__item--complete">Account credited</div>
            <div className="timeline__item timeline__item--current">Recorded in history</div>
          </div>
          <p className="muted">{deposit.note}</p>
        </Card>
      </div>
    </div>
  );
}
