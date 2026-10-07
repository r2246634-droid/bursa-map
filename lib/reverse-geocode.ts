/**
 * Koordinattan adres (Nominatim reverse geocoding).
 *
 * Nominatim kullanım politikası: saniyede en fazla 1 istek, toplu/otomatik sorgu yok.
 * Burada sadece kullanıcı bir yeri seçtiğinde tek istek atılıyor ve sonuçlar önbellekte tutuluyor.
 * Trafik büyüdüğünde kendi Nominatim sunucusu veya ücretli bir sağlayıcı gerekecek.
 */

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

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.search = new URLSearchParams({
    lat: String(lat),
    lon: String(lng),
    format: "jsonv2",
    zoom: "18",
    addressdetails: "1",
    "accept-language": "tr",
  }).toString();

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as { name?: string; address?: NominatimAddress; error?: string };

  const result: ReverseGeocodeResult | null =
    data.error || !data.address
      ? null
      : { name: data.name?.trim() || null, address: formatAddress(data.address) };
  cache.set(key, result);
  return result;
}
