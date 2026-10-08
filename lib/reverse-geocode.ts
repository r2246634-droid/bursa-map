/**
 * Koordinattan adres (Nominatim uyumlu reverse geocoding).
 *
 * Sağlayıcı NEXT_PUBLIC_REVERSE_GEOCODE_URL ile değiştirilebilir (bkz. .env.example):
 *   - varsayılan: OSM'nin ücretsiz Nominatim sunucusu — kullanım politikası saniyede en fazla
 *     1 istek ve toplu kullanım yasağı; yayındaki bir uygulama için uygun değil,
 *   - kendi Nominatim sunucunuz veya Nominatim uyumlu ücretli bir servis (aynı /reverse arayüzü).
 * Uç nokta sorgu parametresi içerebilir (ör. ?key=…); lat/lon/format parametreleri üstüne eklenir.
 *
 * Kullanıcı bir yer seçtiğinde tek istek atılır, sonuçlar önbellekte tutulur ve istekler
 * arasında en az MIN_INTERVAL_MS beklenir (hızlı art arda dokunuşlarda politika ihlali olmasın).
 */

const ENDPOINT = process.env.NEXT_PUBLIC_REVERSE_GEOCODE_URL || "https://nominatim.openstreetmap.org/reverse";
const MIN_INTERVAL_MS = 1100;

/** İstekleri sıraya koyup aralarına en az MIN_INTERVAL_MS bırakır */
let queue: Promise<void> = Promise.resolve();
let lastRequestAt = 0;
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  queue = run.catch(() => undefined);
  return run.then(task);
}

export interface ReverseGeocodeResult {
  /** Nominatim'in bulduğu yerin adı (varsa), ör. "Bursa Teknik Üniversitesi" */
  name: string | null;
  /** Kısa adres: "Mimar Sinan Cd. No:10, Yıldırım" */
  address: string;
}

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  town?: string;
  city_district?: string;
  county?: string;
  city?: string;
}

const cache = new Map<string, ReverseGeocodeResult | null>();

function formatAddress(a: NominatimAddress): string {
  const street = a.road ?? a.pedestrian;
  const streetPart = street ? (a.house_number ? `${street} No:${a.house_number}` : street) : null;
  const neighbourhood = a.neighbourhood ?? a.quarter ?? a.suburb;
  // Türkiye'de ilçe çoğunlukla "town" veya "county" alanında geliyor
  const district = a.town ?? a.city_district ?? a.county;
  return [streetPart, neighbourhood, district].filter(Boolean).join(", ");
}

export async function reverseGeocode(
  [lat, lng]: [number, number],
  signal?: AbortSignal,
): Promise<ReverseGeocodeResult | null> {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key)!;

  const url = new URL(ENDPOINT);
  const query = new URLSearchParams(url.search);
  for (const [param, value] of Object.entries({
    lat: String(lat),
    lon: String(lng),
    format: "jsonv2",
    zoom: "18",
    addressdetails: "1",
    "accept-language": "tr",
  })) {
    query.set(param, value);
  }
  url.search = query.toString();

  const res = await throttled(() => {
    // Kullanıcı sırada beklerken başka yer seçtiyse istek hiç atılmasın
    if (signal?.aborted) throw new DOMException("İptal edildi", "AbortError");
    return fetch(url, { signal });
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as { name?: string; address?: NominatimAddress; error?: string };

  const result: ReverseGeocodeResult | null =
    data.error || !data.address
      ? null
      : { name: data.name?.trim() || null, address: formatAddress(data.address) };
  cache.set(key, result);
  return result;
}
