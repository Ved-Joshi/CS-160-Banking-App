import { useMemo, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";
import { Button, Card, Field, PageHeader, Row, Screen, StatusChip } from "../../src/components/ui";
import { searchATMs } from "../../src/lib/hooks";
import type { AtmLocation, AtmSearchCenter } from "../../src/types";

type SearchMode = "query" | "coords";

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isSafeDirectionsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatAtmSubtitle(atm: AtmLocation): string {
  const miles = Number.isFinite(atm.distanceMiles) ? `${atm.distanceMiles.toFixed(1)} mi` : "";
  const address = `${atm.address}, ${atm.city}, ${atm.state} ${atm.zip}`.trim();
  const parts = [miles, address, atm.hours].filter(Boolean);
  return parts.join(" • ");
}

export default function AtmLocatorScreen() {
  const [mode, setMode] = useState<SearchMode>("query");
  const [query, setQuery] = useState("");
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [radiusText, setRadiusText] = useState("10");
  const [limitText, setLimitText] = useState("20");
  const [openNow, setOpenNow] = useState(false);
  const [featureFilter, setFeatureFilter] = useState("");

  const [center, setCenter] = useState<AtmSearchCenter | null>(null);
  const [atms, setAtms] = useState<AtmLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [locationState, setLocationState] = useState<"idle" | "requesting" | "ready" | "denied" | "unsupported" | "error">("idle");

  const filteredAtms = useMemo(() => {
    const feature = featureFilter.trim().toLowerCase();
    if (!feature) return atms;
    return atms.filter((atm) => atm.features.some((f) => f.toLowerCase().includes(feature)));
  }, [atms, featureFilter]);

  const handleSearch = async () => {
    const radiusMiles = clampInt(Number.parseInt(radiusText, 10) || 10, 1, 25);
    const limit = clampInt(Number.parseInt(limitText, 10) || 20, 1, 50);

    const trimmedQuery = query.trim();
    const lat = Number.parseFloat(latText);
    const lng = Number.parseFloat(lngText);

    if (mode === "query") {
      if (trimmedQuery.length < 2) {
        Alert.alert("Enter a location", "Search query must be at least 2 characters (e.g., a city or ZIP).");
        return;
      }
    } else {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        Alert.alert("Enter coordinates", "Latitude and longitude must be valid numbers.");
        return;
      }
    }

    setLoading(true);
    try {
      const response = await searchATMs(
        mode === "query"
          ? { query: trimmedQuery, radiusMiles, openNow, limit }
          : { latitude: lat, longitude: lng, radiusMiles, openNow, limit }
      );
      setCenter(response.center);
      setAtms(response.atms ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to search ATMs";
      Alert.alert("Search failed", message);
    } finally {
      setLoading(false);
    }
  };

  const handleUseMyLocation = async () => {
    setLocationState("requesting");
    try {
      const module = await import("expo-location");
      const Location = module as any;
      const perms = await Location.requestForegroundPermissionsAsync();
      if (!perms?.granted) {
        setLocationState("denied");
        Alert.alert("Permission denied", "Enable location permissions to search near you.");
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Balanced ?? undefined });
      const lat = String(position?.coords?.latitude ?? "");
      const lng = String(position?.coords?.longitude ?? "");
      if (!lat || !lng) {
        setLocationState("error");
        Alert.alert("Location error", "Unable to read your location.");
        return;
      }
      setLatText(lat);
      setLngText(lng);
      setMode("coords");
      setLocationState("ready");
      await handleSearch();
    } catch (err) {
      setLocationState("unsupported");
      Alert.alert(
        "Location unavailable",
        "Location permissions require expo-location. Run `npx expo install expo-location` in the mobile app to enable this."
      );
    }
  };

  return (
    <Screen>
      <PageHeader
        title="ATM Locator"
        eyebrow="Partner network"
        subtitle="Search nearby ATM locations, filter by radius and open-now, and get directions."
      />

      <Card>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Search by location"
              variant={mode === "query" ? "primary" : "secondary"}
              onPress={() => setMode("query")}
              disabled={loading}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Search by coords"
              variant={mode === "coords" ? "primary" : "secondary"}
              onPress={() => setMode("coords")}
              disabled={loading}
            />
          </View>
        </View>

        <View style={{ marginTop: 10 }}>
          <Button
            label={locationState === "requesting" ? "Requesting location..." : "Use my location"}
            variant="secondary"
            onPress={handleUseMyLocation}
            disabled={loading || locationState === "requesting"}
          />
          {locationState === "denied" ? (
            <Text style={{ color: "#6B7280" }}>Location permission denied.</Text>
          ) : null}
        </View>

        {mode === "query" ? (
          <Field label="City, state, or ZIP" value={query} onChangeText={setQuery} placeholder="San Francisco, CA" />
        ) : (
          <>
            <Field label="Latitude" value={latText} onChangeText={setLatText} placeholder="37.7749" />
            <Field label="Longitude" value={lngText} onChangeText={setLngText} placeholder="-122.4194" />
          </>
        )}

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Field label="Radius (miles)" value={radiusText} onChangeText={setRadiusText} placeholder="10" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Limit" value={limitText} onChangeText={setLimitText} placeholder="20" />
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label={openNow ? "Open now: On" : "Open now: Off"}
              variant={openNow ? "primary" : "secondary"}
              onPress={() => setOpenNow((prev) => !prev)}
              disabled={loading}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={loading ? "Searching..." : "Search"} onPress={handleSearch} disabled={loading} />
          </View>
        </View>

        <Field
          label="Feature filter (optional)"
          value={featureFilter}
          onChangeText={setFeatureFilter}
          placeholder="deposit, drive-up, wheelchair..."
        />
      </Card>

      <Card>
        {center ? (
          <Text style={{ fontWeight: "800" }}>
            Results near {center.label} ({filteredAtms.length})
          </Text>
        ) : (
          <Text style={{ fontWeight: "800" }}>Search for nearby ATMs</Text>
        )}

        {filteredAtms.length === 0 ? (
          <Text>No results yet.</Text>
        ) : (
          filteredAtms.map((atm) => (
            <Row
              key={atm.id}
              title={atm.name}
              subtitle={formatAtmSubtitle(atm)}
              right={
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  {atm.openNow === true ? <StatusChip status="Open now" /> : atm.openNow === false ? <StatusChip status="Closed" /> : null}
                  <Button
                    label="Directions"
                    variant="secondary"
                    onPress={() => {
                      if (!isSafeDirectionsUrl(atm.directionsUrl)) {
                        Alert.alert("Unable to open directions", "This ATM did not include a valid directions link.");
                        return;
                      }
                      void Linking.openURL(atm.directionsUrl);
                    }}
                  />
                </View>
              }
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
