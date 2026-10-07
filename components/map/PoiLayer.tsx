"use client";

import { useMemo } from "react";
import { Layer, Source } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import type { ExpressionSpecification } from "maplibre-gl";

import { LAYER_BY_ID } from "@/data/layers";
import type { LayerId, PointOfInterest } from "@/data/types";
import { LABEL_FONT, toLngLat } from "@/lib/map-config";

export const POI_LAYER_ID = "app-pois";

interface PoiLayerProps {
  pois: PointOfInterest[];
  visibleLayers: Set<LayerId>;
}

/** Uygulamanın öne çıkan noktaları (kampüs, AVM, otogar, aktarma merkezi): renkli daire + ad */
export default function PoiLayer({ pois, visibleLayers }: PoiLayerProps) {
  const data = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: pois.map((poi) => ({
        type: "Feature",
        properties: { id: poi.id, name: poi.name, layer: poi.layer, color: LAYER_BY_ID[poi.layer].color },
        geometry: { type: "Point", coordinates: toLngLat(poi.position) },
      })),
    }),
    [pois],
  );

  const filter: ExpressionSpecification = ["in", ["get", "layer"], ["literal", [...visibleLayers]]];

  return (
    <Source id="app-pois" type="geojson" data={data}>
      <Layer
        id={POI_LAYER_ID}
        type="circle"
        filter={filter}
        paint={{
          "circle-color": ["get", "color"],
          "circle-radius": 8,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#ffffff",
          "circle-pitch-alignment": "viewport",
        }}
      />
      <Layer
        id={`${POI_LAYER_ID}-labels`}
        type="symbol"
        filter={filter}
        minzoom={12}
        layout={{
          "text-field": ["get", "name"],
          "text-font": LABEL_FONT,
          "text-size": 12,
          "text-anchor": "top",
          "text-offset": [0, 1.1],
          "text-max-width": 10,
          "text-optional": true,
        }}
        paint={{ "text-color": "#0f172a", "text-halo-color": "#ffffff", "text-halo-width": 1.5 }}
      />
    </Source>
  );
}
