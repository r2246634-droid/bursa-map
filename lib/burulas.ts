import type { FeatureCollection, LineString, Point } from "geojson";

import type { BusDirection, BusLine, BusShapeIndexEntry, BusStation, Place } from "@/data/types";

import { BURSA_BOUNDS } from "./map-config";

/**
 * BURULAŞ otobüs veri setine uygulama içinden erişim.
 *
 * Boyutlar: stations.json ~0,8 MB, lines.json ~40 KB. İlk açılışı yavaşlatmamak için
 * ana pakete gömülmez; `import()` ile ayrı bir parça olarak ilk ihtiyaçta (arama kutusuna
 * odaklanma, otobüs katmanı) yüklenir. Hat güzergâhları ise hat başına ayrı dosyalardan
 * (public/data/burulas/shapes, scripts/split-shapes.mjs) sadece seçilen hat için indirilir.
 */

/** Metro (M1/M2) ve tramvay (T1–T3) OSM verisiyle zaten çiziliyor; otobüs tarafında atlanır */
const RAIL_CODES = new Set(["M1", "M2", "T1", "T2", "T3"]);

export const DIRECTION_LABEL: Record<BusDirection, string> = { G: "Gidiş", D: "Dönüş", R: "Ring" };
export const DIRECTION_ORDER: BusDirection[] = ["G", "D", "R"];

/** Seçilen otobüs hattının haritadaki rengi */
export const BUS_LINE_COLOR = "#7c3aed";

export const busLinePlaceId = (code: string) => `bus-line-${code}`;
export const busStopPlaceId = (stationId: number) => `bus-stop-${stationId}`;

/* ---- Ad biçimlendirme ---- */

/** Büyük harfle kalması gereken kısaltmalar */
const ACRONYMS = new Set(["PTT", "SGK", "BTÜ", "BUÜ", "OSB", "AVM", "TOKİ", "DSİ", "TCDD", "YH", "MKP", "TRT", "BUSKİ"]);

/**
 * "VAKIFKÖY MERKEZ 1 (D2993)" → { name: "Vakıfköy Merkez 1", code: "D2993" }
 * "T1-HEYKEL (B65)"           → { name: "T1-Heykel", code: "B65" }
 * Türkçe büyük/küçük harf kuralı (I/ı, İ/i) ile kelime başları büyük yazılır.
 */
export function formatStopName(raw: string): { name: string; code: string | null } {
  const match = raw.match(/^(.*?)\s*\(([A-Z]\d[\w-]*)\)\s*$/);
  const base = (match ? match[1] : raw).replace(/\s+/g, " ").trim();
  const name = base.replace(/[^\s\-/.()]+/g, (word) => {
    if (ACRONYMS.has(word) || /\d/.test(word)) return word;
    const lower = word.toLocaleLowerCase("tr-TR");
    return lower.charAt(0).toLocaleUpperCase("tr-TR") + lower.slice(1);
  });
  return { name, code: match ? match[2] : null };
}

/** "Vakıfköy Merkez 1 → Sondurak (Yıldırım)" */
export function lineRouteSummary(line: BusLine): string {
  const dir = DIRECTION_ORDER.find((d) => line.termini[d]);
  if (!dir) return "";
  const [from, to] = line.termini[dir]!;
  return `${formatStopName(from).name} → ${formatStopName(to).name}`;
}

/* ---- Tembel yükleme ---- */

export interface BusData {
  lines: BusLine[];
  stations: BusStation[];
  linePlaces: Place[];
  stopPlaces: Place[];
  /** Hat kodu → hat (sadece otobüs hatları) */
  lineByCode: Map<string, BusLine>;
}

const [west, south, east, north] = BURSA_BOUNDS;
const insideMap = (s: BusStation) => s.lat >= south && s.lat <= north && s.lon >= west && s.lon <= east;

let busDataPromise: Promise<BusData> | null = null;

export function loadBusData(): Promise<BusData> {
  busDataPromise ??= Promise.all([
    import("@/data/burulas/lines.json"),
    import("@/data/burulas/stations.json"),
  ])
    .then(([linesModule, stationsModule]) => {
      const lines = (linesModule.default as BusLine[]).filter((l) => l.hasShape && !RAIL_CODES.has(l.code));
      const lineByCode = new Map(lines.map((l) => [l.code, l]));

      // Haritada gösterilecek duraklar: harita sınırı içinde ve en az bir otobüs hattı geçen
      const stations = (stationsModule.default as BusStation[])
        .map((s) => ({ ...s, lines: s.lines.filter((code) => lineByCode.has(code)) }))
        .filter((s) => s.lines.length > 0 && insideMap(s));

      const stopPlaces: Place[] = stations.map((s) => {
        const { name, code } = formatStopName(s.name);
        return {
          kind: "station",
          id: busStopPlaceId(s.id),
          name,
          position: [s.lat, s.lon],
          layer: "bus",
          mode: "bus",
          lines: s.lines,
          transfer: false,
          aliases: code ? [code] : undefined,
        };
      });

      const linePlaces: Place[] = lines.map((line) => ({
        kind: "line",
        id: busLinePlaceId(line.code),
        name: line.code,
        // Gerçek konum seçilince güzergâhın sınır kutusundan gelir (fitBounds)
        position: [(south + north) / 2, (west + east) / 2],
        layer: "bus",
        line,
        aliases: [lineRouteSummary(line)],
      }));

      return { lines, stations, linePlaces, stopPlaces, lineByCode };
    })
    .catch((error) => {
      busDataPromise = null; // bir sonraki denemede tekrar yüklensin
      throw error;
    });
  return busDataPromise;
}

/* ---- Hat güzergâhı (hat başına dosya) ---- */

const SHAPES_BASE = "/data/burulas/shapes/";

export type BusLineShape = FeatureCollection<
  LineString | Point,
  | { kind: "route"; code: string; direction: BusDirection }
  | { kind: "stop"; id: string; name: string; directions: BusDirection[]; seq: number }
>;

let shapeIndexPromise: Promise<Record<string, BusShapeIndexEntry>> | null = null;
const shapeCache = new Map<string, Promise<{ entry: BusShapeIndexEntry; shape: BusLineShape }>>();

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function loadShapeIndex() {
  shapeIndexPromise ??= fetchJson<Record<string, BusShapeIndexEntry>>(`${SHAPES_BASE}index.json`).catch(
    (error) => {
      shapeIndexPromise = null;
      throw error;
    },
  );
  return shapeIndexPromise;
}

/**
 * Seçilen hattın güzergâhını ve duraklarını indirir (~10–80 KB). Aynı hat için ikinci istek
 * önbellekten döner; PWA service worker'ı da dosyayı çevrimdışı kullanım için saklar.
 */
export function loadLineShape(code: string) {
  let cached = shapeCache.get(code);
  if (!cached) {
    cached = loadShapeIndex()
      .then(async (index) => {
        const entry = index[code];
        if (!entry) throw new Error(`${code} hattının güzergâh dosyası yok`);
        const shape = await fetchJson<BusLineShape>(SHAPES_BASE + entry.file);
        return { entry, shape };
      })
      .catch((error) => {
        shapeCache.delete(code);
        throw error;
      });
    shapeCache.set(code, cached);
  }
  return cached;
}
