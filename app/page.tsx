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
    distance: number;
    geometry: {
      coordinates: [number, number][];
    };
    legs?: Array<{
      steps?: Array<{
        name?: string;
        ref?: string;
      }>;
    }>;
  }>;
};

type LeafletLayer = {
  addTo: (map: LeafletMap) => LeafletLayer;
  setLatLngs?: (coords: [number, number][]) => void;
  setLatLng?: (coords: [number, number]) => void;
  remove?: () => void;
};

declare global {
  interface Window {
    L?: {
      map: (container: string, options?: Record<string, unknown>) => LeafletMap;
      tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
      polyline: (coords: [number, number][], options?: Record<string, unknown>) => LeafletLayer;
      marker: (coords: [number, number], options?: Record<string, unknown>) => LeafletLayer;
      circleMarker: (coords: [number, number], options?: Record<string, unknown>) => LeafletLayer;
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
  const [routeDistanceKm, setRouteDistanceKm] = useState<number>(0);
  const [countryRoadWarning, setCountryRoadWarning] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const mapRef = useRef<LeafletMap | null>(null);
  const waypointCirclesRef = useRef<LeafletLayer[]>([]);
  const currentPositionRef = useRef<LeafletLayer | null>(null);
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
          const currentCoords: [number, number] = [position.coords.latitude, position.coords.longitude];
          map.setView(currentCoords, 16);

          currentPositionRef.current?.remove?.();
          currentPositionRef.current = leaflet
            .circleMarker(currentCoords, {
              radius: 10,
              color: "#7dd3fc",
              weight: 2,
              fillColor: "#bae6fd",
              fillOpacity: 1,
            })
            .addTo(map);
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
      waypointCirclesRef.current = [];
      currentPositionRef.current = null;
    };
  }, [leafletReady]);

  useEffect(() => {
    if (!window.L || !mapRef.current) {
      return;
    }

    const leaflet = window.L;

    waypointCirclesRef.current.forEach((circle) => circle.remove?.());
    waypointCirclesRef.current = waypoints.map((point) =>
      leaflet
        .circleMarker([point.lat, point.lng], {
          radius: 8,
          color: "#ffffff",
          weight: 2,
          fillColor: "#ffffff",
          fillOpacity: 1,
        })
        .addTo(mapRef.current as LeafletMap),
    );
  }, [waypoints]);

  useEffect(() => {
    if (!routeLineRef.current) {
      return;
    }

    if (waypoints.length < 2) {
      routeLineRef.current.setLatLngs?.([]);
      setRouteNotice(null);
      setRouteDistanceKm(0);
      setCountryRoadWarning(null);
      return;
    }

    const controller = new AbortController();

    const loadRoute = async () => {
      const coordinates = waypoints.map((point) => `${point.lng},${point.lat}`).join(";");

      try {
        const baseUrl = `https://router.project-osrm.org/route/v1/foot/${coordinates}?overview=full&geometries=geojson&alternatives=false&steps=true`;
        const responseWithExclude = await fetch(`${baseUrl}&exclude=motorway,motorway_link`, {
          signal: controller.signal,
        });
        const dataWithExclude = (await responseWithExclude.json()) as OsrmRouteResponse;

        let data = dataWithExclude;
        let responseOk = responseWithExclude.ok;

        if (!responseWithExclude.ok || dataWithExclude.code !== "Ok") {
          const fallbackResponse = await fetch(baseUrl, {
            signal: controller.signal,
          });
          data = (await fallbackResponse.json()) as OsrmRouteResponse;
          responseOk = fallbackResponse.ok;
        }

        const route = data.routes?.[0];
        const routePoints = route?.geometry.coordinates;

        if (!responseOk || data.code !== "Ok" || !routePoints) {
          throw new Error("OSRM route not available");
        }

        routeLineRef.current?.setLatLngs?.(routePoints.map(([lng, lat]) => [lat, lng]));
        setRouteDistanceKm(route.distance / 1000);

        const routeSteps = route.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
        const usesCountryRoad = routeSteps.some((step) => {
          const roadLabel = `${step.ref ?? ""} ${step.name ?? ""}`.toUpperCase();
          return /\b(B|L)\s?\d+\b/.test(roadLabel);
        });

        setCountryRoadWarning(
          usesCountryRoad ? "Warnung: Diese Route enthält Abschnitte über Landstraßen." : null,
        );
        setRouteNotice("Fußgängerroute aktiv: Autobahnen werden gemieden.");
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }

        routeLineRef.current?.setLatLngs?.([]);
        setRouteDistanceKm(0);
        setCountryRoadWarning(null);
        setRouteNotice(
          "Fußweg konnte nicht gefunden werden. Es wird keine direkte Linie mehr über Privatgelände gezeichnet.",
        );
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
    setRouteNotice(null);
    setRouteDistanceKm(0);
    setCountryRoadWarning(null);
  };

  return (
    <div className={styles.page}>
      <Script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        strategy="afterInteractive"
        onLoad={() => setLeafletReady(true)}
      />

      {waypoints.length > 0 ? (
        <div className={styles.routeBar}>Routenlänge: {routeDistanceKm.toFixed(2)} km</div>
      ) : null}

      <div id="map" className={styles.map} aria-label="Interaktive Karte" />

      <div className={styles.overlay}>
        {routeNotice ? <p className={styles.notice}>{routeNotice}</p> : null}
        {countryRoadWarning ? <p className={styles.warning}>{countryRoadWarning}</p> : null}
        <div className={styles.actions}>
          <button type="button" onClick={undoLast} disabled={waypoints.length === 0}>
            Letzten Punkt entfernen
          </button>
          <button type="button" onClick={clearRoute} disabled={waypoints.length === 0}>
            Route löschen
          </button>
        </div>
      </div>
    </div>
  );
}
