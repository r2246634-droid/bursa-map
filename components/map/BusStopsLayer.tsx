"use client";

import { useEffect, useState } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";

import { loadBusData } from "@/lib/burulas";
import { LABEL_FONT } from "@/lib/map-config";

export const BUS_STOPS_LAYER_ID = "bus-stops";

/** Duraklar kalabalık yapmasın diye sadece mahalle ölçeğinde görünür */
const MIN_STOP_ZOOM = 14.5;
const MIN_LABEL_ZOOM = 16.5;

/**
 * Tüm BURULAŞ otobüs durakları (~7.500 nokta). Veri, katman ilk kez çizildiğinde tembel
 * yüklenir; MapLibre bu kadar noktayı GPU'da rahat çizer.
 */
export default function BusStopsLayer({ visible }: { visible: boolean }) {
  const [data, setData] = useState<FeatureCollection<Point> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBusData()
      .then(({ stopPlaces }) => {
        if (cancelled) return;
        setData({
          type: "FeatureCollection",
          features: stopPlaces.map((p) => ({
            type: "Feature",
            properties: { id: p.id, name: p.name },
            geometry: { type: "Point", coordinates: [p.position[1], p.position[0]] },
          })),
        });
      })
      .catch((error: unknown) => console.error("Otobüs durakları yüklenemedi", error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;
  const visibility = visible ? "visible" : "none";

  return (
    <Source id="bus-stops" type="geojson" data={data}>
      <Layer
        id={BUS_STOPS_LAYER_ID}
        type="circle"
        minzoom={MIN_STOP_ZOOM}
        layout={{ visibility }}
        paint={{
          "circle-color": "#ffffff",
          "circle-radius": 3,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#6d28d9",
          "circle-pitch-alignment": "viewport",
        }}
      />
      <Layer
        id="bus-stop-labels"
        type="symbol"
        minzoom={MIN_LABEL_ZOOM}
        layout={{
          visibility,
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 10.5,
          "text-anchor": "top",
          "text-offset": [0, 0.7],
          "text-max-width": 8,
          "text-optional": true,
        }}
        paint={{ "text-color": "#4c1d95", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }}
      />
    </Source>
  );
}
