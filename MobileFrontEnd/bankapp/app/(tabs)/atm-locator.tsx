import { useMemo, useState } from "react";
import { Button, Card, Field, PageHeader, Row, Screen } from "../../src/components/ui";
import { mockAtms } from "../../src/data/mockData";

export default function AtmLocatorScreen() {
  const [query, setQuery] = useState("");
  const [feature, setFeature] = useState("all");

  const filtered = useMemo(
    () =>
      mockAtms.filter((atm) => {
        return (
          (!query || `${atm.name} ${atm.address} ${atm.city} ${atm.state} ${atm.zip}`.toLowerCase().includes(query.toLowerCase())) &&
          (feature === "all" || atm.features.includes(feature))
        );
      }),
    [feature, query]
  );

  return (
    <Screen>
      <PageHeader title="ATM Locator" eyebrow="Partner network" subtitle="Search nearby ATM locations and compare convenience." />
      <Card>
        <Field label="Search by city or zip" value={query} onChangeText={setQuery} />
        <Field label="Filter feature" value={feature} onChangeText={setFeature} />
      </Card>
      <Card>
        {filtered.map((atm) => (
          <Row
            key={atm.id}
            title={atm.name}
            subtitle={`${atm.address}, ${atm.city}, ${atm.state} ${atm.zip} • ${atm.distanceMiles.toFixed(1)} mi`}
            right={<Button label="Directions" variant="secondary" onPress={() => {}} />}
          />
        ))}
      </Card>
    </Screen>
  );
}
