import { useCallback, useRef, useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, PageHeader, Row, Screen, StatusChip } from "../../src/components/ui";
import { formatDateTime } from "../../src/lib/format";
import { useNotifications } from "../../src/lib/hooks";

export default function NotificationsScreen() {
  const { notifications, loading, markAsRead, refresh } = useNotifications();
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);

  const onRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
      refreshingRef.current = false;
    }
  }, [refresh]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await markAsRead(notificationId);
    } catch (err) {
      Alert.alert("Error", "Failed to mark notification as read");
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <PageHeader title="Notifications" eyebrow="System events" subtitle="Track deposit reviews, payment failures, and security notices." />
      {loading ? (
        <Card>
          <Text>Loading notifications...</Text>
        </Card>
      ) : !notifications.length ? (
        <Card>
          <Text style={{ fontWeight: "800" }}>No notifications</Text>
          <Text>System activity and alerts will appear here.</Text>
        </Card>
      ) : (
        notifications.map((notification) => (
          <Card key={notification.id} accent={!notification.read}>
            <Row title={notification.title} right={<StatusChip status={notification.type} />} />
            <Text>{notification.body}</Text>
            <Text>{formatDateTime(notification.createdAt)}</Text>
            {!notification.read ? (
              <View style={{ maxWidth: 140 }}>
                <Button
                  label="Mark read"
                  variant="secondary"
                  onPress={() => handleMarkAsRead(notification.id)}
                />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
