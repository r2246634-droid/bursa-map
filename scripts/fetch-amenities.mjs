/**
 * Çevredeki günlük yerler: zincir marketler (A101, BİM, Hakmar, Tarım Kredi Koop, Migros), okul,
 * anaokulu, eczane, cami, park, banka, ATM ve PTT. Bursa il sınırı içinde (haritanın sınır kutusuyla
 * kesişen kısımda) kayıtlı hepsi toplu olarak indirilir; tek tek girilmez.
 *
 * Kaynaklar:
 *  - OpenStreetMap (Overpass) — tüm kategoriler
 *  - All The Places (https://alltheplaces.xyz, CC0) — markaların kendi şube bulucularından
 *    derlenen konumlar: OSM'de eksik kalan Migros şubeleri ve banka/ATM'ler. Koordinatı olmayan
 *    kayıtlar burada alınmaz. OSM'deki bir yerle aynı ad ve kategoride, ~60 m içinde olan kayıt
 *    tekrar eklenmez.
 *  - BİM: şube listesi sadece adres veriyor; scripts/geocode-bim.mjs adresleri koordinata
 *    çevirir (data/raw/bim-geocoded.json). Bu noktalar "yaklaşık konum" olarak işaretlenir.
 *
 *   npm run data:amenities            # ham veri data/raw'da varsa onu kullanır
 *   npm run data:amenities -- --refresh
 *
 * Çıktı data/amenities.json (uygulama ilk ihtiyaçta tembel yükler, lib/amenities.ts):
 *   categories: kategori adları; items: [kaynak kimliği, kategori sırası, enlem, boylam, ad, semt sırası, (1: yaklaşık konum)]
 *   (kaynak kimliği: OSM için "n123"/"w456", All The Places için "atp-<örümcek>-<ref>")
 *   areas: semt adları — her noktaya en yakın OSM yerleşim/mahalle noktasının adı (aramada
 *          "a101 görükle" gibi sorgular ve aynı adlı şubeleri ayırt etmek için)
 * Adsız park/yerlerde ad "" kalır; uygulama kategori adını gösterir, aramaya almaz.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { ATTRIBUTION, distanceMeters, fetchOverpass, isInsideBursa, round } from "./lib/osm.mjs";

const RAW_FILE = "data/raw/amenities-raw.json";
const ATP_DIR = "data/raw/atp";
const BIM_FILE = "data/raw/bim-geocoded.json";
const OUT_FILE = "data/amenities.json";

/** lib/amenities.ts'teki AMENITY_CATEGORIES ile aynı sırada olmalı */
const CATEGORIES = ["market", "school", "kindergarten", "pharmacy", "mosque", "park", "bank", "atm", "post"];

/** Bursa ili (ISO 3166-2: TR-16) */
const AREA = `area["ISO3166-2"="TR-16"]["admin_level"="4"]->.b;`;

// Tek büyük sorgu yoğun saatlerde zaman aşımına uğruyor: her grup ayrı sorgu
const QUERIES = {
  shops: `nwr["shop"~"^(supermarket|convenience)$"](area.b);`,
  education: `nwr["amenity"~"^(school|kindergarten)$"](area.b);`,
  services: `nwr["amenity"~"^(pharmacy|bank|atm|post_office)$"](area.b);`,
  mosques: `nwr["amenity"="place_of_worship"]["religion"="muslim"](area.b);`,
  parks: `nwr["leisure"="park"](area.b);`,
  places: `node["place"~"^(suburb|quarter|neighbourhood|village|town)$"]["name"](area.b);`,
};

/** All The Places örümcekleri: Bursa'da koordinatlı kaydı olan marka ve bankalar */
const ATP_SPIDERS = [
  "migros_tr",
  "a101_tr",
  "ziraat_bankasi_tr",
  "turkiye_is_bankasi",
  "garanti_bbva_tr",
  "halkbank_tr",
  "vakifbank_tr",
  "yapi_kredi_tr",
  "denizbank_tr",
  "qnb_tr",
  "teb_tr",
  "kuveyt_turk_tr",
  "vakif_katilim_tr",
];

async function loadAtp() {
  const refresh = process.argv.includes("--refresh");
  mkdirSync(ATP_DIR, { recursive: true });
  let base = null;
  const result = {};
  for (const spider of ATP_SPIDERS) {
    const file = `${ATP_DIR}/${spider}.geojson`;
    if (!existsSync(file) || refresh) {
      if (!base) {
        const latest = await (await fetch("https://data.alltheplaces.xyz/runs/latest.json")).json();
        base = latest.output_url.replace(/output\.zip$/, "output");
        console.log(`All The Places: ${latest.run_id}`);
      }
      const res = await fetch(`${base}/${spider}.geojson`);
      if (!res.ok) {
        console.warn(`  ${spider}: HTTP ${res.status}, atlandı`);
        continue;
      }
      writeFileSync(file, await res.text());
    }
    result[spider] = JSON.parse(readFileSync(file, "utf8")).features;
  }
  return result;
}

async function loadOsm() {
  if (existsSync(RAW_FILE) && !process.argv.includes("--refresh")) {
    console.log(`Ham veri: ${RAW_FILE}`);
    return JSON.parse(readFileSync(RAW_FILE, "utf8"));
  }
  const raw = {};
  for (const [key, statement] of Object.entries(QUERIES)) {
    const { elements } = await fetchOverpass(`[out:json][timeout:240];${AREA}(${statement});out center tags;`);
    raw[key] = elements;
    console.log(`  ${key}: ${elements.length} öğe`);
  }
  mkdirSync("data/raw", { recursive: true });
  writeFileSync(RAW_FILE, JSON.stringify(raw));
  return raw;
}

/* ---- Ad ve kategori ---- */

const TR_ASCII = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };
const fold = (text = "") =>
  text
    .toLocaleLowerCase("tr-TR")
    .replace(/[ışğüöç]/g, (ch) => TR_ASCII[ch])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Zincir market: katlanmış marka/ad metninden görünen ad; listede olmayan market için null */
function marketName(tags) {
  const text = fold([tags.brand, tags["brand:tr"], tags.name, tags.operator].filter(Boolean).join(" "));
  const t = ` ${text} `;
  if (/ a ?101 /.test(t)) return "A101";
  if (/ bim /.test(t)) return "BİM";
  if (t.includes(" hakmar ")) return t.includes(" express ") ? "Hakmar Express" : "Hakmar";
  if (t.includes(" tarim kredi ") || / koop /.test(t)) return "Tarım Kredi Koop Market";
  if (t.includes("migros")) {
    if (t.includes(" jet ")) return "Migros Jet";
    if (/ 5 ?m /.test(t)) return "5M Migros";
    if (/ m{2,3} /.test(t)) return `${t.match(/ (m{2,3}) /)[1].toUpperCase()} Migros`;
    return "Migros";
  }
  return null;
}

const KINDERGARTEN_NAME = /\b(anaokulu|kres|gunduz bakim|cocuk kulubu)/;

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

/** OSM öğesi → [kategori, ad] ya da listede olmayan öğe için null */
function classify(tags) {
  if (tags.shop === "supermarket" || tags.shop === "convenience") {
    const name = marketName(tags);
    return name ? ["market", name] : null;
  }
  switch (tags.amenity) {
    case "school":
      // OSM'de anaokullarının çoğu "school" etiketli; "… Ortaokulu ve Anasınıfı" okul kalır
      return [KINDERGARTEN_NAME.test(fold(tags.name)) ? "kindergarten" : "school", clean(tags.name) || "Okul"];
    case "kindergarten":
      return ["kindergarten", clean(tags.name) || "Anaokulu"];
    case "pharmacy":
      return ["pharmacy", clean(tags.name) || "Eczane"];
    case "bank":
      return ["bank", clean(tags.name || tags.brand || tags.operator) || "Banka"];
    case "atm": {
      const base = clean(tags.brand || tags.operator || tags.name);
      return ["atm", !base ? "ATM" : /\batm\b/i.test(base) ? base : `${base} ATM`];
    }
    case "post_office": {
      // Kargo şubeleri (Aras, Yurtiçi…) de post_office etiketli: sadece PTT
      const text = fold([tags.name, tags.operator, tags.brand].filter(Boolean).join(" "));
      if (!/\bptt\b/.test(text)) return null;
      return ["post", fold(tags.name) === "ptt" || !tags.name ? "PTT" : clean(tags.name)];
    }
    case "place_of_worship":
      return ["mosque", clean(tags.name) || "Cami"];
  }
  if (tags.leisure === "park") return ["park", clean(tags.name)];
  return null;
}

/* ---- Semt (en yakın yerleşim noktası) ---- */

/** Semt ataması için en fazla uzaklık; daha uzaktaki nokta semtsiz kalır */
const AREA_MAX_M = 2500;
const CELL = 0.02; // derece, ~2 km

function areaFinder(placeNodes) {
  const grid = new Map();
  for (const p of placeNodes) {
    const name = clean(p.tags.name).replace(/\s+(Mahallesi|Mah\.?)$/i, "");
    if (!name) continue;
    const key = `${Math.floor(p.lat / CELL)}:${Math.floor(p.lon / CELL)}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push({ name, coord: [p.lon, p.lat] });
  }
  return (lat, lon) => {
    const [r, c] = [Math.floor(lat / CELL), Math.floor(lon / CELL)];
    let best = null;
    let bestD = AREA_MAX_M;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        for (const p of grid.get(`${r + dr}:${c + dc}`) ?? []) {
          const d = distanceMeters([lon, lat], p.coord);
          if (d < bestD) [best, bestD] = [p.name, d];
        }
      }
    }
    return best;
  };
}

/* ---- Çıktı ---- */

const raw = await loadOsm();
const atp = await loadAtp();
const nearestArea = areaFinder(raw.places);

const items = [];
const seen = new Set();
const addItem = (id, tags, lat, lon, approximate = false) => {
  if (seen.has(id) || !tags) return;
  seen.add(id);
  const kind = classify(tags);
  if (!kind || lat === undefined || !isInsideBursa([lon, lat])) return;
  items.push({ id, category: kind[0], name: kind[1], lat: round(lat), lon: round(lon), approximate });
};
/** Sınır kutusu komşu illere taşıyor: adresinde il yazan kayıt Bursa'da olmalı */
const inBursaProvince = (props) => {
  const where = [props["addr:state"], props["addr:province"], props["addr:city"]].filter(Boolean);
  return where.length === 0 || where.some((w) => fold(w).includes("bursa"));
};
/** Uzun kaynak kimliğinden (BİM'de ref açık adres) kısa, kararlı kimlik: FNV-1a */
const shortHash = (text) => {
  let h = 0x811c9dc5;
  for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(36);
};
// Önce OSM: tekilleştirmede OSM kaydı kalır
for (const el of Object.entries(raw).flatMap(([key, list]) => (key === "places" ? [] : list))) {
  const { lat, lon } = el.center ?? el;
  addItem(`${el.type[0]}${el.id}`, el.tags, lat, lon);
}
const osmCount = items.length;
for (const [spider, features] of Object.entries(atp)) {
  for (const f of features) {
    if (f.geometry?.type !== "Point" || !inBursaProvince(f.properties)) continue;
    const [lon, lat] = f.geometry.coordinates;
    addItem(`atp-${spider}-${f.properties.ref ?? f.id}`, f.properties, lat, lon);
  }
}
const atpCount = items.length - osmCount;
// BİM: adresten bulunan yaklaşık konumlar (scripts/geocode-bim.mjs)
if (existsSync(BIM_FILE)) {
  for (const b of JSON.parse(readFileSync(BIM_FILE, "utf8"))) {
    addItem(`bim-${shortHash(String(b.ref))}`, { shop: "supermarket", brand: "BİM" }, b.lat, b.lon, true);
  }
} else {
  console.warn(`${BIM_FILE} yok: BİM şubeleri için önce node scripts/geocode-bim.mjs çalıştırın`);
}
console.log(`OSM: ${osmCount}, All The Places: ${atpCount}, BİM (adresten): ${items.length - osmCount - atpCount} aday`);

// Aynı yer hem nokta hem bina olarak ya da iki kaynakta birden girilmiş olabilir:
// aynı kategori ve adla ~60 m içindekileri tekille. Adresten bulunan yaklaşık konum sokak
// düzeyinde kayabildiği için onda yarıçap daha geniş (OSM'deki aynı şube kalır)
const DUP_M = 60;
const DUP_APPROX_M = 250;
const kept = [];
const byKey = new Map();
for (const item of items) {
  const key = `${item.category}|${item.name}`;
  const others = byKey.get(key) ?? [];
  const radius = item.approximate ? DUP_APPROX_M : DUP_M;
  if (item.name && others.some((o) => distanceMeters([o.lon, o.lat], [item.lon, item.lat]) < radius)) continue;
  others.push(item);
  byKey.set(key, others);
  kept.push(item);
}

const areas = [];
const areaIndex = new Map();
const rows = kept
  .sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.lat - b.lat)
  .map((item) => {
    const area = nearestArea(item.lat, item.lon);
    let ai = -1;
    if (area) {
      if (!areaIndex.has(area)) areaIndex.set(area, areas.push(area) - 1);
      ai = areaIndex.get(area);
    }
    const row = [item.id, CATEGORIES.indexOf(item.category), item.lat, item.lon, item.name, ai];
    return item.approximate ? [...row, 1] : row;
  });

writeFileSync(
  OUT_FILE,
  JSON.stringify({
    attribution: `${ATTRIBUTION}; All The Places (CC0)`,
    generatedAt: new Date().toISOString().slice(0, 10),
    categories: CATEGORIES,
    areas,
    items: rows,
  }) + "\n",
);

const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
for (const item of kept) counts[item.category]++;
console.log(`${OUT_FILE}: ${rows.length} nokta, ${areas.length} semt`, counts);
