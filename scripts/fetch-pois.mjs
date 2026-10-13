/**
 * Öne çıkan ilgi noktalarının (kampüs, AVM, hastane, otogar, aktarma merkezi, önemli yerler) konumlarını
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

  // AVM'ler
  { id: "anatolium", osm: "way/309766158", name: "Anatolium AVM", layer: "mall" },
  { id: "zafer-plaza", osm: "way/26470681", name: "Zafer Plaza AVM", layer: "mall" },
  { id: "ozdilekpark", osm: "way/477694851", name: "ÖzdilekPark Bursa", layer: "mall", aliases: ["Özdilek"] },
  { id: "marka-avm", osm: "way/557570250", name: "Sur Yapı Marka AVM", layer: "mall", aliases: ["Marka AVM"] },
  { id: "podyum-park", osm: "way/429895428", name: "Podyum Park AVM", layer: "mall", aliases: ["PodyumPark"] },
  { id: "downtown", osm: "node/11449933766", name: "Bursa Downtown AVM", layer: "mall" },
  { id: "as-merkez", osm: "way/1279592177", name: "As Merkez Outlet", layer: "mall", aliases: ["As Outlet"] },
  { id: "arena-avm", osm: "way/302546339", name: "Arena AVM", layer: "mall" },

  // Hastaneler
  { id: "sehir-hastanesi", osm: "way/632460745", name: "Bursa Şehir Hastanesi", layer: "hospital" },
  {
    id: "uludag-hastanesi",
    osm: "way/666689302",
    name: "Bursa Uludağ Üniversitesi Hastanesi",
    layer: "hospital",
    aliases: ["Uludağ Tıp Fakültesi", "Tıp Fakültesi Hastanesi"],
  },
  {
    id: "yuksek-ihtisas",
    osm: "way/328024078", // Yıldırım, Mimar Sinan Mah.
    name: "Bursa Yüksek İhtisas Eğitim ve Araştırma Hastanesi",
    layer: "hospital",
    aliases: ["Yüksek İhtisas"],
  },
  { id: "cekirge-devlet", osm: "way/26446090", name: "Çekirge Devlet Hastanesi", layer: "hospital" },
  { id: "dortcelik", osm: "way/302549670", name: "Dörtçelik Çocuk Hastanesi", layer: "hospital" },
  { id: "acibadem-bursa", osm: "way/308065253", name: "Acıbadem Bursa Hastanesi", layer: "hospital" },
  { id: "medical-park-bursa", osm: "way/411659382", name: "VM Medical Park Bursa", layer: "hospital" },

  // Önemli yerler
  { id: "ulu-cami", osm: "way/26434413", name: "Ulu Cami", layer: "landmark" },
  { id: "koza-han", osm: "relation/1018973", name: "Koza Han", layer: "landmark", aliases: ["Kapalıçarşı"] },
  { id: "yesil-turbe", osm: "way/254313386", name: "Yeşil Türbe", layer: "landmark" },
  {
    id: "osman-gazi-turbesi",
    osm: "way/325992025",
    name: "Osman Gazi Türbesi (Tophane)",
    layer: "landmark",
    aliases: ["Tophane", "Orhan Gazi Türbesi"],
  },
  { id: "cumalikizik", osm: "node/12894581039", name: "Cumalıkızık", layer: "landmark" },
  {
    id: "teleferik-teferruc",
    osm: "way/1138116211",
    name: "Bursa Teleferik (Teferrüç)",
    layer: "landmark",
    aliases: ["Teleferik", "Uludağ Teleferik"],
  },
  { id: "merinos-parki", osm: "way/189723143", name: "Merinos Parkı", layer: "landmark" },
  { id: "botanik-park", osm: "way/26445865", name: "Soğanlı Botanik Parkı", layer: "landmark", aliases: ["Botanik Park"] },
  { id: "hudavendigar-parki", osm: "way/334176086", name: "Hüdavendigar Kent Parkı", layer: "landmark" },
  {
    id: "yenisehir-havalimani",
    osm: "way/83334472",
    name: "Bursa Yenişehir Havalimanı",
    layer: "landmark",
    aliases: ["Havalimanı", "Havaalanı"],
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
