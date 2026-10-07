import type { Place } from "@/data/types";

/**
 * OpenMapTiles "poi" katmanındaki class/subclass değerlerinin Türkçe karşılıkları.
 * Önce subclass (daha özel), yoksa class aranır.
 */
const CATEGORY_TR: Record<string, string> = {
  // eğitim
  university: "Üniversite",
  college: "Yüksekokul",
  school: "Okul",
  kindergarten: "Anaokulu",
  library: "Kütüphane",
  // sağlık
  hospital: "Hastane",
  clinic: "Klinik",
  doctors: "Doktor",
  dentist: "Diş hekimi",
  pharmacy: "Eczane",
  // yeme-içme
  restaurant: "Restoran",
  cafe: "Kafe",
  fast_food: "Fast food",
  bar: "Bar",
  pub: "Pub",
  ice_cream: "Dondurmacı",
  bakery: "Fırın",
  // alışveriş
  shop: "Mağaza",
  mall: "Alışveriş merkezi",
  supermarket: "Süpermarket",
  convenience: "Market",
  grocery: "Bakkal",
  clothes: "Giyim mağazası",
  butcher: "Kasap",
  marketplace: "Pazar yeri",
  // ulaşım
  bus: "Otobüs durağı",
  bus_stop: "Otobüs durağı",
  bus_station: "Otobüs terminali",
  railway: "İstasyon",
  subway: "Metro istasyonu",
  tram_stop: "Tramvay durağı",
  station: "İstasyon",
  fuel: "Akaryakıt istasyonu",
  parking: "Otopark",
  car: "Otomobil",
  bicycle_rental: "Bisiklet kiralama",
  ferry_terminal: "İskele",
  aerodrome: "Havalimanı",
  // hizmet
  bank: "Banka",
  atm: "ATM",
  post: "Postane",
  post_office: "Postane",
  police: "Polis",
  fire_station: "İtfaiye",
  townhall: "Belediye",
  courthouse: "Adliye",
  // turizm / kültür / dini
  hotel: "Otel",
  lodging: "Konaklama",
  museum: "Müze",
  attraction: "Turistik yer",
  monument: "Anıt",
  castle: "Kale",
  theatre: "Tiyatro",
  cinema: "Sinema",
  place_of_worship: "İbadet yeri",
  mosque: "Cami",
  religion: "İbadet yeri",
  // açık alan
  park: "Park",
  garden: "Bahçe",
  playground: "Oyun alanı",
  stadium: "Stadyum",
  sports: "Spor tesisi",
  swimming_pool: "Yüzme havuzu",
  cemetery: "Mezarlık",
};

export function categoryLabel(subclass?: unknown, klass?: unknown): string {
  for (const key of [subclass, klass]) {
    if (typeof key === "string" && CATEGORY_TR[key]) return CATEGORY_TR[key];
  }
  return "Yer";
}

/** Vektör karodan gelen ad: önce Türkçe, sonra yerel ad */
export function featureName(properties: Record<string, unknown>): string | null {
  for (const key of ["name:tr", "name", "name:latin"]) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

const coordKey = ([lat, lng]: [number, number]) => `${lat.toFixed(5)},${lng.toFixed(5)}`;

/** Altlık POI'sine dokunulduğunda oluşturulan yer. Adsız POI'ler için null. */
export function placeFromBasemapPoi(
  properties: Record<string, unknown>,
  position: [number, number],
): Place | null {
  const name = featureName(properties);
  if (!name) return null;
  return {
    kind: "feature",
    id: `feature-${coordKey(position)}`,
    name,
    position,
    category: categoryLabel(properties.subclass, properties.class),
  };
}

/** Haritada boş bir noktaya dokunulduğunda bırakılan iğne; adı sonra adres sorgusuyla dolar */
export function droppedPin(position: [number, number]): Place {
  return {
    kind: "feature",
    id: `pin-${coordKey(position)}`,
    name: "Seçilen konum",
    position,
    category: "İşaretlenen nokta",
  };
}
