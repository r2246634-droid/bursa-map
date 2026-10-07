"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import { useCallback, useEffect, useState } from "react";
import MapGL, {
  GeolocateControl,
  Marker,
  NavigationControl,
  useMap,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import { setWorkerUrl, type Map as MaplibreMap } from "maplibre-gl";
import { MapPin } from "lucide-react";

import { PLACE_BY_ID } from "@/data/places";
import type { LayerId, Place, PointOfInterest, TransitMode } from "@/data/types";
import {
  BASEMAP_POI_LAYERS,
  BURSA_BOUNDS,
  BURSA_CENTER,
  MAP_STYLE_URL,
  MAP_ZOOM,
  MAPLIBRE_WORKER_URL,
  MAX_PITCH,
  PITCH_3D,
  toLngLat,
} from "@/lib/map-config";
import { placeFromBasemapPoi } from "@/lib/map-features";

import PoiLayer, { POI_LAYER_ID } from "./PoiLayer";
import RouteOverlay, { type RouteEndpoints } from "./RouteOverlay";
import TransitLayer, { stationLayerId } from "./TransitLayer";

// Next.js paketlemesinde MapLibre worker'ın varsayılan adresi bozuluyor; public/ kopyasını kullan.
// Bu modül sadece tarayıcıda yüklenir (Map.tsx → next/dynamic, ssr: false).
setWorkerUrl(MAPLIBRE_WORKER_URL);

/** Çizim sırası: önce eklenen altta kalır → otobüs < tramvay < metro */
const TRANSIT_MODES: TransitMode[] = ["bus", "tram", "metro"];

export interface MapViewProps {
  pois: PointOfInterest[];
  visibleLayers: Set<LayerId>;
  selectedPlace: Place | null;
  /** Rota modu açıkken uç noktalar; kapalıyken null */
  route: RouteEndpoints | null;
  /** Haritanın altını kaplayan panelin yüksekliği (px) */
  bottomInset: number;
  /** Haritada bir istasyona, noktaya veya altlıktaki bir yere dokunuldu */
  onPlaceClick: (place: Place) => void;
  /** Haritada boş bir yere dokunuldu ([enlem, boylam]) */
  onEmptyClick: (position: [number, number]) => void;
}

/**
 * Altlık etiketleri varsayılan olarak İngilizce adı (name_en) tercih ediyor;
 * Türkçe/yerel adı öne alıyoruz. Yol numarası kalkanları gibi `ref` kullanan etiketlere dokunmuyoruz.
 */
function localizeLabels(map: MaplibreMap) {
  for (const layer of map.getStyle().layers) {
    if (layer.type !== "symbol") continue;
    const textField = JSON.stringify(layer.layout?.["text-field"] ?? "");
    if (textField.includes("name_en") || textField.includes("name:latin")) {
      map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:tr"], ["get", "name"]]);
    }
  }
}

/** Seçilen yere kamerayı götürür; alttaki bilgi kartının arkasında kalmasın diye alttan boşluk bırakır */
function FlyToSelected({ place }: { place: Place | null }) {
  const { current: map } = useMap();
  useEffect(() => {
    if (!map || !place) return;
    map.flyTo({
      center: toLngLat(place.position),
      zoom: Math.max(map.getZoom(), MAP_ZOOM.focus),
      padding: { top: 80, bottom: 220, left: 0, right: 0 },
      duration: 800,
    });
  }, [map, place]);
  return null;
}

export default function MapView({
  pois,
  visibleLayers,
  selectedPlace,
  route,
  bottomInset,
  onPlaceClick,
  onEmptyClick,
}: MapViewProps) {
  const [map, setMap] = useState<MapRef | null>(null);
  const [labelLayerId, setLabelLayerId] = useState<string>();
  const [interactiveLayerIds, setInteractiveLayerIds] = useState<string[]>([]);
  const [cursor, setCursor] = useState("grab");
  const [pitched, setPitched] = useState(false);

  /**
   * Stil (JSON) hazır olunca bir kez çalışır. "load" olayını beklemiyoruz: o, ilk karenin
   * çizilmesini (ve karoları) bekler; arka plandaki sekmede çizim durduğu için gecikebiliyor.
   */
  const handleStyleReady = useCallback((m: MaplibreMap) => {
    localizeLabels(m);
    const layers = m.getStyle().layers;
    // Hat çizgileri ilk etiket katmanının altına girsin: sokak/mahalle adları hattın üstünde okunur
    setLabelLayerId(layers.find((l) => l.type === "symbol")?.id);
    // Stil değişirse olmayan katmanı sorgulamamak için altlık POI katmanlarını stilde doğrula
    const basemapPois = BASEMAP_POI_LAYERS.filter((id) => layers.some((l) => l.id === id));
    setInteractiveLayerIds([POI_LAYER_ID, ...TRANSIT_MODES.map(stationLayerId), ...basemapPois]);
  }, []);

  useEffect(() => {
    const m = map?.getMap();
    if (!m) return;
    const init = () => handleStyleReady(m);
    m.once("style.load", init);
    // Ref bağlandığında stil zaten yüklenmiş olabilir (ör. hızlı yenileme)
    if (m.getStyle()?.layers?.length) init();
    return () => {
      m.off("style.load", init);
    };
  }, [map, handleStyleReady]);

  const handleClick = (e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) {
      onEmptyClick([e.lngLat.lat, e.lngLat.lng]);
      return;
    }
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    // Kendi katmanlarımız (istasyon, öne çıkan nokta): kimlikten uygulamadaki yeri bul
    if (!BASEMAP_POI_LAYERS.includes(feature.layer.id) && typeof props.id === "string") {
      const appPlace = PLACE_BY_ID.get(props.id);
      if (appPlace) {
        onPlaceClick(appPlace);
        return;
      }
    }
    const position: [number, number] =
      feature.geometry.type === "Point"
        ? [feature.geometry.coordinates[1], feature.geometry.coordinates[0]]
        : [e.lngLat.lat, e.lngLat.lng];
    const place = placeFromBasemapPoi(props, position);
    if (place) onPlaceClick(place);
    else onEmptyClick(position);
  };

  const toggle3d = () => {
    map?.easeTo({ pitch: pitched ? 0 : PITCH_3D, bearing: pitched ? 0 : -17, duration: 800 });
  };

  return (
    <div className="relative h-full w-full">
      <MapGL
        ref={setMap}
        mapStyle={MAP_STYLE_URL}
        initialViewState={{ longitude: BURSA_CENTER[0], latitude: BURSA_CENTER[1], zoom: MAP_ZOOM.initial }}
        minZoom={MAP_ZOOM.min}
        maxZoom={MAP_ZOOM.max}
        maxPitch={MAX_PITCH}
        maxBounds={BURSA_BOUNDS}
        interactiveLayerIds={interactiveLayerIds}
        cursor={cursor}
        onMouseEnter={() => setCursor("pointer")}
        onMouseLeave={() => setCursor("grab")}
        onClick={handleClick}
        onPitchEnd={(e) => setPitched(e.target.getPitch() > 5)}
        attributionControl={{ compact: true }}
        style={{ width: "100%", height: "100%" }}
      >
        <NavigationControl position="bottom-right" visualizePitch />
        <GeolocateControl position="bottom-right" />

        {/* Stil yüklenmeden (labelLayerId bilinmeden) kendi katmanlarımızı eklemiyoruz */}
        {labelLayerId &&
          TRANSIT_MODES.map((mode) => (
            <TransitLayer
              key={mode}
              mode={mode}
              visible={visibleLayers.has(mode)}
              lineBeforeId={labelLayerId}
            />
          ))}
        {labelLayerId && <PoiLayer pois={pois} visibleLayers={visibleLayers} />}

        {selectedPlace && <SelectedMarker place={selectedPlace} />}
        <FlyToSelected place={selectedPlace} />
        {route && <RouteOverlay from={route.from} to={route.to} bottomInset={bottomInset} />}
      </MapGL>

      <button
        type="button"
        onClick={toggle3d}
        aria-pressed={pitched}
        aria-label={pitched ? "Düz (2D) görünüme geç" : "3D görünüme geç"}
        className="glass absolute top-[calc(76px+env(safe-area-inset-top))] right-4 z-10 flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-slate-700 active:scale-95"
      >
        {pitched ? "2D" : "3D"}
      </button>
    </div>
  );
}

function SelectedMarker({ place }: { place: Place }) {
  const [longitude, latitude] = toLngLat(place.position);
  return (
    <Marker longitude={longitude} latitude={latitude} anchor="bottom">
      <MapPin
        className="h-10 w-10 drop-shadow-md"
        fill="#e11d48"
        color="#ffffff"
        strokeWidth={1.5}
        aria-label={place.name}
      />
    </Marker>
  );
}
