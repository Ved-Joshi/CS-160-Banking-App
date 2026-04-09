import { Card, PageHeader } from '../../components/ui';
import { useAuth } from '../auth/useAuth';
import { Link } from 'react-router-dom';

export function AdminPage() {
  const { user, signOut } = useAuth();

  return (
    <div className="stack-xl" style={{ paddingTop: '1rem' }}>
      <PageHeader
        title="Admin Panel"
        eyebrow="System"
        subtitle="Manage the banking experience and monitor activity."
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

      <Card>
        <div
          className="stack-md"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: '1rem',
          }}
        >
          <div className="stack-sm" style={{ margin: '0 auto' }}>
            <p className="eyebrow">Signed in as</p>
            <h2 style={{ margin: 0 }}>{user?.email}</h2>
            <p className="muted">Roles: {(user?.roles ?? []).join(', ') || 'admin'}</p>
          </div>
          <div
            className="button-row"
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <Link className="button button--primary" to="/admin/accounts">Manage accounts</Link>
            <Link className="button button--secondary" to="/app/dashboard">Customer view</Link>
            <button className="button button--secondary" type="button" onClick={() => { void signOut(); }}>
              Sign out
            </button>
          </div>
        </div>
      </Card>

      <div className="grid-two" style={{ gap: '1.25rem' }}>
        <Card>
          <div className="stack-md">
            <div className="stack-sm">
              <h3>Accounts</h3>
              <p className="muted">View and delete customer accounts.</p>
            </div>
            <div>
              <Link className="button button--secondary" to="/admin/accounts">Open accounts admin</Link>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
