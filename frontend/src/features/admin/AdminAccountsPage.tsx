import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../../lib/apiClient';
import type { BankAccount } from '../../types/banking';
import { Card, PageHeader, InlineAlert, DataTable, StatusChip } from '../../components/ui';
import { formatCurrency, formatDate } from '../../lib/format';

type SortOption = 'newest' | 'oldest' | 'name' | 'balance-desc' | 'balance-asc';

export function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | BankAccount['type']>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | BankAccount['status']>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest<BankAccount[]>('/api/admin/accounts');
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load accounts.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredAccounts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const matchesSearch = (account: BankAccount) => {
      if (!normalizedSearch) return true;
      return [
        account.nickname,
        account.maskedNumber,
        account.type,
        account.status,
        account.id,
      ].some((field) => field.toLowerCase().includes(normalizedSearch));
    };
    const filtered = accounts.filter((account) => {
      if (!matchesSearch(account)) return false;
      if (typeFilter !== 'all' && account.type !== typeFilter) return false;
      if (statusFilter !== 'all' && account.status !== statusFilter) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'name') return a.nickname.localeCompare(b.nickname);
      if (sortBy === 'balance-desc') return b.balances.currentBalance - a.balances.currentBalance;
      if (sortBy === 'balance-asc') return a.balances.currentBalance - b.balances.currentBalance;
      const aTime = new Date(a.openedAt).getTime();
      const bTime = new Date(b.openedAt).getTime();
      const safeATime = Number.isNaN(aTime) ? 0 : aTime;
      const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
      if (sortBy === 'oldest') return safeATime - safeBTime;
      return safeBTime - safeATime;
    });
  }, [accounts, searchQuery, typeFilter, statusFilter, sortBy]);

  const totals = useMemo(() => {
    const totalCurrentBalance = filteredAccounts.reduce((sum, account) => sum + account.balances.currentBalance, 0);
    const openAccounts = filteredAccounts.filter((account) => account.status === 'Open').length;
    const restrictedAccounts = filteredAccounts.filter((account) => account.status === 'Restricted').length;
    return {
      totalCurrentBalance,
      openAccounts,
      restrictedAccounts,
    };
  }, [filteredAccounts]);

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this account from the active admin list? This closes the account and cannot be undone.')) return;
    setDeletingAccountId(id);
    try {
      await apiRequest(`/api/admin/accounts/${id}`, { method: 'DELETE' });
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete account.');
    } finally {
      setDeletingAccountId(null);
    }
  };

  return (
    <div className="stack-xl" style={{ paddingTop: '1rem' }}>
      <PageHeader
        title="Account Directory"
        eyebrow="Admin panel"
        subtitle="Review every created account, filter quickly, and take action when needed."
        actions={(
          <div className="button-row" style={{ justifyContent: 'flex-end' }}>
            <Link className="button button--secondary" to="/admin">Back to panel</Link>
            <Link className="button button--secondary" to="/admin/reports">Reporting dashboard</Link>
            <button className="button button--primary" type="button" onClick={() => { void load(); }}>
              Refresh
            </button>
          </div>
        )}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          margin: '0 auto',
          width: '100%',
        }}
      />
      {error ? <InlineAlert title="Error" tone="warning">{error}</InlineAlert> : null}
      <Card>
        <div className="stack-md">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
              gap: '0.8rem',
            }}
          >
            <label className="field">
              <span>Search accounts</span>
              <input
                placeholder="Nickname, number, id, status..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
                <option value="all">All types</option>
                <option value="Checking">Checking</option>
                <option value="Savings">Savings</option>
                <option value="Credit">Credit</option>
              </select>
            </label>
            <label className="field">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
                <option value="all">All statuses</option>
                <option value="Open">Open</option>
                <option value="Restricted">Restricted</option>
              </select>
            </label>
            <label className="field">
              <span>Sort</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortOption)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name (A-Z)</option>
                <option value="balance-desc">Highest balance</option>
                <option value="balance-asc">Lowest balance</option>
              </select>
            </label>
          </div>
          <p className="muted">
            Showing {filteredAccounts.length} of {accounts.length} accounts
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
              gap: '0.8rem',
            }}
          >
            <div className="card" style={{ padding: '0.85rem 1rem' }}>
              <p className="eyebrow">Visible total</p>
              <h3>{formatCurrency(totals.totalCurrentBalance)}</h3>
            </div>
            <div className="card" style={{ padding: '0.85rem 1rem' }}>
              <p className="eyebrow">Open</p>
              <h3>{totals.openAccounts}</h3>
            </div>
            <div className="card" style={{ padding: '0.85rem 1rem' }}>
              <p className="eyebrow">Restricted</p>
              <h3>{totals.restrictedAccounts}</h3>
            </div>
            <div className="card" style={{ padding: '0.85rem 1rem' }}>
              <p className="eyebrow">Average balance</p>
              <h3>{formatCurrency(filteredAccounts.length ? totals.totalCurrentBalance / filteredAccounts.length : 0)}</h3>
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <div className="stack-md">
          {loading ? <p>Loading...</p> : null}
          {!loading && accounts.length === 0 ? <p className="muted">No accounts found.</p> : null}
          {!loading && accounts.length > 0 && filteredAccounts.length === 0 ? (
            <p className="muted">No accounts match your current filters.</p>
          ) : null}
          {!loading && filteredAccounts.length > 0 ? (
            <DataTable
              headers={['Account', 'Type', 'Status', 'Opened', 'Current balance', 'Available', 'Actions']}
              rows={filteredAccounts.map((acct) => ([
                <div className="stack-sm" key={`${acct.id}-account`}>
                  <strong>{acct.nickname}</strong>
                  <span className="muted">{acct.maskedNumber} · {acct.id.slice(0, 8)}</span>
                </div>,
                acct.type,
                <StatusChip key={`${acct.id}-status`} status={acct.status} />,
                formatDate(acct.openedAt),
                formatCurrency(acct.balances.currentBalance),
                formatCurrency(acct.balances.availableBalance),
                <button
                  key={`${acct.id}-delete`}
                  className="button button--secondary"
                  disabled={deletingAccountId === acct.id}
                  type="button"
                  onClick={() => { void handleDelete(acct.id); }}
                >
                  {deletingAccountId === acct.id ? 'Deleting...' : 'Delete'}
                </button>,
              ]))}
            />
          ) : null}
        </div>
      </Card>
    </div>
  );
}
