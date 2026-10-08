import bursarayData from "./bursaray.json";
import {
  isTransitLine,
  isTransitStation,
  type RailMode,
  type TransitMode,
  type TransitNetwork,
} from "./types";

/**
 * Raylı sistem ağı (OSM, scripts/fetch-bursaray.mjs). Otobüs verisi BURULAŞ veri setinden
 * ayrıca ve tembel olarak yüklenir (lib/burulas.ts).
 */
// JSON importu geniş tiplerle gelir; şeklini scripts/fetch-bursaray.mjs garanti ediyor
const rail = bursarayData as unknown as TransitNetwork;

const ALL_FEATURES = rail.features;

export const TRANSIT_LINES = ALL_FEATURES.filter(isTransitLine);
export const TRANSIT_STATIONS = ALL_FEATURES.filter(isTransitStation);

/** Haritada her tür ayrı katman olarak çizildiği için türe göre ayrılmış koleksiyonlar */
export const NETWORK_BY_MODE = Object.fromEntries(
  (["metro", "tram"] as const).map((mode) => [
    mode,
    {
      type: "FeatureCollection",
      features: ALL_FEATURES.filter((f) => f.properties.mode === mode),
    } satisfies TransitNetwork,
  ]),
) as Record<RailMode, TransitNetwork>;

/** Hat numarası → renk / güzergâh adı (otobüs hat numaraları açık uçlu olduğundan string anahtar) */
export const LINE_COLORS: Readonly<Record<string, string>> = Object.fromEntries(
  TRANSIT_LINES.map((f) => [f.properties.id, f.properties.color]),
);

export const LINE_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  TRANSIT_LINES.map((f) => [f.properties.id, f.properties.name]),
);

export const STATION_LABEL: Readonly<Record<TransitMode, string>> = {
  metro: "Metro istasyonu",
  tram: "Tramvay durağı",
  bus: "Otobüs durağı",
};
