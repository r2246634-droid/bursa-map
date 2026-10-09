/**
 * Sokak ağı üzerinden yürüme mesafesi ve güzergâhı — SADECE SUNUCUDA.
 *
 * Kendi yaya ağımız (lib/routing/walk-graph.ts, OSM'den scripts/fetch-walk-graph.mjs ile
 * üretilir) bellekte aranır: dış servis, hız sınırı veya ağ gecikmesi yoktur. Graf
 * yüklenemezse (ör. dosya yok) fonksiyonlar null döner ve çağıran kuş uçuşu tahmine düşer.
 */
import { getWalkGraph, type GraphPath, type LatLon } from "./walk-graph";

/** Başlangıç/varış duraklarına mesafe ararken bundan uzağa bakılmaz */
export const MAX_DISTANCE_SEARCH_M = 2500;
/** Tek bir yürüyüş bacağı için üst sınır (sadece yürüyüş seçeneği dahil) */
const MAX_PATH_M = 8000;

export type WalkPath = GraphPath;

/**
 * Bir noktadan çok sayıda noktaya yürüme mesafeleri (metre). Yaya ağı yönsüz olduğundan
 * noktalardan geri dönüş (varış yürüyüşü) aynıdır. Ağ yoksa veya başlangıç ağ dışındaysa null;
 * ağ dışındaki nokta null, sokaktan ulaşılamayan nokta Infinity.
 */
export function walkDistances(origin: LatLon, points: LatLon[]): (number | null)[] | null {
  if (points.length === 0) return [];
  return getWalkGraph()?.distances(origin, points, MAX_DISTANCE_SEARCH_M) ?? null;
}

/** İki nokta arası sokaklardan yürüme güzergâhı; ağ yoksa veya yol bulunamazsa null */
export function walkPath(a: LatLon, b: LatLon): WalkPath | null {
  return getWalkGraph()?.route(a, b, MAX_PATH_M) ?? null;
}
