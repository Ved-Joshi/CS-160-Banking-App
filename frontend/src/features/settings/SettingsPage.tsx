import { useQuery } from '@tanstack/react-query';
import { Card, PageHeader } from '../../components/ui';
import { profileService } from '../../lib/bankingApi';
import { formatDate } from '../../lib/format';

export function SettingsPage() {
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: profileService.get });

  return (
    <div className="stack-xl">
      <PageHeader title="Settings" eyebrow="Profile" subtitle="Review your profile details." />
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
      </div>
    </div>
  );
}
