import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, EmptyState, PageHeader, StatusChip } from '../../components/ui';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime } from '../../lib/format';
import { notificationsService } from '../../lib/bankingApi';
import {
  isNotificationTypeEnabled,
  readNotificationPreferences,
} from '../../lib/notificationPreferences';
import type { NotificationItem } from '../../types/banking';

interface NotificationRollup {
  key: string;
  type: NotificationItem['type'];
  title: string;
  body: string;
  latestCreatedAt: string;
  count: number;
  unreadCount: number;
  notificationIds: string[];
  isDigest?: boolean;
}

function getDayKey(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
}

function formatRelativeTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  const diffMs = parsed.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60000);
  const formatter = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

  if (Math.abs(diffMinutes) < 1) return 'Just now';
  if (Math.abs(diffMinutes) < 60) return formatter.format(diffMinutes, 'minute');
  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) return formatter.format(diffHours, 'hour');
  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, 'day');
}

function getDayLabel(value: string): 'Today' | 'Yesterday' | 'Earlier' {
  const today = getDayKey(new Date().toISOString());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getDayKey(yesterdayDate.toISOString());
  const dayKey = getDayKey(value);
  if (dayKey === today) return 'Today';
  if (dayKey === yesterday) return 'Yesterday';
  return 'Earlier';
}

function getPriority(rollup: NotificationRollup): 'high' | 'medium' | 'low' {
  if (rollup.isDigest) return 'low';
  const text = `${rollup.title} ${rollup.body}`.toLowerCase();
  if (rollup.type === 'security' || /failed|declined|invalid|unable|locked/.test(text)) return 'high';
  if (rollup.unreadCount > 0 || rollup.type === 'payment' || rollup.type === 'transfer') return 'medium';
  return 'low';
}

function getActionForNotification(rollup: NotificationRollup): { label: string; to: string } {
  if (rollup.isDigest) {
    return { label: 'Open dashboard', to: '/app/dashboard' };
  }
  const text = `${rollup.title} ${rollup.body}`.toLowerCase();
  if (rollup.type === 'payment' || /bill pay|payee|payment/.test(text)) {
    return { label: 'Open bill pay', to: '/app/bill-pay' };
  }
  if (rollup.type === 'transfer' || /transfer|external bank|member/.test(text)) {
    return { label: 'Open transfers', to: '/app/transfers' };
  }
  if (rollup.type === 'deposit' || /deposit/.test(text)) {
    return { label: 'Open deposits', to: '/app/deposits' };
  }
  return { label: 'Open settings', to: '/app/settings' };
}

function buildRollups(notifications: NotificationItem[]): NotificationRollup[] {
  const sorted = [...notifications].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const grouped = new Map<string, NotificationRollup>();

  for (const notification of sorted) {
    const dayKey = getDayKey(notification.createdAt);
    const rollupKey = `${notification.type}|${notification.title}|${notification.body}|${dayKey}`;
    const existing = grouped.get(rollupKey);
    if (existing) {
      existing.count += 1;
      if (!notification.read) existing.unreadCount += 1;
      existing.notificationIds.push(notification.id);
      continue;
    }
    grouped.set(rollupKey, {
      key: rollupKey,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      latestCreatedAt: notification.createdAt,
      count: 1,
      unreadCount: notification.read ? 0 : 1,
      notificationIds: [notification.id],
    });
  }

  return [...grouped.values()].sort(
    (a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime(),
  );
}

function buildDailyDigestRollups(notifications: NotificationItem[]): NotificationRollup[] {
  const grouped = new Map<string, NotificationItem[]>();
  for (const notification of notifications) {
    const dayKey = getDayKey(notification.createdAt);
    const bucket = grouped.get(dayKey) ?? [];
    bucket.push(notification);
    grouped.set(dayKey, bucket);
  }

  return [...grouped.entries()]
    .map(([dayKey, items]) => {
      const latestCreatedAt = items
        .map((item) => item.createdAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? new Date().toISOString();
      const byTypeCount: Record<NotificationItem['type'], number> = {
        transfer: 0,
        payment: 0,
        deposit: 0,
        security: 0,
      };
      let unreadCount = 0;
      for (const item of items) {
        byTypeCount[item.type] += 1;
        if (!item.read) unreadCount += 1;
      }

      const typeSummary = (Object.entries(byTypeCount) as Array<[NotificationItem['type'], number]>)
        .filter(([, count]) => count > 0)
        .map(([type, count]) => `${count} ${type}${count === 1 ? '' : 's'}`)
        .join(', ');
      const body = unreadCount > 0
        ? `${items.length} alerts for this day (${typeSummary}). ${unreadCount} unread.`
        : `${items.length} alerts for this day (${typeSummary}).`;

      return {
        key: `digest|${dayKey}`,
        type: 'security' as const,
        title: 'Daily digest',
        body,
        latestCreatedAt,
        count: 1,
        unreadCount: 0,
        notificationIds: [],
        isDigest: true,
      } satisfies NotificationRollup;
    })
    .sort((a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime());
}

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const notificationPreferences = readNotificationPreferences();
  const { data: notifications = [] } = useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: notificationsService.list,
    refetchInterval: 10_000,
  });
  const markReadMutation = useMutation({
    mutationFn: async (notificationIds: string[]) => {
      await Promise.all(notificationIds.map((notificationId) => notificationsService.markRead(notificationId)));
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications() });
    },
  });

  const filteredNotifications = useMemo(
    () => notifications.filter((item) => isNotificationTypeEnabled(notificationPreferences, item.type)),
    [notificationPreferences, notifications],
  );

  const rollups = useMemo(() => {
    const baseRollups = buildRollups(filteredNotifications);
    if (!notificationPreferences.dailyDigest) {
      return baseRollups;
    }
    const digestRollups = buildDailyDigestRollups(filteredNotifications);
    return [...digestRollups, ...baseRollups].sort(
      (a, b) => new Date(b.latestCreatedAt).getTime() - new Date(a.latestCreatedAt).getTime(),
    );
  }, [filteredNotifications, notificationPreferences.dailyDigest]);
  const sections = useMemo(() => {
    const buckets: Record<'Today' | 'Yesterday' | 'Earlier', NotificationRollup[]> = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };
    for (const rollup of rollups) {
      const label = getDayLabel(rollup.latestCreatedAt);
      buckets[label].push(rollup);
    }
    return buckets;
  }, [rollups]);

  if (!rollups.length) {
    return <EmptyState title="No notifications" description="System activity and alerts will appear here." />;
  }

  return (
    <div className="stack-xl">
      <PageHeader title="Notifications" eyebrow="System events" subtitle="Track deposit reviews, payment failures, and security notices." />
      {(['Today', 'Yesterday', 'Earlier'] as const).map((label) => (
        sections[label].length ? (
          <section className="stack-md" key={label}>
            <h3 className="notification-day-heading">{label}</h3>
            <div className="list-stack notifications-list">
              {sections[label].map((rollup) => {
                const priority = getPriority(rollup);
                const action = getActionForNotification(rollup);
                return (
                  <Card
                    className={`notification-card notification-card--priority-${priority} ${rollup.unreadCount ? 'card--accent' : ''}`.trim()}
                    key={rollup.key}
                  >
                    <div className="notification-card__header">
                      <h3 className="notification-card__title">{rollup.title}</h3>
                      <StatusChip status={rollup.type} />
                      <span className={`notification-priority-chip notification-priority-chip--${priority}`}>
                        {priority} priority
                      </span>
                    </div>
                    <p className="notification-card__body">{rollup.body}</p>
                    <div className="notification-card__meta">
                      <small className="muted notification-card__time">
                        {formatRelativeTime(rollup.latestCreatedAt)} · {formatDateTime(rollup.latestCreatedAt)}
                      </small>
                      {rollup.count > 1 ? (
                        <small className="muted notification-rollup-count">{rollup.count} similar alerts</small>
                      ) : null}
                    </div>
                    <div className="notification-card__actions">
                      <Link className="button button--secondary notification-action-link" to={action.to}>
                        {action.label}
                      </Link>
                      {rollup.unreadCount > 0 && !rollup.isDigest ? (
                        <Button
                          disabled={markReadMutation.isPending}
                          onClick={() => markReadMutation.mutate(rollup.notificationIds)}
                          type="button"
                          variant="ghost"
                        >
                          Mark read
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ) : null
      ))}
    </div>
  );
}
