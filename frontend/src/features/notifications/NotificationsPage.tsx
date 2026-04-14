import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, PageHeader, StatusChip } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { notificationsService } from '../../lib/bankingApi';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { data: notifications = [] } = useQuery({ queryKey: ['notifications'], queryFn: notificationsService.list });
  const mutation = useMutation({
    mutationFn: notificationsService.markRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!notifications.length) {
    return <EmptyState title="No notifications" description="System activity and alerts will appear here." />;
  }

  return (
    <div className="stack-xl">
      <PageHeader title="Notifications" eyebrow="System events" subtitle="Track deposit reviews, payment failures, and security notices." />
      <div className="list-stack">
        {notifications.map((notification) => (
          <Card className={notification.read ? '' : 'card--accent'} key={notification.id}>
            <div className="list-row">
              <div>
                <div className="button-row">
                  <h3>{notification.title}</h3>
                  <StatusChip status={notification.type} />
                </div>
                <p>{notification.body}</p>
                <small className="muted">{formatDateTime(notification.createdAt)}</small>
              </div>
              {!notification.read ? (
                <Button onClick={() => mutation.mutate(notification.id)} type="button" variant="secondary">
                  Mark read
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
