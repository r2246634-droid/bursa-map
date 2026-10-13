"use client";

import { useEffect, useMemo, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";

import { LAYER_BY_ID, LAYERS } from "@/data/layers";
import type { LayerId } from "@/data/types";
import { loadAmenities, NEARBY_RADIUS_M, type AmenityData, type AmenityPlace } from "@/lib/amenities";
import { LABEL_FONT, toLngLat } from "@/lib/map-config";
import { ensureAmenityPlacesLoaded } from "@/lib/place-search";

export const AMENITY_LAYER_ID = "amenities";

/** Bundan uzakta hiçbir şey çizilmez, veri de yüklenmez (şehir ölçeğinde binlerce nokta anlamsız) */
const NEARBY_MIN_ZOOM = 13;
/** Bundan yakında ~1 km sınırı kalkar, ekrandaki tüm yerler çizilir */
const FULL_VIEW_ZOOM = 15.5;
const MIN_LABEL_ZOOM = 16;

const NEARBY_LAYERS = LAYERS.filter((l) => l.nearby).map((l) => l.id);

interface View {
  zoom: number;
  /** [enlem, boylam] */
  center: [number, number];
  /** [batı, güney, doğu, kuzey] */
  bounds: [number, number, number, number];
}

/**
 * Çevredeki yerler (market, okul, eczane, cami, park, banka/ATM, PTT).
 *
 * Binlerce noktanın hepsi haritaya verilmez: kamera her durduğunda
 *  - zoom < 13: hiçbiri,
 *  - 13 ≤ zoom < 15,5: harita merkezinin 1 km çevresindekiler,
 *  - zoom ≥ 15,5: ekranda görünenlerin hepsi
 * hesaplanıp kaynağa sadece o birkaç yüz nokta yazılır. Veri ilk kez 13. seviyeye
 * yaklaşınca yüklenir. Aranıp seçilen yer ayrıca kırmızı iğneyle her zoomda görünür.
 */
export default function AmenityLayer({ visibleLayers }: { visibleLayers: Set<LayerId> }) {
  const { current: map } = useMap();
  const [view, setView] = useState<View | null>(null);
  const [data, setData] = useState<AmenityData | null>(null);

  const activeLayers = useMemo(() => NEARBY_LAYERS.filter((id) => visibleLayers.has(id)), [visibleLayers]);
  const wanted = view !== null && view.zoom >= NEARBY_MIN_ZOOM && activeLayers.length > 0;

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const center = map.getCenter();
      const b = map.getBounds();
      setView({
        zoom: map.getZoom(),
        center: [center.lat, center.lng],
        bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      });
    };
    update();
    map.on("moveend", update);
    return () => {
      map.off("moveend", update);
    };
  }, [map]);

  useEffect(() => {
    if (!wanted || data) return;
    let cancelled = false;
    // Arama/tıklama indeksine de eklensin: haritada görünen yere dokunulunca bilgi kartı açılır
    void ensureAmenityPlacesLoaded();
    loadAmenities()
      .then((d) => !cancelled && setData(d))
      .catch((error: unknown) => console.error("Çevredeki yerler yüklenemedi", error));
    return () => {
      cancelled = true;
    };
  }, [wanted, data]);

  const geojson = useMemo<FeatureCollection<Point>>(() => {
    let places: AmenityPlace[] = [];
    if (data && view && wanted) {
      places =
        view.zoom >= FULL_VIEW_ZOOM ? data.inBounds(view.bounds) : data.near(view.center, NEARBY_RADIUS_M);
    }
    const active = new Set(activeLayers);
    return {
      type: "FeatureCollection",
      features: places
        .filter((p) => active.has(p.layer))
        .map((p) => ({
          type: "Feature",
          properties: {
            id: p.id,
            // Adsız yerde ("Park") etiket yazılmaz, sadece nokta
            label: p.name === p.category ? "" : p.name,
            color: LAYER_BY_ID[p.layer].color,
          },
          geometry: { type: "Point", coordinates: toLngLat(p.position) },
        })),
    };
  }, [data, wanted, view, activeLayers]);

  if (!data) return null;

  return (
    <Source id="amenities" type="geojson" data={geojson}>
      <Layer
        id={AMENITY_LAYER_ID}
        type="circle"
        paint={{
          "circle-color": ["get", "color"],
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 13, 4, 17, 6.5],
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
          "circle-pitch-alignment": "viewport",
        }}
      />
      <Layer
        id={`${AMENITY_LAYER_ID}-labels`}
        type="symbol"
        minzoom={MIN_LABEL_ZOOM}
        layout={{
          "text-field": ["get", "label"],
          "text-font": LABEL_FONT,
          "text-size": 11,
          "text-anchor": "top",
          "text-offset": [0, 0.8],
          "text-max-width": 9,
          "text-optional": true,
        }}
        paint={{ "text-color": "#334155", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }}
      />
    </Source>
  );
}
