/**
 * Sokak ağı üzerinden yürüme mesafesi ve güzergâhı (OSRM "foot" profili) — SADECE SUNUCUDA.
 *
 * Varsayılan servis: FOSSGIS'in OSM verisiyle çalışan ücretsiz OSRM sunucusu
 * (routing.openstreetmap.de). Adil kullanım içindir; yayında yoğun trafik için kendi OSRM
 * sunucunuzu kurup WALK_ROUTER_URL ile gösterin (bkz. .env.example). "off" verilirse servis
 * hiç çağrılmaz ve kuş uçuşu tahmin kullanılır (testler böyle çalışır).
 *
 * OSRM başlangıç/bitiş noktalarını en yakın yola "yapıştırır" ve o yapıştırma mesafesini
 * toplama katmaz; gerçekçi olsun diye bu mesafeler (waypoint/source/destination distance)
 * ayrıca eklenir.
 */

interface LatLon {
  lat: number;
  lon: number;
}

const DEFAULT_URL = "https://routing.openstreetmap.de/routed-foot";
const TIMEOUT_MS = 4000;
const CACHE_LIMIT = 2000;

function baseUrl(): string | null {
  const configured = process.env.WALK_ROUTER_URL?.trim();
  if (configured === "off") return null;
  return (configured || DEFAULT_URL).replace(/\/$/, "");
}

const coord = ({ lat, lon }: LatLon) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

async function osrm<T>(path: string): Promise<T | null> {
  const base = baseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { "User-Agent": "bursa-map/0.1 (toplu taşıma yol tarifi)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as T & { code?: string };
    return body.code === "Ok" ? body : null;
  } catch {
    return null; // zaman aşımı / ağ hatası → çağıran kuş uçuşu tahmine döner
  }
}

/**
 * Bir noktadan (source) çok sayıda noktaya yürüme mesafeleri (metre), tek istekte.
 * reverse: true → noktalardan hedefe (varış yürüyüşü için).
 * Servis yoksa veya bir hedefe yol bulunamazsa o eleman null.
 */
export async function walkDistances(
  origin: LatLon,
  points: LatLon[],
  { reverse = false } = {},
): Promise<(number | null)[] | null> {
  if (points.length === 0) return [];
  const all = [origin, ...points];
  const others = points.map((_, i) => i + 1).join(";");
  const params = reverse
    ? `sources=${others}&destinations=0`
    : `sources=0&destinations=${others}`;
  const body = await osrm<{
    distances: (number | null)[][];
    sources: { distance: number }[];
    destinations: { distance: number }[];
  }>(`/table/v1/foot/${all.map(coord).join(";")}?${params}&annotations=distance`);
  if (!body) return null;

  return points.map((_, i) => {
    const d = reverse ? body.distances[i]?.[0] : body.distances[0]?.[i];
    if (d == null) return null;
    const snapA = reverse ? body.sources[i].distance : body.sources[0].distance;
    const snapB = reverse ? body.destinations[0].distance : body.destinations[i].distance;
    return d + snapA + snapB;
  });
}

export interface WalkPath {
  meters: number;
  /** [boylam, enlem] — başlangıç ve bitiş noktaları dahil (yola yapıştırma parçaları eklenir) */
  path: [number, number][];
}

const routeCache = new Map<string, WalkPath | null>();

/** İki nokta arası sokaklardan yürüme güzergâhı; servis yoksa null */
export async function walkPath(a: LatLon, b: LatLon): Promise<WalkPath | null> {
  const key = `${coord(a)};${coord(b)}`;
  if (routeCache.has(key)) return routeCache.get(key)!;

  const body = await osrm<{
    routes: { distance: number; geometry: { coordinates: [number, number][] } }[];
    waypoints: { distance: number }[];
  }>(`/route/v1/foot/${key}?overview=full&geometries=geojson`);

  const route = body?.routes[0];
  const result: WalkPath | null = route
    ? {
        meters: route.distance + body.waypoints[0].distance + body.waypoints[1].distance,
        path: [[a.lon, a.lat], ...route.geometry.coordinates, [b.lon, b.lat]],
      }
    : null;

  // Sadece başarılı sonuçlar önbelleğe girer; servis geçici hatada sonraki istekte yeniden denensin
  if (result) {
    if (routeCache.size >= CACHE_LIMIT) routeCache.delete(routeCache.keys().next().value!);
    routeCache.set(key, result);
  }
  return result;
}
