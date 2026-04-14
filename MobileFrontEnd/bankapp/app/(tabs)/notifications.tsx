import { useState } from "react";
import { Text, View } from "react-native";
import { Button, Card, PageHeader, Row, Screen, StatusChip } from "../../src/components/ui";
import { mockNotifications as seedNotifications } from "../../src/data/mockData";
import { formatDateTime } from "../../src/lib/format";

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState(seedNotifications);

  return (
    <Screen>
      <PageHeader title="Notifications" eyebrow="System events" subtitle="Track deposit reviews, payment failures, and security notices." />
      {!notifications.length ? (
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
                  onPress={() => setNotifications((items) => items.map((item) => (item.id === notification.id ? { ...item, read: true } : item)))}
                />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </Screen>
  );
}
