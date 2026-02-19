"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import styles from "./page.module.css";

type Waypoint = {
  lat: number;
  lng: number;
};

type LeafletMap = {
  remove: () => void;
  on: (eventName: string, callback: (event: { latlng: Waypoint }) => void) => void;
  setView: (coords: [number, number], zoom: number) => void;
};

type OsrmRouteResponse = {
  code: string;
  routes?: Array<{
    geometry: {
      coordinates: [number, number][];
    };
  }>;
};

type LeafletLayer = {
  addTo: (map: LeafletMap) => LeafletLayer;
  setLatLngs?: (coords: [number, number][]) => void;
  remove?: () => void;
};

declare global {
  interface Window {
    L?: {
      map: (container: string, options?: Record<string, unknown>) => LeafletMap;
      tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
      polyline: (coords: [number, number][], options?: Record<string, unknown>) => LeafletLayer;
      marker: (coords: [number, number], options?: Record<string, unknown>) => LeafletLayer;
      Icon: {
        Default: {
          mergeOptions: (options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const DEFAULT_CENTER: [number, number] = [52.52, 13.405];

export default function Home() {
  const [leafletReady, setLeafletReady] = useState(false);
  const [routeNotice, setRouteNotice] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LeafletLayer[]>([]);
  const routeLineRef = useRef<LeafletLayer | null>(null);

  useEffect(() => {
    if (!leafletReady || !window.L || mapRef.current) {
      return;
    }

    const leaflet = window.L;

    leaflet.Icon.Default.mergeOptions({
      iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
      iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
      shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });

    const map = leaflet.map("map", {
      zoomControl: true,
    });

    map.setView(DEFAULT_CENTER, 13);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          map.setView([position.coords.latitude, position.coords.longitude], 13);
        },
        () => {
          setRouteNotice("Standort konnte nicht ermittelt werden. Karte startet in Berlin.");
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
        },
      );
    }

    leaflet
      .tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      })
      .addTo(map);

    const routeLine = leaflet.polyline([], {
      color: "#2563eb",
      weight: 4,
    });
    routeLine.addTo(map);

    map.on("click", (event) => {
      const newPoint: Waypoint = {
        lat: Number(event.latlng.lat.toFixed(6)),
        lng: Number(event.latlng.lng.toFixed(6)),
      };

      setWaypoints((current) => [...current, newPoint]);
    });

    mapRef.current = map;
    routeLineRef.current = routeLine;

    return () => {
      map.remove();
      mapRef.current = null;
      routeLineRef.current = null;
      markersRef.current = [];
    };
  }, [leafletReady]);

  useEffect(() => {
    if (!window.L || !mapRef.current) {
      return;
    }

    const leaflet = window.L;

    markersRef.current.forEach((marker) => marker.remove?.());
    markersRef.current = waypoints.map((point) =>
      leaflet.marker([point.lat, point.lng]).addTo(mapRef.current as LeafletMap),
    );

  }, [waypoints]);

  useEffect(() => {
    if (!routeLineRef.current) {
      return;
    }

    if (waypoints.length < 2) {
      routeLineRef.current.setLatLngs?.(waypoints.map((point) => [point.lat, point.lng]));
      return;
    }

    const controller = new AbortController();

    const loadRoute = async () => {
      const coordinates = waypoints.map((point) => `${point.lng},${point.lat}`).join(";");

      try {
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`,
          {
            signal: controller.signal,
          },
        );
        const data = (await response.json()) as OsrmRouteResponse;
        const routePoints = data.routes?.[0]?.geometry.coordinates;

        if (!response.ok || data.code !== "Ok" || !routePoints) {
          throw new Error("OSRM route not available");
        }

        routeLineRef.current?.setLatLngs?.(routePoints.map(([lng, lat]) => [lat, lng]));
        setRouteNotice(null);
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }

        routeLineRef.current?.setLatLngs?.(waypoints.map((point) => [point.lat, point.lng]));
        setRouteNotice("Straßenroute konnte nicht geladen werden. Es wird eine direkte Linie angezeigt.");
      }
    };

    void loadRoute();

    return () => controller.abort();
  }, [waypoints]);

  const undoLast = () => {
    setWaypoints((current) => current.slice(0, -1));
  };

  const clearRoute = () => {
    setWaypoints([]);
  };

  return (
    <div className={styles.page}>
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        strategy="afterInteractive"
        onLoad={() => setLeafletReady(true)}
      />
      <main className={styles.main}>
        <header className={styles.header}>
          <h1>Routenplaner</h1>
          <p>Klicke auf die Karte, um Wegpunkte zu setzen und eine Route zu zeichnen.</p>
        </header>

        <div className={styles.layout}>
          <div id="map" className={styles.map} aria-label="Interaktive Karte" />

          <aside className={styles.sidebar}>
            <h2>Wegpunkte ({waypoints.length})</h2>
            {routeNotice ? <p>{routeNotice}</p> : null}
            <div className={styles.actions}>
              <button type="button" onClick={undoLast} disabled={waypoints.length === 0}>
                Letzten Punkt entfernen
              </button>
              <button type="button" onClick={clearRoute} disabled={waypoints.length === 0}>
                Route löschen
              </button>
            </div>

            <ol className={styles.list}>
              {waypoints.length === 0 ? (
                <li>Noch keine Punkte gesetzt.</li>
              ) : (
                waypoints.map((point, index) => (
                  <li key={`${point.lat}-${point.lng}-${index}`}>
                    #{index + 1}: {point.lat}, {point.lng}
                  </li>
                ))
              )}
            </ol>
          </aside>
        </div>
      </main>
    </div>
  );
}
