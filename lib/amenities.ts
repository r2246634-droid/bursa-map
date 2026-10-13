import type { LayerId, Place } from "@/data/types";

/**
 * Çevredeki günlük yerler (market, okul, eczane, cami, park, banka/ATM, PTT) — Bursa genelinde
 * binlerce nokta (scripts/fetch-amenities.mjs → data/amenities.json).
 *
 * Bellek ve çizim yükü düşük kalsın diye:
 *  - veri ana pakete gömülmez, ilk ihtiyaçta (harita yeterince yakınlaşınca ya da arama kutusuna
 *    odaklanınca) ayrı parça olarak yüklenir;
 *  - haritaya hepsi değil, sadece harita merkezinin ~1 km çevresindekiler, yakınlaştırınca da
 *    ekrandakiler verilir (AmenityLayer). Bunun için noktalar ~1 km'lik ızgara hücrelerinde tutulur.
 */

export type AmenityPlace = Extract<Place, { kind: "amenity" }>;

/** data/amenities.json içindeki "categories" sırasıyla aynı (betikteki CATEGORIES) */
export const AMENITY_CATEGORIES: Record<string, { layer: LayerId; label: string }> = {
  market: { layer: "market", label: "Market" },
  school: { layer: "school", label: "Okul" },
  kindergarten: { layer: "kindergarten", label: "Anaokulu" },
  pharmacy: { layer: "pharmacy", label: "Eczane" },
  mosque: { layer: "mosque", label: "Cami" },
  park: { layer: "park", label: "Park" },
  bank: { layer: "bank", label: "Banka" },
  atm: { layer: "bank", label: "ATM" },
  post: { layer: "post", label: "PTT" },
};

/** Harita merkezinin bu yarıçapındaki yerler gösterilir (AmenityLayer) */
export const NEARBY_RADIUS_M = 1000;

export const amenityPlaceId = (osm: string) => `amenity-${osm}`;

/** [kaynak kimliği, kategori sırası, enlem, boylam, ad, semt sırası (-1: yok), 1: yaklaşık konum] */
type AmenityRow = [string, number, number, number, string, number, 1?];

interface AmenityFile {
  categories: string[];
  areas: string[];
  items: AmenityRow[];
}

/** Izgara hücresi boyu (derece): enlemde ~1,1 km, Bursa'da boylamda ~0,85 km */
const CELL = 0.01;
const cellKey = (row: number, col: number) => row * 100_000 + col;

export interface AmenityData {
  places: AmenityPlace[];
  /** Adı olan yerler (aramaya girenler); adsız park vb. sadece haritada */
  searchable: AmenityPlace[];
  /** [batı, güney, doğu, kuzey] kutusundaki yerler */
  inBounds(bounds: [number, number, number, number]): AmenityPlace[];
  /** [enlem, boylam] merkezine radiusM metreden yakın yerler */
  near(center: [number, number], radiusM: number): AmenityPlace[];
}

/** Kısa mesafede yeterince doğru, hızlı yaklaşık uzaklık (metre) */
export function approxDistanceM([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]): number {
  const x = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * 111_320;
}

export function buildAmenityData(file: AmenityFile): AmenityData {
  const places: AmenityPlace[] = [];
  const searchable: AmenityPlace[] = [];
  const grid = new Map<number, AmenityPlace[]>();

  for (const [osm, ci, lat, lng, name, ai, approximate] of file.items) {
    const category = AMENITY_CATEGORIES[file.categories[ci]];
    if (!category) continue;
    const area = ai >= 0 ? file.areas[ai] : undefined;
    const place: AmenityPlace = {
      kind: "amenity",
      id: amenityPlaceId(osm),
      name: name || category.label,
      position: [lat, lng],
      layer: category.layer,
      category: category.label,
      area,
      approximate: approximate === 1 || undefined,
      // "a101 görükle" gibi aramalar: ad + semt birlikte tek metin olarak eşleşsin
      aliases: name && area ? [`${name} ${area}`] : undefined,
    };
    places.push(place);
    if (name) searchable.push(place);
    const key = cellKey(Math.floor(lat / CELL), Math.floor(lng / CELL));
    const cell = grid.get(key);
    if (cell) cell.push(place);
    else grid.set(key, [place]);
  }

  function inBounds([west, south, east, north]: [number, number, number, number]): AmenityPlace[] {
    const result: AmenityPlace[] = [];
    for (let r = Math.floor(south / CELL); r <= Math.floor(north / CELL); r++) {
      for (let c = Math.floor(west / CELL); c <= Math.floor(east / CELL); c++) {
        for (const p of grid.get(cellKey(r, c)) ?? []) {
          const [lat, lng] = p.position;
          if (lat >= south && lat <= north && lng >= west && lng <= east) result.push(p);
        }
      }
    }
    return result;
  }

  function near(center: [number, number], radiusM: number): AmenityPlace[] {
    const dLat = radiusM / 111_320;
    const dLng = dLat / Math.cos(center[0] * (Math.PI / 180));
    const [lat, lng] = center;
    return inBounds([lng - dLng, lat - dLat, lng + dLng, lat + dLat]).filter(
      (p) => approxDistanceM(center, p.position) <= radiusM,
    );
  }

  return {
    places,
    searchable,
    inBounds,
    near,
  };
}

let amenityPromise: Promise<AmenityData> | null = null;

export function loadAmenities(): Promise<AmenityData> {
  amenityPromise ??= import("@/data/amenities.json")
    .then((module) => buildAmenityData(module.default as unknown as AmenityFile))
    .catch((error: unknown) => {
      amenityPromise = null; // sonraki ihtiyaçta yeniden denensin
      throw error;
    });
  return amenityPromise;
}
