import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, DataTable, EmptyState, Field, PageHeader, StatusChip } from '../../components/ui';
import { accountsService, transactionsService } from '../../lib/bankingApi';
import { formatCurrency, formatDate } from '../../lib/format';

export function TransactionsPage() {
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: accountsService.list });
  const { data: transactions = [] } = useQuery({ queryKey: ['transactions'], queryFn: transactionsService.list });
  const [accountId, setAccountId] = useState('all');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');

  const filtered = useMemo(
    () =>
      transactions.filter((transaction) => {
        return (
          (accountId === 'all' || transaction.accountId === accountId) &&
          (type === 'all' || transaction.type === type) &&
          (status === 'all' || transaction.status === status)
        );
      }),
    [accountId, status, transactions, type],
  );

  const rows = filtered.map((transaction) => [
    formatDate(transaction.postedAt),
    transaction.description,
    transaction.type,
    <StatusChip key={`${transaction.id}-status`} status={transaction.status} />,
    `${transaction.direction === 'credit' ? '+' : '-'}${formatCurrency(transaction.amount)}`,
  ]);

  return (
    <div className="stack-xl">
      <PageHeader
        title="Transactions"
        eyebrow="Activity history"
        subtitle="Filter and review posted, pending, and failed account activity."
        actions={<button className="button button--secondary" disabled={!accounts.length || !filtered.length} type="button">Export CSV</button>}
      />
      <Card>
        <div className="grid-three">
          <Field label="Account">
            <select disabled={!accounts.length} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.nickname}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select disabled={!accounts.length} value={type} onChange={(event) => setType(event.target.value)}>
              <option value="all">All types</option>
              <option value="Deposit">Deposit</option>
              <option value="Transfer">Transfer</option>
              <option value="Bill Pay">Bill Pay</option>
              <option value="ATM">ATM</option>
            </select>
          </Field>
          <Field label="Status">
            <select disabled={!accounts.length} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="PENDING">Pending</option>
              <option value="FAILED">Failed</option>
            </select>
          </Field>
        </div>
      </Card>
      <Card>
        {filtered.length ? (
          <DataTable headers={['Date', 'Description', 'Type', 'Status', 'Amount']} rows={rows} />
        ) : (
          <EmptyState
            title={accounts.length ? 'No transactions yet' : 'No accounts available'}
            description={
              accounts.length
                ? 'Transaction activity will appear here once your accounts start receiving posted or pending activity.'
                : 'Open an account first. Transactions only appear for accounts that exist in your profile.'
            }
            action={
              !accounts.length ? <Link className="button button--secondary" to="/app/accounts">Open account</Link> : undefined
            }
          />
        )}
      </Card>
    </div>
  );
}
