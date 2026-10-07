import poisData from "./pois.json";
import type { PointOfInterest } from "./types";

/**
 * Konumlar scripts/fetch-pois.mjs ile OSM'deki gerçek kayıtlarından üretilir
 * (her nokta bir OSM öğesine bağlı). Yeni nokta eklemek için o betikteki listeye ekleyin.
 */
export const POIS = poisData.pois as PointOfInterest[];
