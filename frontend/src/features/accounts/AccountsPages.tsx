import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Card, DataTable, EmptyState, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, transactionsService } from '../../lib/mockApi';
import { formatCurrency, formatDate } from '../../lib/format';

export function AccountsPage() {
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsService.list });

  return (
    <div className="stack-xl">
      <PageHeader title="Accounts" eyebrow="Balances and details" subtitle="Review current and available balances across your linked products." />
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
