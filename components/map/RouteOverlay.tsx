"use client";

import { useEffect, useMemo, useRef } from "react";
import { Layer, Marker, Source, useMap } from "react-map-gl/maplibre";
import type { FeatureCollection, LineString } from "geojson";

import type { Place } from "@/data/types";
import { cameraDuration, toLngLat } from "@/lib/map-config";
import { rideColor } from "@/lib/routing/client";
import type { Journey } from "@/lib/routing/types";

export interface RouteEndpoints {
  from: Place | null;
  to: Place | null;
}

interface RouteOverlayProps extends RouteEndpoints {
  /** Seçili yol tarifi seçeneği; yoksa (hesaplanıyor/bulunamadı) kuş uçuşu çizgi gösterilir */
  journey: Journey | null;
  /** Haritanın altını kaplayan panelin yüksekliği (px); kamera bu alanı boş bırakır */
  bottomInset: number;
}

/** Üstteki arama/katman butonu satırının kapladığı alan */
const TOP_INSET = 88;
const SIDE_INSET = 40;

type LegProps = { kind: "walk" | "ride"; color: string };

/**
 * Yol tarifi: A/B işaretleri ve seçili seçeneğin bacakları — araç bacakları hat renginde,
 * yürüyüşler noktalı gri. Seçenek gelmeden önce kuş uçuşu kesik çizgi gösterilir.
 */
export default function RouteOverlay({ from, to, journey, bottomInset }: RouteOverlayProps) {
  const { current: map } = useMap();

  // Panel boyu bilerek kamera efektinin bağımlılığı değil: öneri listesi açılıp panel uzayınca
  // kamera kendiliğinden kaymasın, sadece uç noktalar/seçenek değişince odaklansın.
  const bottomInsetRef = useRef(bottomInset);
  useEffect(() => {
    bottomInsetRef.current = bottomInset;
  }, [bottomInset]);

  const legs = useMemo<FeatureCollection<LineString, LegProps> | null>(() => {
    if (from && to && !journey) {
      return {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { kind: "walk", color: "#334155" },
            geometry: { type: "LineString", coordinates: [toLngLat(from.position), toLngLat(to.position)] },
          },
        ],
      };
    }
    if (!journey) return null;
    return {
      type: "FeatureCollection",
      features: journey.legs.map((leg) => ({
        type: "Feature",
        properties:
          leg.type === "ride" ? { kind: "ride", color: rideColor(leg) } : { kind: "walk", color: "#475569" },
        geometry: {
          type: "LineString",
          coordinates: leg.type === "ride" ? leg.path : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]],
        },
      })),
    };
  }, [from, to, journey]);

  useEffect(() => {
    if (!map) return;
    // Panel ekranın çoğunu kaplayabilir (seçenek listesi uzayınca). Alt boşluk haritanın tamamını
    // yerse MapLibre fitBounds'u sessizce atlar; rota için en az ~120 px yükseklik bırakılır.
    const mapHeight = map.getContainer().clientHeight;
    const bottom = Math.min(bottomInsetRef.current + 24, Math.max(0, mapHeight - TOP_INSET - 120));
    const padding = { top: TOP_INSET, bottom, left: SIDE_INSET, right: SIDE_INSET };
    const coords = legs?.features.flatMap((f) => f.geometry.coordinates) ?? [];
    if (coords.length >= 2) {
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      map.fitBounds(
        [
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)],
        ],
        { padding, maxZoom: 15, duration: cameraDuration(800) },
      );
    } else if (from ?? to) {
      map.flyTo({
        center: toLngLat((from ?? to)!.position),
        zoom: Math.max(map.getZoom(), 14),
        padding,
        duration: cameraDuration(800),
      });
    }
  }, [map, from, to, legs]);

  return (
    <>
      {legs && (
        <Source id="route-legs" type="geojson" data={legs}>
          <Layer
            id="route-ride-casing"
            type="line"
            filter={["==", ["get", "kind"], "ride"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": "#ffffff", "line-width": 10 }}
          />
          <Layer
            id="route-ride"
            type="line"
            filter={["==", ["get", "kind"], "ride"]}
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": ["get", "color"], "line-width": 6 }}
          />
          <Layer
            id="route-walk"
            type="line"
            filter={["==", ["get", "kind"], "walk"]}
            layout={{ "line-cap": "round" }}
            paint={{
              "line-color": ["get", "color"],
              "line-width": 3,
              "line-dasharray": [0.5, 2],
              "line-opacity": 0.9,
            }}
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
