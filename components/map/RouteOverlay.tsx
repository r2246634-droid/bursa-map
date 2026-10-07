"use client";

import { useEffect, useMemo, useRef } from "react";
import { Layer, Marker, Source, useMap } from "react-map-gl/maplibre";
import type { Feature, LineString } from "geojson";

import type { Place } from "@/data/types";
import { toLngLat } from "@/lib/map-config";

export interface RouteEndpoints {
  from: Place | null;
  to: Place | null;
}

interface RouteOverlayProps extends RouteEndpoints {
  /** Haritanın altını kaplayan panelin yüksekliği (px); kamera bu alanı boş bırakır */
  bottomInset: number;
}

/** Üstteki arama/katman butonu satırının kapladığı alan */
const TOP_INSET = 88;
const SIDE_INSET = 40;

/**
 * Yol tarifi uç noktaları ve aralarındaki sembolik kuş uçuşu çizgi.
 * Gerçek rota (A* / Dijkstra) backend'e bırakıldı; burada sadece seçimi görselleştiriyoruz.
 */
export default function RouteOverlay({ from, to, bottomInset }: RouteOverlayProps) {
  const { current: map } = useMap();

  // Panel boyu bilerek kamera efektinin bağımlılığı değil: öneri listesi açılıp panel uzayınca
  // kamera kendiliğinden kaymasın, sadece uç noktalar değişince odaklansın. Güncel değeri ref'ten okuyoruz.
  const bottomInsetRef = useRef(bottomInset);
  useEffect(() => {
    bottomInsetRef.current = bottomInset;
  }, [bottomInset]);

  useEffect(() => {
    if (!map) return;
    const padding = {
      top: TOP_INSET,
      bottom: bottomInsetRef.current + 24,
      left: SIDE_INSET,
      right: SIDE_INSET,
    };
    if (from && to) {
      const [a, b] = [toLngLat(from.position), toLngLat(to.position)];
      map.fitBounds(
        [
          [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
          [Math.max(a[0], b[0]), Math.max(a[1], b[1])],
        ],
        { padding, maxZoom: 15, duration: 800 },
      );
    } else if (from ?? to) {
      map.flyTo({
        center: toLngLat((from ?? to)!.position),
        zoom: Math.max(map.getZoom(), 14),
        padding,
        duration: 800,
      });
    }
  }, [map, from, to]);

  const line = useMemo<Feature<LineString> | null>(
    () =>
      from && to
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [toLngLat(from.position), toLngLat(to.position)] },
          }
        : null,
    [from, to],
  );

  return (
    <>
      {line && (
        <Source id="route-line" type="geojson" data={line}>
          <Layer
            id="route-line"
            type="line"
            layout={{ "line-cap": "round" }}
            paint={{ "line-color": "#334155", "line-width": 3, "line-dasharray": [0.5, 2.5], "line-opacity": 0.9 }}
          />
        </Source>
      )}
      {from && <EndpointMarker place={from} label="A" variant="from" />}
      {to && <EndpointMarker place={to} label="B" variant="to" />}
    </>
  );
}

function EndpointMarker({ place, label, variant }: { place: Place; label: string; variant: "from" | "to" }) {
  const [longitude, latitude] = toLngLat(place.position);
  return (
    <Marker longitude={longitude} latitude={latitude} anchor="center">
      <span className={`route-endpoint route-endpoint--${variant}`} title={place.name}>
        {label}
      </span>
    </Marker>
  );
}
