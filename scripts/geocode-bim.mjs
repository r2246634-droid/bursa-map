/**
 * BİM şubelerinin konumları: BİM'in şube listesi (All The Places "bim_tr", CC0) koordinat
 * vermiyor, sadece açık adres veriyor. Bu betik Bursa'daki şubelerin adreslerini Nominatim
 * (OSM adres arama) ile koordinata çevirir; sonuç fetch-amenities.mjs'e girer.
 *
 *   node scripts/geocode-bim.mjs            # önbellekteki adresler tekrar sorulmaz
 *   node scripts/geocode-bim.mjs --refresh        # hepsini yeniden sorar
 *   node scripts/geocode-bim.mjs --retry-missing  # sadece bulunamayanları yeniden sorar
 *
 * Nominatim kullanım kuralı gereği saniyede en fazla 1 istek atılır (500+ şube ≈ 10–25 dk).
 * Konumlar YAKLAŞIKTIR: kapı numarası bulunursa bina, bulunmazsa sokak düzeyinde. Sadece mahalle
 * ya da ilçe düzeyinde bulunan adres alınmaz (haritada yanlış yerde nokta göstermemek için).
 * Bulunan nokta adresteki ilçede ve mahallenin ~2 km yakınında olmalı (bkz. pick).
 *
 * Çıktı: data/raw/bim-geocoded.json — [{ ref, lat, lon, precision: "house" | "street", query }]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { BURSA_BOUNDS, distanceMeters } from "./lib/osm.mjs";

const SOURCE = "data/raw/atp/bim_tr.geojson";
const CACHE = "data/raw/bim-geocode-cache.json";
const OUT = "data/raw/bim-geocoded.json";
/** Mahalle noktaları için (scripts/fetch-amenities.mjs önce bir kez çalışmış olmalı) */
const PLACES_RAW = "data/raw/amenities-raw.json";
const NOMINATIM = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org/search";
const DELAY_MS = 1100;

const TR_ASCII = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };
const fold = (text = "") =>
  text
    .toLocaleLowerCase("tr-TR")
    .replace(/[ışğüöç]/g, (ch) => TR_ASCII[ch])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** "Cad." → "Caddesi" gibi kısaltmalar; Nominatim tam yazımı daha iyi buluyor */
function expand(text) {
  return text
    .replace(/(^|\s)ŞHT\.?\s*/gi, "$1Şehit ") // \b Türkçe harfi kelime sayamıyor
    .replace(/(\S)(cad\.|sk\.|sok\.)/gi, "$1 $2") // "Çiçekcad." → "Çiçek cad."
    .replace(/\bCad(?:desi|\.)?(?=\s|$|\.)/gi, "Caddesi")
    .replace(/\b(?:Sok(?:ağı|ak|\.)?|Sk\.?)(?=\s|$|\.)/gi, "Sokak")
    .replace(/\b(?:Bulv(?:arı|\.)?|Blv\.?)(?=\s|$|\.)/gi, "Bulvarı")
    .replace(/\.(?=\S)/g, ". ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Millet mah. Vatan Cad. B blok No:363 BB Yıldırım/Bursa" →
 * { mahalle: "Millet", street: "Vatan Caddesi", number: "363" }
 */
export function parseAddress(full) {
  const text = full.replace(/\s+/g, " ");
  const mah = text.match(/^(.*?)\s*\b(?:Mah(?:allesi|\.|\b)|Mh\.)\s*/i);
  const mahalle = mah ? mah[1].trim() : null;
  let rest = mah ? text.slice(mah[0].length) : text;
  // "No:12/A" ya da numarasız "Ahmet Paşa Cad. 28a": numaradan sonrası (ilçe, il) atılır
  const no = rest.match(/\bNo\s*[:.]?\s*(\d+)/i) ?? rest.match(/\s(\d+)\s*[A-Z]?(?:[/-]\S*)?\s/i);
  if (no) rest = rest.slice(0, no.index);
  const street = expand(
    rest
      .replace(/\b[A-Z]{0,2}\s*Blok\.?/gi, "")
      .replace(/[,/]+$/, "")
      .trim(),
  );
  return { mahalle, street: street || null, number: no ? no[1] : null };
}

const [west, south, east, north] = [BURSA_BOUNDS[0][1], BURSA_BOUNDS[0][0], BURSA_BOUNDS[1][1], BURSA_BOUNDS[1][0]];
/** Bina/sokak düzeyi; bunların dışı (mahalle, köy, ilçe…) kabul edilmez */
const HOUSE_TYPES = new Set(["house", "building", "shop", "amenity", "office", "commercial", "retail"]);
const STREET_TYPES = new Set(["road", "street", "pedestrian", "residential"]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q) {
  const url = new URL(NOMINATIM);
  url.search = new URLSearchParams({
    q,
    format: "jsonv2",
    limit: "3",
    countrycodes: "tr",
    viewbox: `${west},${north},${east},${south}`,
    bounded: "1",
  }).toString();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "bursa-map-dev/0.1 (one-off data script)" } });
    if (res.ok) return res.json();
    if (attempt >= 4 || ![429, 502, 503, 504].includes(res.status)) throw new Error(`Nominatim ${res.status}`);
    await sleep(attempt * 10_000);
  }
}

/** Bursa'nın 17 ilçesi: şube adındaki yazım tutarsız ("KAVAKLI-M.KEMALPAŞA"), adres metninde aranır */
const DISTRICTS = [
  "Osmangazi", "Nilüfer", "Yıldırım", "Büyükorhan", "Gemlik", "Gürsu", "Harmancık", "İnegöl", "İznik",
  "Karacabey", "Keles", "Kestel", "Mudanya", "Mustafakemalpaşa", "Orhaneli", "Orhangazi", "Yenişehir",
];
function findDistrict(...texts) {
  const text = ` ${texts.map(fold).join(" ")} `.replace(/ m kemalpasa | mustafa kemalpasa /g, " mustafakemalpasa ");
  return DISTRICTS.find((d) => text.includes(` ${fold(d)} `)) ?? null;
}

/** OSM mahalle/köy noktaları (fetch-amenities'in indirdiği ham veri): katlanmış ad → konumlar */
const mahalleNodes = new Map();
if (existsSync(PLACES_RAW)) {
  for (const p of JSON.parse(readFileSync(PLACES_RAW, "utf8")).places ?? []) {
    const key = fold(p.tags.name).replace(/ mahallesi$/, "");
    if (!mahalleNodes.has(key)) mahalleNodes.set(key, []);
    mahalleNodes.get(key).push([p.lon, p.lat]);
  }
}
const MAHALLE_MAX_M = 2000;

/**
 * Sonuç doğru yerde mi: ilçe adresinde geçmeli; mahalle biliniyorsa sonuç o mahallenin OSM
 * noktasına 2 km'den yakın olmalı (nokta yoksa mahalle adı adreste geçmeli). "413. Sokak",
 * "3. Kardelen Sokak" gibi numaralı sokak adları birçok mahallede var; mahallesi uymayan
 * sonuç yanlış yerdir. Birden çok mahalleden geçen caddede adreste başka mahallenin adı
 * yazabildiği için ad yerine uzaklığa bakılır.
 */
function pick(results, district, mahalle) {
  const nodes = mahalle ? mahalleNodes.get(fold(mahalle)) : null;
  for (const r of results) {
    const where = ` ${fold(r.display_name)} `;
    if (!where.includes(` ${fold(district)} `)) continue;
    const point = [Number(r.lon), Number(r.lat)];
    if (nodes?.length) {
      if (!nodes.some((n) => distanceMeters(n, point) <= MAHALLE_MAX_M)) continue;
    } else if (mahalle && !where.includes(` ${fold(mahalle)} `)) continue;
    const type = r.addresstype ?? r.type;
    if (HOUSE_TYPES.has(type)) return { lat: Number(r.lat), lon: Number(r.lon), precision: "house" };
    if (STREET_TYPES.has(type) || r.category === "highway") {
      return { lat: Number(r.lat), lon: Number(r.lon), precision: "street" };
    }
  }
  return null;
}

const features = JSON.parse(readFileSync(SOURCE, "utf8")).features.filter((f) =>
  /bursa/i.test(f.properties["addr:city"] ?? ""),
);
const cache = existsSync(CACHE) && !process.argv.includes("--refresh") ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
// --retry-missing: daha önce bulunamayanları (null) yeniden sor
if (process.argv.includes("--retry-missing")) {
  for (const key of Object.keys(cache)) if (cache[key] === null) delete cache[key];
}
const out = [];
let asked = 0;
let i = 0;

for (const f of features) {
  i++;
  const p = f.properties;
  const ref = p.ref ?? f.id;
  const district = findDistrict(p["addr:full"] ?? "", p.branch ?? "");
  const { mahalle, street, number } = parseAddress(p["addr:full"] ?? "");

  if (!(ref in cache) && district) {
    const queries = [];
    if (street && number) queries.push(`${street} ${number}, ${mahalle ? `${mahalle} Mahallesi, ` : ""}${district}, Bursa`);
    if (street) queries.push(`${street}, ${mahalle ? `${mahalle} Mahallesi, ` : ""}${district}, Bursa`);
    let found = null;
    for (const q of queries) {
      await sleep(DELAY_MS);
      asked++;
      const hit = pick(await search(q), district, mahalle);
      if (hit) {
        found = { ...hit, query: q };
        break;
      }
    }
    cache[ref] = found;
    if (asked % 20 === 0) {
      writeFileSync(CACHE, JSON.stringify(cache));
      console.log(`  ${i}/${features.length} şube, ${asked} istek`);
    }
  }
  if (cache[ref]) out.push({ ref, district, ...cache[ref] });
}

writeFileSync(CACHE, JSON.stringify(cache));
writeFileSync(OUT, JSON.stringify(out));
const house = out.filter((o) => o.precision === "house").length;
console.log(
  `${OUT}: ${features.length} şubeden ${out.length} konum (${house} bina, ${out.length - house} sokak düzeyi), ${features.length - out.length} bulunamadı`,
);
