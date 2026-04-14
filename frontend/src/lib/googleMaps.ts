const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();

let googleMapsLoader: Promise<typeof window.google> | null = null;

export function isGoogleMapsConfigured(): boolean {
  return Boolean(googleMapsApiKey);
}

export async function loadGoogleMaps(): Promise<typeof window.google> {
  if (!googleMapsApiKey) {
    throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY. Add it to the frontend .env file.');
  }

  if (window.google?.maps) {
    return window.google;
  }

  if (!googleMapsLoader) {
    googleMapsLoader = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader="true"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.google), { once: true });
        existing.addEventListener('error', () => reject(new Error('Unable to load Google Maps.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(googleMapsApiKey)}&loading=async`;
      script.async = true;
      script.defer = true;
      script.dataset.googleMapsLoader = 'true';
      script.onload = () => {
        if (window.google?.maps) {
          resolve(window.google);
          return;
        }
        reject(new Error('Google Maps loaded without the maps runtime.'));
      };
      script.onerror = () => reject(new Error('Unable to load Google Maps.'));
      document.head.appendChild(script);
    });
  }

  return googleMapsLoader;
}
