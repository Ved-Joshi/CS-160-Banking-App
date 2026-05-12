import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN?.trim();

export function isMapboxConfigured(): boolean {
  return Boolean(mapboxToken);
}

export function initializeMapbox(): void {
  if (!mapboxToken) {
    throw new Error('Missing VITE_MAPBOX_TOKEN. Add it to the frontend .env file.');
  }
  mapboxgl.accessToken = mapboxToken;
}

export function createMap(container: HTMLElement, options?: Omit<mapboxgl.MapboxOptions, 'container'>): mapboxgl.Map {
  if (!mapboxToken) {
    throw new Error('Missing VITE_MAPBOX_TOKEN. Add it to the frontend .env file.');
  }

  const map = new mapboxgl.Map({
    container,
    style: 'mapbox://styles/mapbox/streets-v12',
    zoom: 12,
    ...options,
  });

  return map;
}

export { mapboxgl };
