/**
 * Adresten koordinat (forward geocoding) — Photon (komoot) uyumlu /api uç noktası.
 *
 * Sağlayıcı NEXT_PUBLIC_GEOCODE_URL ile değiştirilebilir (bkz. .env.example). Varsayılan
 * photon.komoot.io anahtar istemez ama "adil kullanım" sınırı vardır; yoğun trafikte kendi
 * Photon sunucunuz kullanılmalı. İstekler arama kutusunda 500 ms bekledikten sonra atılır
 * (lib/use-address-search.ts) ve sonuçlar önbellekte tutulur.
 *
 * Sonuçlar Bursa sınır kutusuyla (BURSA_BOUNDS) sınırlanır ve şehir merkezine yakın olanlar öne
 * alınır: Photon kutu olmadan "1. Esen Sokak" için önce İstanbul'u ve Düzce'yi döndürüyor,
 * yol tarifi API'si de Bursa dışındaki noktaları kabul etmiyor.
 */
import type { Place } from "@/data/types";

import { categoryLabel } from "./map-features";
import { BURSA_BOUNDS } from "./map-config";

const ENDPOINT = process.env.NEXT_PUBLIC_GEOCODE_URL || "https://photon.komoot.io/api/";
/** Sonuçların yakınlığa göre sıralanacağı nokta: Bursa merkez */
const BIAS = { lat: "40.1885", lon: "29.0610" };
export const ADDRESS_LIMIT = 3;
/** Photon aynı caddenin parçalarını ayrı sonuç döndürüyor; tekrarlar ayıklanınca 3 sonuç kalsın diye fazlası istenir */
const REQUEST_LIMIT = 6;

/**
 * Photon Türkçe adres kısaltmalarını tanımıyor: "1. esen sok. no 17" boş döner,
 * "1. esen sokak 17" sokağı bulur. Yaygın kısaltmalar açılır, "No:17" sadece sayıya indirilir.
 */
const ABBREVIATIONS: [RegExp, string][] = [
  [/\b(sok|sk)\b\.?/giu, "sokak"],
  [/\b(cad|cd)\b\.?/giu, "caddesi"],
  [/\b(mah|mh)\b\.?/giu, "mahallesi"],
  [/\b(bulv|blv)\b\.?/giu, "bulvarı"],
  [/\bno\s*[:.]?\s*(?=\d)/giu, ""],
];

export function normalizeAddressQuery(query: string): string {
  let q = query;
  for (const [pattern, replacement] of ABBREVIATIONS) q = q.replace(pattern, replacement);
  return q.replace(/\s+/g, " ").trim();
}

interface PhotonProperties {
  osm_type?: string;
  osm_id?: number;
  osm_key?: string;
  osm_value?: string;
  /** house, street, locality, district, city, county, state… */
  type?: string;
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  locality?: string;
  city?: string;
  county?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: PhotonProperties;
}

const TYPE_LABEL: Record<string, string> = {
  street: "Cadde / sokak",
  locality: "Mahalle",
  district: "Mahalle",
  city: "İlçe",
  county: "İlçe",
  state: "İl",
};

/** Photon sonucunu, haritada iğneyle gösterilecek yere çevirir. Adsız sonuçlar için null. */
export function placeFromPhoton({ geometry, properties: p }: PhotonFeature): Place | null {
  const street = p.street ? (p.housenumber ? `${p.street} No:${p.housenumber}` : p.street) : null;
  const name = p.name?.trim() || street;
  if (!name) return null;

  const kind =
    (p.type && TYPE_LABEL[p.type]) ??
    (p.osm_key === "building" || p.osm_key === "place" || !p.name ? "Adres" : categoryLabel(p.osm_value));
  // Alt satır: ad bir bina/yer adıysa sokağı, sonra mahalle ve ilçe
  const area = [p.name ? street : null, p.district ?? p.locality, p.city ?? p.county].filter(
    (part, i, all): part is string => !!part && part !== name && all.indexOf(part) === i,
  );

  const [lon, lat] = geometry.coordinates;
  return {
    kind: "feature",
    id: `address-${p.osm_type ?? ""}${p.osm_id ?? `${lat},${lon}`}`,
    name,
    position: [lat, lon],
    category: [kind, area.join(", ")].filter(Boolean).join(" · "),
  };
}

const cache = new Map<string, Place[]>();

/** Önbellekte varsa sonucu hemen verir (beklemeden göstermek için) */
export function cachedAddresses(query: string): Place[] | undefined {
  return cache.get(normalizeAddressQuery(query).toLocaleLowerCase("tr-TR"));
}

export async function searchAddresses(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = normalizeAddressQuery(query);
  const key = q.toLocaleLowerCase("tr-TR");
  const cached = cache.get(key);
  if (cached) return cached;

  const url = new URL(ENDPOINT);
  const params = new URLSearchParams(url.search);
  params.set("q", q);
  params.set("lat", BIAS.lat);
  params.set("lon", BIAS.lon);
  params.set("limit", String(REQUEST_LIMIT));
  params.set("bbox", BURSA_BOUNDS.join(","));
  url.search = params.toString();

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };

  const seen = new Set<string>();
  const places: Place[] = [];
  for (const feature of data.features ?? []) {
    const place = placeFromPhoton(feature);
    if (!place || place.kind !== "feature") continue;
    const label = `${place.name}|${place.category}`;
    if (seen.has(label)) continue;
    seen.add(label);
    places.push(place);
    if (places.length === ADDRESS_LIMIT) break;
  }
  cache.set(key, places);
  return places;
}
