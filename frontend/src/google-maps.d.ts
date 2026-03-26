declare global {
  interface Window {
    google?: typeof google;
  }

  namespace google.maps {
    interface LatLngLiteral {
      lat: number;
      lng: number;
    }

    interface MapOptions {
      center: LatLngLiteral;
      zoom: number;
      mapTypeControl?: boolean;
      streetViewControl?: boolean;
      fullscreenControl?: boolean;
      gestureHandling?: string;
    }

    class Map {
      constructor(element: Element, options: MapOptions);
      setCenter(latLng: LatLngLiteral): void;
      setZoom(zoom: number): void;
      fitBounds(bounds: LatLngBounds): void;
      panTo(latLng: LatLngLiteral): void;
    }

    class LatLngBounds {
      extend(latLng: LatLngLiteral): void;
      isEmpty(): boolean;
    }

    interface MarkerOptions {
      map: Map | null;
      position: LatLngLiteral;
      title?: string;
      label?: string | MarkerLabel;
      animation?: Animation | null;
    }

    interface MarkerLabel {
      text: string;
      color?: string;
      fontWeight?: string;
    }

    enum Animation {
      DROP = 1,
      BOUNCE = 2,
    }

    class Marker {
      constructor(options: MarkerOptions);
      addListener(eventName: string, handler: () => void): MapsEventListener;
      setMap(map: Map | null): void;
      setAnimation(animation: Animation | null): void;
      setLabel(label: string | MarkerLabel): void;
    }

    interface MapsEventListener {
      remove(): void;
    }
  }
}

export {};
