import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, EmptyState, InlineAlert, PageHeader } from '../../components/ui';
import type { AtmSearchInput } from '../../types/banking';
import { atmService } from '../../lib/bankingApi';
import { isGoogleMapsConfigured, loadGoogleMaps } from '../../lib/googleMaps';

type SearchTarget =
  | { mode: 'coords'; lat: number; lng: number }
  | { mode: 'query'; query: string }
  | null;

type LocationState = 'idle' | 'requesting' | 'ready' | 'denied' | 'error' | 'unsupported';
type MapState = 'idle' | 'loading' | 'ready' | 'error';

function buildSearchInput(target: SearchTarget, radiusMiles: number, openNow: boolean): AtmSearchInput | null {
  if (!target) return null;
  if (target.mode === 'coords') {
    return {
      lat: target.lat,
      lng: target.lng,
      radiusMiles,
      openNow,
    };
  }
  return {
    query: target.query,
    radiusMiles,
    openNow,
  };
}

export function AtmLocatorPage() {
  const [searchText, setSearchText] = useState('');
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [openNow, setOpenNow] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>('idle');
  const [target, setTarget] = useState<SearchTarget>(null);
  const [selectedAtmId, setSelectedAtmId] = useState<string | null>(null);
  const [mapState, setMapState] = useState<MapState>(isGoogleMapsConfigured() ? 'idle' : 'error');
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Array<{ id: string; marker: google.maps.Marker; listener: google.maps.MapsEventListener }>>([]);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const lastScrolledAtmIdRef = useRef<string | null>(null);

  const searchInput = useMemo(() => buildSearchInput(target, radiusMiles, openNow), [openNow, radiusMiles, target]);

  const searchQuery = useQuery({
    queryKey: ['atm-search', searchInput],
    queryFn: () => atmService.search(searchInput!),
    enabled: Boolean(searchInput),
    staleTime: 10 * 60 * 1000,
  });

  const atms = searchQuery.data?.atms ?? [];
  const center = searchQuery.data?.center;
  const selectedAtm = atms.find((atm) => atm.id === selectedAtmId) ?? atms[0] ?? null;

  useEffect(() => {
    if (!atms.length) {
      setSelectedAtmId(null);
      return;
    }
    if (!selectedAtmId || !atms.some((atm) => atm.id === selectedAtmId)) {
      setSelectedAtmId(atms[0].id);
    }
  }, [atms, selectedAtmId]);

  useEffect(() => {
    if (!isGoogleMapsConfigured()) {
      setMapState('error');
      return;
    }
    let cancelled = false;
    setMapState('loading');
    void loadGoogleMaps()
      .then(() => {
        if (!cancelled) {
          setMapState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMapState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (mapState !== 'ready' || !mapCanvasRef.current || !center || !window.google?.maps) {
      return;
    }

    const google = window.google;
    const mapCenter = { lat: center.latitude, lng: center.longitude };
    if (!mapRef.current) {
      mapRef.current = new google.maps.Map(mapCanvasRef.current, {
        center: mapCenter,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
      });
    } else {
      mapRef.current.setCenter(mapCenter);
    }

    markersRef.current.forEach(({ marker, listener }) => {
      listener.remove();
      marker.setMap(null);
    });
    markersRef.current = [];

    if (!atms.length) {
      mapRef.current.setZoom(12);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    markersRef.current = atms.map((atm, index) => {
      const marker = new google.maps.Marker({
        map: mapRef.current,
        position: { lat: atm.latitude, lng: atm.longitude },
        title: atm.name,
        label: `${index + 1}`,
      });
      bounds.extend({ lat: atm.latitude, lng: atm.longitude });
      const listener = marker.addListener('click', () => {
        setSelectedAtmId(atm.id);
      });
      return { id: atm.id, marker, listener };
    });

    if (!bounds.isEmpty()) {
      mapRef.current.fitBounds(bounds);
    }
  }, [atms, center, mapState]);

  useEffect(() => {
    if (!selectedAtm || !mapRef.current || !window.google?.maps) {
      return;
    }
    mapRef.current.panTo({ lat: selectedAtm.latitude, lng: selectedAtm.longitude });
    markersRef.current.forEach(({ id, marker }, index) => {
      marker.setLabel(
        id === selectedAtm.id
          ? { text: `${index + 1}`, color: '#ffffff', fontWeight: '700' }
          : `${index + 1}`,
      );
      marker.setAnimation(id === selectedAtm.id ? google.maps.Animation.BOUNCE : null);
    });
    const timeoutId = window.setTimeout(() => {
      markersRef.current.forEach(({ marker }) => marker.setAnimation(null));
    }, 700);
    return () => window.clearTimeout(timeoutId);
  }, [selectedAtm]);

  useEffect(() => {
    if (!selectedAtmId) {
      lastScrolledAtmIdRef.current = null;
      return;
    }
    if (lastScrolledAtmIdRef.current === null) {
      lastScrolledAtmIdRef.current = selectedAtmId;
      return;
    }
    if (lastScrolledAtmIdRef.current === selectedAtmId) {
      return;
    }
    cardRefs.current[selectedAtmId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
    lastScrolledAtmIdRef.current = selectedAtmId;
  }, [selectedAtmId]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationState('unsupported');
      return;
    }

    setLocationState('requesting');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationState('ready');
        setSearchText('');
        setTarget({
          mode: 'coords',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        setTarget(null);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationState('denied');
          return;
        }
        setLocationState('error');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      },
    );
  }, []);

  const handleManualSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = searchText.trim();
    if (!nextQuery) return;
    setTarget({ mode: 'query', query: nextQuery });
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationState('unsupported');
      return;
    }
    setLocationState('requesting');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocationState('ready');
        setSearchText('');
        setTarget({
          mode: 'coords',
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationState('denied');
          return;
        }
        setLocationState('error');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      },
    );
  };

  return (
    <div className="stack-xl">
      <PageHeader title="ATM Locator" eyebrow="Partner network" subtitle="Search nearby Chase ATM locations, then open turn-by-turn directions." />
      <div className="grid-two atm-grid">
        <Card className="atm-panel atm-panel--results">
          <div className="atm-search-panel stack-lg">
            <form className="atm-search-form" onSubmit={handleManualSearch}>
              <input
                className="atm-search-input"
                placeholder="Search by city, ZIP, or address"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
              <Button className="atm-button atm-button--search" type="submit" variant="secondary">Search</Button>
            </form>
            <div className="atm-filter-bar">
              <div className="atm-radius-group" aria-label="Radius" role="group">
                <span className="atm-filter-label">Within</span>
                {[5, 10, 15].map((radius) => (
                  <button
                    key={radius}
                    className={radiusMiles === radius ? 'atm-radius-chip atm-radius-chip--active' : 'atm-radius-chip'}
                    onClick={() => setRadiusMiles(radius)}
                    type="button"
                  >
                    {radius} mi
                  </button>
                ))}
              </div>
              <div className="atm-search-controls">
              <label className={openNow ? 'atm-search-toggle atm-search-toggle--active' : 'atm-search-toggle'}>
                <input checked={openNow} onChange={(event) => setOpenNow(event.target.checked)} type="checkbox" />
                <span>Open now</span>
              </label>
              <Button className="atm-button atm-button--locate" type="button" variant="secondary" onClick={handleUseMyLocation}>
                Use my location
              </Button>
              </div>
            </div>
            {locationState === 'requesting' ? (
              <InlineAlert title="Finding nearby ATMs" tone="success">
                Requesting your location to rank nearby Chase ATMs.
              </InlineAlert>
            ) : null}
            {locationState === 'denied' ? (
              <InlineAlert title="Location access denied" tone="warning">
                Search by city, ZIP, or address instead, or allow location access and try again.
              </InlineAlert>
            ) : null}
            {locationState === 'unsupported' ? (
              <InlineAlert title="Location unavailable" tone="warning">
                This browser cannot share your location. Use manual search instead.
              </InlineAlert>
            ) : null}
            {locationState === 'error' ? (
              <InlineAlert title="Unable to get your location" tone="warning">
                Search manually or try requesting your location again.
              </InlineAlert>
            ) : null}
            {searchQuery.error instanceof Error ? (
              <InlineAlert title="Unable to load ATMs" tone="warning">
                {searchQuery.error.message}
              </InlineAlert>
            ) : null}
            {center ? (
              <div className="atm-results-summary">
                <p className="muted">Showing Chase ATMs near <strong>{center.label}</strong>.</p>
                {atms.length ? <span className="atm-results-count">{atms.length} results</span> : null}
              </div>
            ) : null}
            <div className="atm-results-scroll">
              {!target && locationState !== 'requesting' ? (
                <EmptyState
                  title="Search for nearby Chase ATMs"
                  description="Use your current location or enter a city, ZIP, or street address to load results."
                />
              ) : searchQuery.isPending || searchQuery.isFetching ? (
                <p className="muted">Loading ATM results...</p>
              ) : !atms.length ? (
                <EmptyState
                  title="No nearby Chase ATMs found"
                  description="Try a wider radius or search a different area."
                />
              ) : (
                <div className="list-stack">
                  {atms.map((atm, index) => (
                    <div
                      className={atm.id === selectedAtmId ? 'atm-card atm-card--selected' : 'atm-card'}
                      key={atm.id}
                      ref={(element) => {
                        cardRefs.current[atm.id] = element;
                      }}
                      onClick={() => setSelectedAtmId(atm.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedAtmId(atm.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="atm-card__content">
                        <div className="atm-card__primary">
                          <strong>{index + 1}. {atm.name}</strong>
                          <p className="muted">{[atm.address, `${atm.city}, ${atm.state} ${atm.zip}`].filter(Boolean).join(' • ')}</p>
                        </div>
                        {atm.features.length ? (
                          <div className="atm-card__features">
                            {atm.features.map((feature) => (
                              <span className="atm-feature" key={`${atm.id}-${feature}`}>
                                {feature}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="atm-card__meta">
                        <div className="atm-card__distance">
                          <strong>{atm.distanceMiles.toFixed(1)} mi</strong>
                          <small>{atm.hours}</small>
                        </div>
                        <Button
                          className="atm-button atm-button--directions"
                          type="button"
                          variant="secondary"
                          onClick={(event) => {
                            event.stopPropagation();
                            window.open(atm.directionsUrl, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          Directions
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
        <Card className="atm-panel map-panel">
          <div className="map-shell">
            <div className="map-canvas" ref={mapCanvasRef} />
            {mapState === 'loading' ? (
              <div className="map-panel__status">
                <p>Loading map...</p>
              </div>
            ) : null}
            {mapState === 'error' ? (
              <div className="map-panel__status">
                <InlineAlert title="Map unavailable" tone="warning">
                  The list still works, but the embedded map could not be loaded. Add `VITE_GOOGLE_MAPS_API_KEY` to enable it.
                </InlineAlert>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
