/**
 * Öne çıkan ilgi noktalarının (kampüs, AVM, otogar, aktarma merkezi) konumlarını
 * OpenStreetMap'teki gerçek kayıtlarından alıp data/pois.json'a yazar.
 *
 *   npm run data:pois   →  data/pois.json
 *
 * Konumlar elle girilmez: her nokta doğrulanmış bir OSM öğesine (osm: "way/123") bağlıdır,
 * koordinat o öğenin merkezidir. Veri © OpenStreetMap katkıda bulunanlar, ODbL lisansı.
 */
import { writeFile } from "node:fs/promises";

import { ATTRIBUTION, fetchOverpass, round } from "./lib/osm.mjs";

/**
 * name: uygulamada gösterilecek ad (OSM adı kampüs adını içermeyebiliyor).
 * aliases: aramada eşleşecek halk arasındaki adlar.
 */
const POIS = [
  {
    id: "uludag-gorukle",
    osm: "way/343406413", // Bursa Uludağ Üniversitesi
    name: "Bursa Uludağ Üniversitesi (Görükle Kampüsü)",
    layer: "campus",
    aliases: ["BUÜ", "Uludağ Üni"],
  },
  {
    id: "btu-mimar-sinan",
    osm: "way/414842565", // Bursa Teknik Üniversitesi — "Mimar Sinan - BTÜ" metro istasyonunun yanı
    name: "Bursa Teknik Üniversitesi (Mimar Sinan Kampüsü)",
    layer: "campus",
    aliases: ["BTÜ"],
  },
  {
    id: "bursa-terminal",
    osm: "way/191171800",
    name: "Bursa Şehirlerarası Otobüs Terminali",
    layer: "terminal",
    aliases: ["otogar"],
  },
  { id: "kent-meydani", osm: "way/167270524", name: "Kent Meydanı AVM", layer: "mall" },
  { id: "korupark", osm: "way/309768329", name: "Korupark AVM", layer: "mall" },
  { id: "acemler-aktarma", osm: "way/1025242855", name: "Acemler Aktarma Merkezi", layer: "transfer" },
  {
    id: "universite-aktarma",
    osm: "way/1355946848",
    name: "Üniversite Aktarma Merkezi",
    layer: "transfer",
  },
];

function fetchOsm() {
  const statements = POIS.map(({ osm }) => {
    const [type, id] = osm.split("/");
    return `${type}(${id});`;
  }).join("");
  return fetchOverpass(`[out:json][timeout:60];(${statements});out center tags;`);
}

const osm = await fetchOsm();
const byRef = new Map(osm.elements.map((e) => [`${e.type}/${e.id}`, e]));

const pois = POIS.map((poi) => {
  const el = byRef.get(poi.osm);
  if (!el) throw new Error(`${poi.id}: OSM öğesi ${poi.osm} bulunamadı (silinmiş olabilir)`);
  const { lat, lon } = el.center ?? el;
  return { ...poi, position: [round(lat), round(lon)] };
});

await writeFile(
  new URL("../data/pois.json", import.meta.url),
  JSON.stringify(
    { attribution: ATTRIBUTION, generatedAt: new Date().toISOString().slice(0, 10), pois },
    null,
    2,
  ) + "\n",
);
console.log(`pois: ${pois.length} nokta yazıldı`);
