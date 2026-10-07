import type { Feature, FeatureCollection, LineString, MultiLineString, Point } from "geojson";

export type LayerId = "metro" | "tram" | "bus" | "transfer" | "campus" | "mall" | "terminal";

export interface LayerDefinition {
  id: LayerId;
  label: string;
  /** Tailwind dışında, Leaflet marker HTML'inde de kullanılacağı için düz hex */
  color: string;
  defaultVisible: boolean;
}

export interface PointOfInterest {
  id: string;
  name: string;
  layer: LayerId;
  position: [number, number];
  description?: string;
  /** Aramada isim dışında eşleşecek halk arasındaki adlar, ör. "otogar" */
  aliases?: string[];
  /** Kaynak OSM öğesi, ör. "way/191171800" */
  osm?: string;
}

/* ---- Toplu taşıma ağı (metro + tramvay + otobüs) GeoJSON tipleri ---- */

export type RailMode = "metro" | "tram";
export type TransitMode = RailMode | "bus";

export type MetroLineRef = "B1" | "B2";
export type TramLineRef = "T1" | "T2" | "T3";
export type RailLineRef = MetroLineRef | TramLineRef;
/** Otobüs hat numaraları açık uçlu ("801", "116C"…), bu yüzden genel tip string */
export type LineRef = RailLineRef | (string & {});

export interface TransitLineProperties {
  type: "line";
  mode: TransitMode;
  id: LineRef;
  /** Güzergâh, ör. "Kestel – Üniversite" */
  name: string;
  /** Hex renk, ör. "#e30613" */
  color: string;
}

export interface TransitStationProperties {
  type: "station";
  mode: TransitMode;
  /** İsimden türetilmiş kararlı kimlik, ör. "metro-bursaspor-acemler" */
  id: string;
  name: string;
  lines: LineRef[];
  /** Hatların ayrım noktası veya farklı türler arası (metro ↔ tramvay ↔ otobüs) aktarma */
  transfer: boolean;
}

export type TransitLineFeature = Feature<LineString | MultiLineString, TransitLineProperties>;
export type TransitStationFeature = Feature<Point, TransitStationProperties>;
export type TransitFeature = TransitLineFeature | TransitStationFeature;

export type TransitNetwork = FeatureCollection<
  LineString | MultiLineString | Point,
  TransitLineProperties | TransitStationProperties
> & { attribution?: string; generatedAt?: string };

export const isTransitLine = (f: Feature | undefined): f is TransitLineFeature =>
  f?.properties?.type === "line";

export const isTransitStation = (f: Feature | undefined): f is TransitStationFeature =>
  f?.properties?.type === "station";

export const isTramLine = (f: Feature | undefined): f is TransitLineFeature =>
  isTransitLine(f) && f.properties.mode === "tram";

export const isTramStation = (f: Feature | undefined): f is TransitStationFeature =>
  isTransitStation(f) && f.properties.mode === "tram";

export const isBusLine = (f: Feature | undefined): f is TransitLineFeature =>
  isTransitLine(f) && f.properties.mode === "bus";

export const isBusStop = (f: Feature | undefined): f is TransitStationFeature =>
  isTransitStation(f) && f.properties.mode === "bus";

/* ---- Arama / seçim ---- */

interface PlaceBase {
  id: string;
  name: string;
  /** [enlem, boylam] — MapLibre'ye verirken lib/map-config.ts içindeki toLngLat ile çevrilir */
  position: [number, number];
  aliases?: string[];
}

export type Place =
  | (PlaceBase & { kind: "poi"; layer: LayerId })
  | (PlaceBase & {
      kind: "station";
      layer: LayerId;
      mode: TransitMode;
      lines: LineRef[];
      transfer: boolean;
    })
  /** Altlık haritadan dokunularak seçilen yer (dükkân, okul…) veya boş bir noktaya bırakılan iğne */
  | (PlaceBase & { kind: "feature"; category: string });
