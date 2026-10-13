"use client";

import { Layer, Source } from "react-map-gl/maplibre";
import type { ExpressionSpecification } from "maplibre-gl";

import { NETWORK_BY_MODE } from "@/data/transit-network";
import type { LineRef, RailMode } from "@/data/types";
import { LABEL_FONT } from "@/lib/map-config";

/**
 * Görsel hiyerarşi: metro > tramvay (> otobüs, bkz. BusStopsLayer). Kalınlık, istasyon boyutu
 * ve etiketlerin göründüğü yakınlaştırma buna göre.
 * radius/stroke: daire yarıçapı ve kenar kalınlığı (px); toplam çap ≈ 2 × (radius + stroke).
 */
const MODE_STYLE = {
  metro: {
    weight: 5,
    casingWeight: 14,
    station: { radius: 4, stroke: 3, transferRadius: 6, transferStroke: 4, color: "#1f2937" },
    minStationZoom: 0,
    minLabelZoom: 12,
  },
  tram: {
    weight: 3,
    casingWeight: 7,
    station: { radius: 3, stroke: 2, transferRadius: 4, transferStroke: 2.5, color: "#334155" },
    minStationZoom: 0,
    minLabelZoom: 14,
  },
} as const satisfies Record<RailMode, object>;

/**
 * Aynı yolu paylaşan hatları zıt yönlere kaydırarak (line-offset) yan yana gösteriyoruz.
 * Kaydırma çizim yönüne göre; M1/M2 veri betiğinde batı → doğu yazılıyor.
 */
const LINE_OFFSETS: Partial<Record<LineRef, number>> = {
  M1: -MODE_STYLE.metro.weight / 2,
  M2: MODE_STYLE.metro.weight / 2,
};

const OFFSET_EXPRESSION: ExpressionSpecification = [
  "match",
  ["get", "id"],
  ...Object.entries(LINE_OFFSETS).flatMap(([id, offset]) => [id, offset!]),
  0,
] as unknown as ExpressionSpecification;

const IS_LINE: ExpressionSpecification = ["==", ["get", "type"], "line"];
const IS_STATION: ExpressionSpecification = ["==", ["get", "type"], "station"];
const IS_TRANSFER: ExpressionSpecification = ["==", ["get", "transfer"], true];

/** Haritada tıklanabilir istasyon katmanının kimliği */
export const stationLayerId = (mode: RailMode) => `transit-${mode}-stations`;

interface TransitLayerProps {
  mode: RailMode;
  visible: boolean;
  /** Hat çizgileri bu altlık katmanının altına eklenir (sokak adları hattın üstünde kalsın) */
  lineBeforeId?: string;
}

/**
 * Tek bir raylı sistem türünün hatlarını, istasyonlarını ve istasyon adlarını çizer.
 * Katman açılıp kapanınca kaynak silinmiyor, sadece `visibility` değişiyor: böylece türler
 * arası çizim sırası (tramvay < metro) her zaman ilk eklendiği gibi kalıyor.
 */
export default function TransitLayer({ mode, visible, lineBeforeId }: TransitLayerProps) {
  const style = MODE_STYLE[mode];
  const visibility = visible ? "visible" : "none";
  const id = `transit-${mode}`;

  return (
    <Source id={id} type="geojson" data={NETWORK_BY_MODE[mode]}>
      {/* Hattın altındaki beyaz "kılıf": altlıkta çizgiyi belirginleştirir */}
      <Layer
        id={`${id}-casing`}
        type="line"
        beforeId={lineBeforeId}
        filter={IS_LINE}
        layout={{ visibility, "line-cap": "round", "line-join": "round" }}
        paint={{ "line-color": "#ffffff", "line-width": style.casingWeight, "line-opacity": 0.9 }}
      />
      <Layer
        id={`${id}-lines`}
        type="line"
        beforeId={lineBeforeId}
        filter={IS_LINE}
        layout={{ visibility, "line-cap": "round", "line-join": "round" }}
        paint={{
          "line-color": ["get", "color"],
          "line-width": style.weight,
          "line-offset": OFFSET_EXPRESSION,
          "line-opacity": 0.95,
        }}
      />
      <Layer
        id={stationLayerId(mode)}
        type="circle"
        filter={IS_STATION}
        minzoom={style.minStationZoom}
        layout={{ visibility }}
        paint={{
          "circle-color": "#ffffff",
          "circle-radius": ["case", IS_TRANSFER, style.station.transferRadius, style.station.radius],
          "circle-stroke-width": ["case", IS_TRANSFER, style.station.transferStroke, style.station.stroke],
          "circle-stroke-color": style.station.color,
          // Eğik (3D) görünümde daireler yere yatmasın, ekrana dönük kalsın
          "circle-pitch-alignment": "viewport",
        }}
      />
      <Layer
        id={`${id}-labels`}
        type="symbol"
        filter={IS_STATION}
        minzoom={style.minLabelZoom}
        layout={{
          visibility,
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": mode === "metro" ? 12 : 11,
          "text-anchor": "top",
          "text-offset": [0, 0.9],
          "text-max-width": 9,
          "text-optional": true,
        }}
        paint={{ "text-color": "#1e293b", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }}
      />
    </Source>
  );
}
