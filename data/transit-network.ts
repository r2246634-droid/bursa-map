import bursarayData from "./bursaray.json";
import busData from "./bus.json";
import {
  isTransitLine,
  isTransitStation,
  type TransitMode,
  type TransitNetwork,
} from "./types";

// JSON importları geniş tiplerle gelir; şekillerini scripts/fetch-*.mjs betikleri garanti ediyor
const rail = bursarayData as unknown as TransitNetwork;
const bus = busData as unknown as TransitNetwork;

const ALL_FEATURES = [...rail.features, ...bus.features];

export const TRANSIT_LINES = ALL_FEATURES.filter(isTransitLine);
export const TRANSIT_STATIONS = ALL_FEATURES.filter(isTransitStation);

/** Haritada her tür ayrı katman olarak çizildiği için türe göre ayrılmış koleksiyonlar */
export const NETWORK_BY_MODE = Object.fromEntries(
  (["metro", "tram", "bus"] as const).map((mode) => [
    mode,
    {
      type: "FeatureCollection",
      features: ALL_FEATURES.filter((f) => f.properties.mode === mode),
    } satisfies TransitNetwork,
  ]),
) as Record<TransitMode, TransitNetwork>;

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
