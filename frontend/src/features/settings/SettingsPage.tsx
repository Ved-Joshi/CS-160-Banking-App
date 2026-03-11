import { useQuery } from '@tanstack/react-query';
import { Card, PageHeader, StatusChip } from '../../components/ui';
import { authService } from '../../lib/mockApi';
import { formatDate } from '../../lib/format';

export function SettingsPage() {
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: authService.getProfile });

  return (
    <div className="stack-xl">
      <PageHeader title="Settings" eyebrow="Profile and security" subtitle="Review your profile details and manage your security preferences." />
      <div className="grid-two">
        <Card>
          <h3>Profile</h3>
          {profile ? (
            <dl className="stat-list">
              <div>
                <dt>Name</dt>
                <dd>{profile.fullName}</dd>
              </div>
              <div>
                <dt>Username</dt>
                <dd>{profile.username || '—'}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{profile.email}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{profile.phone}</dd>
              </div>
              <div>
                <dt>Address</dt>
                <dd>{profile.address}</dd>
              </div>
              <div>
                <dt>Member since</dt>
                <dd>{formatDate(profile.memberSince)}</dd>
              </div>
            </dl>
          ) : null}
        </Card>
        <Card>
          <h3>Security</h3>
          {profile ? (
            <div className="stack-md">
              <div className="list-row">
                <span>Multi-factor authentication</span>
                <StatusChip status={profile.mfaEnabled ? 'enabled' : 'disabled'} />
              </div>
              <button className="button button--secondary" type="button">
                Reset password
              </button>
              <button className="button button--secondary" type="button">
                Notification preferences
              </button>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
