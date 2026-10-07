/** Bursa merkez (Heykel / Osmangazi civarı), [boylam, enlem] */
export const BURSA_CENTER: [number, number] = [29.061, 40.1885];

/**
 * Kullanıcının dışına çıkamayacağı sınır kutusu.
 * Mudanya, Gemlik, İnegöl ve Uludağ'ı kapsayacak genişlikte tutuldu.
 * [batı, güney, doğu, kuzey] — scripts/lib/osm.mjs içindeki BURSA_BOUNDS ile aynı alan.
 */
export const BURSA_BOUNDS: [number, number, number, number] = [28.6, 39.95, 29.6, 40.5];

/**
 * MapLibre 512px karo kullanır: aynı zoom değeri Leaflet'tekinden bir seviye yakın görünür.
 * Değerler o yüzden Leaflet dönemindekinden 1 düşük.
 */
export const MAP_ZOOM = {
  initial: 12,
  min: 9,
  max: 19,
  /** Bir yer seçildiğinde kameranın en az yaklaşacağı seviye */
  focus: 15,
} as const;

/** 3D görünümde haritanın eğim açısı (derece) */
export const PITCH_3D = 60;
export const MAX_PITCH = 70;

/**
 * Vektör altlık: OpenFreeMap "Liberty" stili (OSM verisi, API anahtarı gerektirmez).
 * 3D bina (fill-extrusion) ve tıklanabilir POI katmanları içerir.
 */
export const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/** Altlıktaki tıklanabilir ilgi noktası (dükkân, okul, durak…) katmanları */
export const BASEMAP_POI_LAYERS = ["poi_r1", "poi_r7", "poi_r20", "poi_transit"];

/** Etiketlerde kullanılacak yazı tipi (stilin glyph sunucusunda mevcut olmalı) */
export const LABEL_FONT = ["Noto Sans Regular"];

/** public/ altına kopyalanan MapLibre worker'ı (bkz. scripts/copy-maplibre-worker.mjs) */
export const MAPLIBRE_WORKER_URL = "/vendor/maplibre-gl-worker.mjs";

/** Uygulama içi [enlem, boylam] → MapLibre [boylam, enlem] */
export const toLngLat = ([lat, lng]: [number, number]): [number, number] => [lng, lat];
