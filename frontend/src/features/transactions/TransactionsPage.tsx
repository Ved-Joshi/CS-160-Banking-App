import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Card, DataTable, EmptyState, Field, PageHeader } from '../../components/ui';
import { accountsService, transactionsService } from '../../lib/bankingApi';
import { formatCurrency, formatDate, formatDateTime, formatTime } from '../../lib/format';
import { queryKeys } from '../../lib/queryKeys';
import type { Transaction } from '../../types/banking';

const TRANSACTIONS_PER_PAGE = 20;

function channelForTransaction(transaction: Transaction): string {
  const description = transaction.description.toLowerCase();
  if (transaction.type === 'Bill Pay') return 'Bill Pay';
  if (transaction.type === 'ATM') return 'ATM';
  if (transaction.type === 'Deposit') return 'Deposit';
  if (transaction.type === 'Interest') return 'Interest';
  if (description.includes('external transfer')) return 'External transfer';
  if (description.includes('member transfer')) return 'Member transfer';
  if (description.includes('internal transfer')) return 'Internal transfer';
  return transaction.type;
}

function counterpartyForTransaction(transaction: Transaction, accountNameById: Map<string, string>): string {
  const description = transaction.description.trim();
  const channel = channelForTransaction(transaction);
  if (channel === 'Internal transfer') {
    return 'Your other account';
  }
  if (channel === 'Member transfer') {
    return 'SJ State Bank member';
  }
  if (channel === 'External transfer') {
    return 'External bank account';
  }
  if (channel === 'Bill Pay') {
    return description || 'Payee';
  }
  if (channel === 'ATM') {
    return 'ATM network';
  }
  if (channel === 'Deposit') {
    return description || 'Deposit source';
  }
  return accountNameById.get(transaction.accountId) ?? '—';
}

function csvEscape(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

function formatFileTimestamp(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function TransactionsPage() {
  const [searchParams] = useSearchParams();
  const { data: accounts = [] } = useQuery({ queryKey: queryKeys.accounts(), queryFn: accountsService.list });
  const { data: transactions = [] } = useQuery({ queryKey: queryKeys.transactions(), queryFn: transactionsService.list });
  const requestedAccountId = searchParams.get('accountId') ?? 'all';
  const derivedAccountId = requestedAccountId === 'all' || accounts.some((account) => account.id === requestedAccountId)
    ? requestedAccountId
    : 'all';
  const [accountIdOverride, setAccountIdOverride] = useState('');
  const accountId = accountIdOverride || derivedAccountId;
  const [type, setType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const hasActiveFilters = accountId !== 'all' || type !== 'all' || Boolean(searchQuery.trim());

  const accountNameById = useMemo(() => new Map(accounts.map((account) => [account.id, account.nickname])), [accounts]);

  const transactionsWithMetadata = useMemo(
    () =>
      transactions.map((transaction) => ({
        ...transaction,
        channel: channelForTransaction(transaction),
        counterparty: counterpartyForTransaction(transaction, accountNameById),
      })),
    [accountNameById, transactions],
  );

  const filtered = useMemo(
    () =>
      transactionsWithMetadata.filter((transaction) => {
        const normalizedSearch = searchQuery.trim().toLowerCase();
        const matchesSearch = !normalizedSearch
          || transaction.description.toLowerCase().includes(normalizedSearch)
          || transaction.counterparty.toLowerCase().includes(normalizedSearch);
        return (
          (accountId === 'all' || transaction.accountId === accountId) &&
          (type === 'all' || transaction.type === type) &&
          matchesSearch
        );
      }),
    [accountId, searchQuery, transactionsWithMetadata, type],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / TRANSACTIONS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);

  const pagedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * TRANSACTIONS_PER_PAGE;
    const endIndex = startIndex + TRANSACTIONS_PER_PAGE;
    return filtered.slice(startIndex, endIndex);
  }, [currentPage, filtered]);

  const rows = pagedTransactions.map((transaction) => [
    formatDate(transaction.postedAt),
    formatTime(transaction.postedAt),
    transaction.description,
    transaction.counterparty,
    transaction.channel,
    `${transaction.direction === 'credit' ? '+' : '-'}${formatCurrency(transaction.amount)}`,
  ]);

  const handleExportCsv = () => {
    if (!filtered.length || typeof window === 'undefined' || typeof document === 'undefined') return;

    const headers = [
      'posted_at',
      'description',
      'counterparty',
      'type',
      'direction',
      'amount_usd',
      'account_name',
    ];
    const dataRows = filtered.map((transaction) => {
      return [
        formatDateTime(transaction.postedAt),
        transaction.description,
        transaction.counterparty,
        transaction.channel,
        transaction.direction,
        transaction.amount.toFixed(2),
        accountNameById.get(transaction.accountId) ?? '',
      ];
    });

    const csv = [headers, ...dataRows]
      .map((line) => line.map((cell) => csvEscape(String(cell))).join(','))
      .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    const suffix = hasActiveFilters ? 'filtered' : 'all';
    link.download = `sj-state-bank-transactions-${suffix}-${formatFileTimestamp(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);
  };

  return (
    <div className="stack-xl">
      <PageHeader
        title="Transactions"
        eyebrow="Activity history"
        subtitle="Filter and review posted, pending, and failed account activity."
        actions={(
          <button
            className="button button--secondary"
            disabled={!accounts.length || !filtered.length}
            onClick={handleExportCsv}
            type="button"
          >
            {hasActiveFilters ? 'Export filtered CSV' : 'Export CSV'}
          </button>
        )}
      />
      <Card>
        <div className="grid-three">
          <Field label="Account">
            <select
              disabled={!accounts.length}
              value={accountId}
              onChange={(event) => {
                setAccountIdOverride(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.nickname}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              disabled={!accounts.length}
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All types</option>
              <option value="Deposit">Deposit</option>
              <option value="Transfer">Transfer</option>
              <option value="Bill Pay">Bill Pay</option>
              <option value="ATM">ATM</option>
            </select>
          </Field>
          <Field label="Search memo or description">
            <input
              placeholder="Search transactions..."
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setPage(1);
              }}
            />
          </Field>
        </div>
      </Card>
      <Card>
        {filtered.length ? (
          <div className="stack-md">
            <DataTable headers={['Date', 'Time', 'Description', 'Counterparty', 'Type', 'Amount']} rows={rows} />
            <div className="transactions-pagination">
              <p className="muted">
                Showing {(currentPage - 1) * TRANSACTIONS_PER_PAGE + 1}-{Math.min(currentPage * TRANSACTIONS_PER_PAGE, filtered.length)} of {filtered.length}
              </p>
              <div className="transactions-pagination__controls">
                <button
                  className="button button--ghost pagination-button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  Previous
                </button>
                <span className="muted">Page {currentPage} of {totalPages}</span>
                <button
                  className="button button--ghost pagination-button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                  type="button"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
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
