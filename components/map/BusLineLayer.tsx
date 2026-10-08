"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Layer, Source, useMap } from "react-map-gl/maplibre";
import type { FeatureCollection, LineString, MultiPolygon } from "geojson";

import type { BusLine } from "@/data/types";
import { BUS_LINE_COLOR, formatStopName, loadLineShape, type BusLineShape } from "@/lib/burulas";
import { lineToRibbon } from "@/lib/geo";
import { cameraDuration, LABEL_FONT } from "@/lib/map-config";

/** Haritada tıklanabilir durak katmanı (MapView interactiveLayerIds için) */
export const BUS_LINE_STOPS_LAYER_ID = "bus-line-stops";

/** 3D şeridin ölçüleri (metre): sokak seviyesinin biraz üstünde süzülen ince bir bant */
const RIBBON = { width: 8, base: 10, height: 14 };

interface BusLineLayerProps {
  line: BusLine;
  /** Kamera hattı kapsarken alttaki bilgi kartının arkasında bırakılmayacak alan (px) */
  bottomInset: number;
  onError?: (message: string) => void;
}

/**
 * Seçilen otobüs hattını, sadece o hattın dosyasını indirerek çizer:
 *  - düz görünüm için kalın bir çizgi (line),
 *  - eğik (3D) görünüm için yükseltilmiş şerit (fill-extrusion),
 *  - hattın durakları ve adları.
 * Güzergâh yüklenince kamera fitBounds ile tüm hattı kapsar.
 */
export default function BusLineLayer({ line, bottomInset, onError }: BusLineLayerProps) {
  const { current: map } = useMap();
  const [loaded, setLoaded] = useState<{ code: string; shape: BusLineShape } | null>(null);
  const bottomInsetRef = useRef(bottomInset);
  useEffect(() => {
    bottomInsetRef.current = bottomInset;
  }, [bottomInset]);

  useEffect(() => {
    let cancelled = false;
    loadLineShape(line.code)
      .then(({ entry, shape }) => {
        if (cancelled) return;
        setLoaded({ code: line.code, shape });
        const [west, south, east, north] = entry.bbox;
        map?.fitBounds(
          [
            [west, south],
            [east, north],
          ],
          {
            padding: { top: 96, bottom: bottomInsetRef.current + 24, left: 40, right: 40 },
            maxZoom: 15,
            duration: cameraDuration(900),
          },
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) onError?.(`${line.code} hattının güzergâhı yüklenemedi`);
        console.error(error);
      });
    return () => {
      cancelled = true;
    };
  }, [map, line.code, onError]);

  // Başka hat seçilip yenisi henüz inmediyse eskisini çizmeye devam etme.
  // Durak adları dosyada ham ("VAKIFKÖY MERKEZ 1 (D2993)"); etiket için biçimlendiriyoruz.
  const rawShape = loaded?.code === line.code ? loaded.shape : null;
  const shape = useMemo<BusLineShape | null>(
    () =>
      rawShape && {
        ...rawShape,
        features: rawShape.features.map((f) =>
          f.properties.kind === "stop"
            ? { ...f, properties: { ...f.properties, name: formatStopName(f.properties.name).name } }
            : f,
        ),
      },
    [rawShape],
  );

  const ribbon = useMemo<FeatureCollection<MultiPolygon> | null>(() => {
    if (!shape) return null;
    return {
      type: "FeatureCollection",
      features: shape.features
        .filter((f): f is typeof f & { geometry: LineString } => f.geometry.type === "LineString")
        .map((f) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "MultiPolygon", coordinates: lineToRibbon(f.geometry.coordinates, RIBBON.width) },
        })),
    };
  }, [shape]);

  if (!shape || !ribbon) return null;

  return (
    <>
      <Source id="bus-line" type="geojson" data={shape}>
        <Layer
          id="bus-line-casing"
          type="line"
          filter={["==", ["get", "kind"], "route"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.9 }}
        />
        <Layer
          id="bus-line-route"
          type="line"
          filter={["==", ["get", "kind"], "route"]}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{ "line-color": BUS_LINE_COLOR, "line-width": 5 }}
        />
        <Layer
          id={BUS_LINE_STOPS_LAYER_ID}
          type="circle"
          filter={["==", ["get", "kind"], "stop"]}
          paint={{
            "circle-color": "#ffffff",
            "circle-radius": 4,
            "circle-stroke-width": 2.5,
            "circle-stroke-color": BUS_LINE_COLOR,
            "circle-pitch-alignment": "viewport",
          }}
        />
        <Layer
          id="bus-line-stop-labels"
          type="symbol"
          filter={["==", ["get", "kind"], "stop"]}
          minzoom={14}
          layout={{
            "text-field": ["get", "name"],
            "text-font": LABEL_FONT,
            "text-size": 11,
            "text-anchor": "top",
            "text-offset": [0, 0.8],
            "text-max-width": 9,
            "text-optional": true,
          }}
          paint={{ "text-color": "#3b0764", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }}
        />
      </Source>

      {/* 3D: eğik görünümde binaların arasında süzülen şerit */}
      <Source id="bus-line-ribbon" type="geojson" data={ribbon}>
        <Layer
          id="bus-line-ribbon"
          type="fill-extrusion"
          minzoom={12}
          paint={{
            "fill-extrusion-color": BUS_LINE_COLOR,
            "fill-extrusion-base": RIBBON.base,
            "fill-extrusion-height": RIBBON.height,
            "fill-extrusion-opacity": 0.75,
          }}
        />
      </Source>
    </>
  );
}
