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
  | (PlaceBase & { kind: "feature"; category: string })
  /**
   * BURULAŞ otobüs hattı. position: güzergâhın sınır kutusunun ortası (seçilince kamera
   * fitBounds ile tüm hattı kapsar, bu nokta sadece yedek).
   */
  | (PlaceBase & { kind: "line"; layer: LayerId; line: BusLine });

/* ---- BURULAŞ otobüs veri seti (data/burulas, scripts/build-bus-dataset.mjs) ---- */

/** G = gidiş, D = dönüş, R = ring (tek yönlü dairesel hat) */
export type BusDirection = "G" | "D" | "R";

export interface BusLine {
  /** Servisteki hat numarası */
  id: number;
  /** Hat kodu, ör. "22C" — BURULAŞ'ta "B1"/"B2" otobüs hattıdır, metro değil */
  code: string;
  name: string;
  stopCount: Partial<Record<BusDirection, number>>;
  /** Her yönün [ilk durak, son durak] adı (ham, büyük harf) */
  termini: Partial<Record<BusDirection, [string, string]>>;
  hasShape: boolean;
}

export interface BusStation {
  id: number;
  /** Ham ad, ör. "VAKIFKÖY MERKEZ 1 (D2993)" */
  name: string;
  lat: number;
  lon: number;
  /** Duraktan geçen hat kodları */
  lines: string[];
}

/** public/data/burulas/shapes/index.json girdisi (scripts/split-shapes.mjs) */
export interface BusShapeIndexEntry {
  file: string;
  directions: BusDirection[];
  points: number;
  stops: number;
  /** [batı, güney, doğu, kuzey] */
  bbox: [number, number, number, number];
}
