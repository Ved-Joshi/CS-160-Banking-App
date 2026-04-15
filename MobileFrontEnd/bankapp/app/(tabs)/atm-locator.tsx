import { useMemo, useState } from "react";
import { Button, Card, Field, PageHeader, Row, Screen } from "../../src/components/ui";
import { searchATMs } from "../../src/lib/hooks";
import type { AtmLocation } from "../../src/types";

export default function AtmLocatorScreen() {
  const [query, setQuery] = useState("");
  const [feature, setFeature] = useState("all");
  const [atms, setAtms] = useState<AtmLocation[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    try {
      const results = await searchATMs(query);
      setAtms(results);
    } catch (err) {
      console.error("Failed to search ATMs", err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(
    () =>
      atms.filter((atm) => {
        return feature === "all" || atm.features.includes(feature);
      }),
    [feature, atms]
  );

  return (
    <Screen>
      <PageHeader title="ATM Locator" eyebrow="Partner network" subtitle="Search nearby ATM locations and compare convenience." />
      <Card>
        <Field label="Search by city or zip" value={query} onChangeText={setQuery} />
        <Field label="Filter feature" value={feature} onChangeText={setFeature} />
        <Button label={loading ? "Searching..." : "Search ATMs"} onPress={handleSearch} disabled={loading} />
      </Card>
      <Card>
        {atms.length === 0 ? (
          <>
            <Field label="Search for a location" value="" />
          </>
        ) : (
          filtered.map((atm) => (
            <Row
              key={atm.id}
              title={atm.name}
              subtitle={`${atm.address}, ${atm.city}, ${atm.state} ${atm.zip}`}
              right={<Button label="Directions" variant="secondary" onPress={() => {}} />}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
