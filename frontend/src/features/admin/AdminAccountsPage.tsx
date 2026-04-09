import { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/apiClient';
import type { BankAccount } from '../../types/banking';
import { Card, PageHeader, InlineAlert } from '../../components/ui';

export function AdminAccountsPage() {
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this account? This cannot be undone.')) return;
    try {
      await apiRequest(`/api/admin/accounts/${id}`, { method: 'DELETE' });
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete account.');
    }
  };

  return (
    <div className="stack-xl" style={{ paddingTop: '1rem' }}>
      <PageHeader
        title="Admin: Accounts"
        eyebrow="Admin panel"
        subtitle="View and delete customer accounts."
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
          {loading ? <p>Loading...</p> : null}
          {!loading && accounts.length === 0 ? <p className="muted">No accounts found.</p> : null}
          {!loading && accounts.length > 0 ? (
            <div className="table">
              <div className="table__header">
                <span>Account</span>
                <span>Type</span>
                <span>Status</span>
                <span>Balance</span>
                <span />
              </div>
              {accounts.map((acct) => (
                <div key={acct.id} className="table__row">
                  <span>{acct.nickname} ({acct.maskedNumber})</span>
                  <span>{acct.type}</span>
                  <span>{acct.status}</span>
                  <span>${acct.balances.currentBalance.toFixed(2)}</span>
                  <button className="button button--secondary" type="button" onClick={() => { void handleDelete(acct.id); }}>
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
