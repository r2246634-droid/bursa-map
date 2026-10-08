/**
 * Toplu taşıma ağı (graf) — SADECE SUNUCUDA kullanılır (app/api/route).
 *
 *   Düğüm: durak (BURULAŞ durak no; otobüs + metro M1/M2 + tramvay T1–T3 aynı veri setinde)
 *   Kenar: (a) sefer deseni — bir hattın bir yöndeki sıralı durakları ve kalkış saatleri
 *          (b) yürüme — birbirine yakın duraklar arası aktarma
 *
 * Ağ ilk istekte bir kez kurulur ve süreç boyunca bellekte tutulur (~7.700 durak, ~630 desen).
 */
import lineStopsData from "@/data/burulas/line-stops.json";
import schedulesData from "@/data/burulas/schedules.json";
import stationsData from "@/data/burulas/stations.json";
import type { BusDirection, BusStation } from "@/data/types";
import { formatStopName } from "@/lib/burulas";

import { estimateStopOffsets, haversineMeters, parseClock } from "./time";
import type { TransitKind } from "./types";

/* ---- Varsayımlar ---- */

/** Ortalama hız (km/s, durak beklemeleri dahil) */
const SPEED_KMH: Record<TransitKind, number> = { bus: 20, metro: 35, tram: 16 };
/**
 * Duraklar arası kuş uçuşu mesafe × bu katsayı = yol mesafesi. Ardışık duraklar arası medyan
 * ~270 m olduğundan sapma küçüktür; kıvrımlı yolları hafifçe telafi eder.
 */
const ROAD_FACTOR = 1.2;
/** Yürüme hızı (m/s ≈ 4,5 km/s) ve sokak ağı katsayısı (kuş uçuşu → yürüme mesafesi) */
export const WALK_SPEED = 1.25;
export const WALK_FACTOR = 1.25;
/** Bu kuş uçuşu mesafedeki duraklar arasında yürüyerek aktarma yapılabilir */
const TRANSFER_RADIUS_M = 400;

const RAIL_KIND: Record<string, TransitKind> = { M1: "metro", M2: "metro", T1: "tram", T2: "tram", T3: "tram" };

/* ---- Veri yapıları ---- */

export interface Stop {
  id: number;
  name: string;
  lat: number;
  lon: number;
}

export interface Pattern {
  line: string;
  kind: TransitKind;
  direction: BusDirection;
  headsign: string;
  /** Sıralı durak indeksleri (Network.stops içinde) */
  stops: number[];
  /** İlk duraktan her durağa tahmini süre (saniye) — tüm seferler için aynı */
  offsets: number[];
  /** Gün (1–7) → ilk duraktan sıralı kalkış saatleri (saniye) */
  departures: Record<number, number[]>;
}

export interface Footpath {
  to: number;
  meters: number;
  seconds: number;
}

export interface Network {
  stops: Stop[];
  patterns: Pattern[];
  /** Durak → o duraktan geçen desenler ve desendeki sırası (ring hatlarda aynı durak iki kez geçebilir) */
  stopPatterns: { pattern: number; position: number }[][];
  footpaths: Footpath[][];
  /** Bir noktaya kuş uçuşu `radius` metre içindeki duraklar, yakından uzağa */
  nearbyStops(lat: number, lon: number, radius: number): { stop: number; meters: number }[];
}

export const walkSeconds = (straightMeters: number) => (straightMeters * WALK_FACTOR) / WALK_SPEED;

/* ---- Kurulum ---- */

type LineStops = Record<string, Partial<Record<BusDirection, { seq: number; stopId: number }[]>>>;
type Schedules = Record<string, Partial<Record<BusDirection, { from: string; days: Record<string, string[]> }>>>;

/** Yakın durak aramaları için ızgara: hücre ~550 m; arama sadece komşu hücrelere bakar */
const CELL_DEG = 0.005;
const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)}:${Math.floor(lon / CELL_DEG)}`;

function buildNetwork(): Network {
  const stations = stationsData as BusStation[];
  const stops: Stop[] = stations.map((s) => ({ id: s.id, name: formatStopName(s.name).name, lat: s.lat, lon: s.lon }));
  const indexById = new Map(stops.map((s, i) => [s.id, i]));

  const grid = new Map<string, number[]>();
  stops.forEach((s, i) => {
    const key = cellKey(s.lat, s.lon);
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  });

  const nearbyStops = (lat: number, lon: number, radius: number) => {
    // Hücre yüksekliği ~556 m; genişliği enleme göre daralır (Bursa'da ~426 m)
    const cellHeight = CELL_DEG * 111_320;
    const cellWidth = cellHeight * Math.cos(lat * (Math.PI / 180));
    const [spanLat, spanLon] = [Math.ceil(radius / cellHeight), Math.ceil(radius / cellWidth)];
    const [ci, cj] = [Math.floor(lat / CELL_DEG), Math.floor(lon / CELL_DEG)];
    const found: { stop: number; meters: number }[] = [];
    for (let di = -spanLat; di <= spanLat; di++) {
      for (let dj = -spanLon; dj <= spanLon; dj++) {
        for (const i of grid.get(`${ci + di}:${cj + dj}`) ?? []) {
          const meters = haversineMeters({ lat, lon }, stops[i]);
          if (meters <= radius) found.push({ stop: i, meters });
        }
      }
    }
    return found.sort((a, b) => a.meters - b.meters);
  };

  // Sefer desenleri: hat + yön; sefer saati olmayan desenler rotalamada kullanılamaz
  const lineStops = lineStopsData as LineStops;
  const schedules = schedulesData as Schedules;
  const patterns: Pattern[] = [];
  for (const [line, byDirection] of Object.entries(lineStops)) {
    for (const [direction, list] of Object.entries(byDirection) as [BusDirection, { seq: number; stopId: number }[]][]) {
      const days = schedules[line]?.[direction]?.days;
      if (!days || Object.keys(days).length === 0) continue;

      const stopIndices = [...list]
        .sort((a, b) => a.seq - b.seq)
        .map((s) => indexById.get(s.stopId))
        .filter((i): i is number => i !== undefined); // koordinatı bozuk olduğu için çıkarılan duraklar
      if (stopIndices.length < 2) continue;

      const kind = RAIL_KIND[line] ?? "bus";
      patterns.push({
        line,
        kind,
        direction,
        headsign: stops[stopIndices.at(-1)!].name,
        stops: stopIndices,
        offsets: estimateStopOffsets(
          stopIndices.map((i) => stops[i]),
          { speedKmh: SPEED_KMH[kind], roadFactor: ROAD_FACTOR },
        ),
        departures: Object.fromEntries(
          Object.entries(days).map(([day, times]) => [Number(day), times.map(parseClock).sort((a, b) => a - b)]),
        ),
      });
    }
  }

  const stopPatterns: Network["stopPatterns"] = stops.map(() => []);
  patterns.forEach((p, pattern) => p.stops.forEach((stop, position) => stopPatterns[stop].push({ pattern, position })));

  // Yürüyerek aktarma: sadece en az bir desenin geçtiği duraklar arasında
  const served = new Set(patterns.flatMap((p) => p.stops));
  const footpaths: Footpath[][] = stops.map(() => []);
  for (const i of served) {
    for (const { stop, meters } of nearbyStops(stops[i].lat, stops[i].lon, TRANSFER_RADIUS_M)) {
      if (stop !== i && served.has(stop)) footpaths[i].push({ to: stop, meters, seconds: walkSeconds(meters) });
    }
  }

  return { stops, patterns, stopPatterns, footpaths, nearbyStops };
}

let network: Network | null = null;

/** Ağı ilk çağrıda kurar, sonra bellekteki kopyayı döndürür */
export function getNetwork(): Network {
  network ??= buildNetwork();
  return network;
}
