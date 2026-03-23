import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Card, DataTable, EmptyState, Field, InlineAlert, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, transactionsService } from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';

const createAccountSchema = z.object({
  nickname: z.string().min(2, 'Nickname must be at least 2 characters.').max(80),
  type: z.enum(['Checking', 'Savings', 'Credit']),
});

export function AccountsPage() {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsService.list });
  const createAccount = useMutation({
    mutationFn: accountsService.create,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
  const form = useForm<z.infer<typeof createAccountSchema>>({
    resolver: zodResolver(createAccountSchema),
    defaultValues: {
      nickname: '',
      type: 'Checking',
    },
  });

  return (
    <div className="stack-xl">
      <PageHeader
        title="Accounts"
        eyebrow="Balances and details"
        subtitle="Review current balances and open additional banking products for your profile."
      />
      {!accounts.length ? (
        <EmptyState
          title="No accounts yet"
          description="You do not have any linked banking products yet. Open your first account below and it will appear here immediately."
        />
      ) : null}
      <div className="grid-two">
        <Card>
          <form
            className="stack-lg"
            onSubmit={form.handleSubmit(async (values) => {
              await createAccount.mutateAsync(values);
              form.reset({ nickname: '', type: values.type });
            })}
          >
            <h3>Open a new account</h3>
            {createAccount.error ? (
              <InlineAlert title="Unable to open account" tone="warning">
                {createAccount.error instanceof Error ? createAccount.error.message : 'Something went wrong.'}
              </InlineAlert>
            ) : null}
            {createAccount.data ? (
              <InlineAlert title="Account created" tone="success">
                {createAccount.data.nickname} is now available in your account list.
              </InlineAlert>
            ) : null}
            <Field label="Account nickname" error={form.formState.errors.nickname?.message}>
              <input {...form.register('nickname')} placeholder="Everyday Checking" />
            </Field>
            <Field label="Account type" error={form.formState.errors.type?.message}>
              <select {...form.register('type')}>
                <option value="Checking">Checking</option>
                <option value="Savings">Savings</option>
                <option value="Credit">Credit</option>
              </select>
            </Field>
            <Button disabled={createAccount.isPending} type="submit">
              {createAccount.isPending ? 'Opening account...' : 'Open account'}
            </Button>
          </form>
        </Card>
        <Card>
          <h3>Account setup details</h3>
          <div className="stack-md">
            <p className="muted">New accounts start with a zero balance and become available immediately in the dashboard, transfers, deposits, and bill pay flows.</p>
            <p className="muted">Checking and savings accounts receive the standard routing number used in the current demo environment. Credit accounts appear without a routing number.</p>
          </div>
        </Card>
      </div>
      <div className="grid-three">
        {accounts.map((account) => (
          <Card key={account.id}>
            <p className="eyebrow">{account.type}</p>
            <h3>{account.nickname}</h3>
            <p className="muted">{account.maskedNumber}</p>
            <dl className="stat-list">
              <div>
                <dt>Available</dt>
                <dd>{formatCurrency(account.balances.availableBalance)}</dd>
              </div>
              <div>
                <dt>Current</dt>
                <dd>{formatCurrency(account.balances.currentBalance)}</dd>
              </div>
            </dl>
            <div className="account-card__footer">
              <StatusChip status={account.status} />
              <Link className="text-link account-card__link" to={`/app/accounts/${account.id}`}>
                View activity
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function AccountDetailPage() {
  const { accountId = '' } = useParams();
  const { data: account } = useQuery({ queryKey: ['accounts', accountId], queryFn: () => accountsService.get(accountId) });
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: transactionsService.list });

  if (!account) {
    return <EmptyState title="Account not found" description="Choose another account from the account summary page." />;
  }

  const rows = transactions
    .filter((transaction) => transaction.accountId === account.id)
    .map((transaction) => [
      formatDate(transaction.postedAt),
      transaction.description,
      transaction.type,
      <StatusChip key={`${transaction.id}-status`} status={transaction.status} />,
      `${transaction.direction === 'credit' ? '+' : '-'}${formatCurrency(transaction.amount)}`,
    ]);

  return (
    <div className="stack-xl">
      <PageHeader
        title={account.nickname}
        eyebrow={`${account.type} account`}
        subtitle={`${account.maskedNumber} • Routing ${account.routingNumber}`}
        actions={<Link className="button button--primary" to="/app/transfers">Transfer funds</Link>}
      />
      <div className="grid-two">
        <Card>
          <h3>Balance summary</h3>
          <dl className="stat-list">
            <div>
              <dt>Available balance</dt>
              <dd>{formatCurrency(account.balances.availableBalance)}</dd>
            </div>
            <div>
              <dt>Current balance</dt>
              <dd>{formatCurrency(account.balances.currentBalance)}</dd>
            </div>
            <div>
              <dt>Opened</dt>
              <dd>{formatDate(account.openedAt)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><StatusChip status={account.status} /></dd>
            </div>
          </dl>
        </Card>
        <Card>
          <h3>Account options</h3>
          <div className="stack-md">
            <p className="muted">Close account remains unavailable until the balance is zero and all pending activity clears.</p>
            <button className="button button--secondary" disabled type="button">
              Close account
            </button>
            <Link className="text-link" to="/app/bill-pay">
              Set up bill pay
            </Link>
            <Link className="text-link" to="/app/transactions">
              View statements and activity
            </Link>
          </div>
        </Card>
      </div>
      <Card>
        <h3>Recent activity</h3>
        <DataTable headers={['Date', 'Description', 'Type', 'Status', 'Amount']} rows={rows} />
      </Card>
    </div>
  );
}
