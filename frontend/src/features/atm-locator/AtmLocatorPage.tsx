import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, PageHeader } from '../../components/ui';
import { atmService } from '../../lib/mockApi';

export function AtmLocatorPage() {
  const { data: atms = [] } = useQuery({ queryKey: ['atms'], queryFn: atmService.list });
  const [query, setQuery] = useState('');
  const [feature, setFeature] = useState('all');

  const filtered = useMemo(
    () =>
      atms.filter((atm) => {
        return (
          (!query ||
            `${atm.name} ${atm.address} ${atm.city} ${atm.state} ${atm.zip}`.toLowerCase().includes(query.toLowerCase())) &&
          (feature === 'all' || atm.features.includes(feature))
        );
      }),
    [atms, feature, query],
  );

  return (
    <div className="stack-xl">
      <PageHeader title="ATM Locator" eyebrow="Partner network" subtitle="Search nearby Chase ATM locations, then jump out for directions." />
      <div className="grid-two atm-grid">
        <Card>
          <div className="stack-md">
            <input placeholder="Search by city or zip" value={query} onChange={(event) => setQuery(event.target.value)} />
            <select value={feature} onChange={(event) => setFeature(event.target.value)}>
              <option value="all">All ATM features</option>
              <option value="Drive-up">Drive-up</option>
              <option value="Walk-up">Walk-up</option>
              <option value="Wheelchair accessible">Wheelchair accessible</option>
              <option value="Deposit-enabled">Deposit-enabled</option>
            </select>
          </div>
          <div className="list-stack">
            {filtered.map((atm) => (
              <div className="atm-card" key={atm.id}>
                <div className="atm-card__content">
                  <div className="atm-card__primary">
                    <strong>{atm.name}</strong>
                    <p className="muted">{atm.address}, {atm.city}, {atm.state} {atm.zip}</p>
                  </div>
                  <div className="atm-card__features">
                    {atm.features.map((feature) => (
                      <span className="atm-feature" key={`${atm.id}-${feature}`}>
                        {feature}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="atm-card__meta">
                  <div className="atm-card__distance">
                    <strong>{atm.distanceMiles.toFixed(1)} mi</strong>
                    <small>{atm.hours}</small>
                  </div>
                  <Button type="button" variant="secondary">Directions</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="map-panel">
          <div className="map-placeholder">
            <div className="map-placeholder__grid" />
            {filtered.slice(0, 3).map((atm, index) => (
              <span key={atm.id} className={`map-pin map-pin--${index + 1}`}>
                {index + 1}
              </span>
            ))}
            <div className="map-legend">
              <strong>Location map</strong>
              <p>Review nearby ATM locations on the map and compare them with the results list to choose the most convenient option.</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
