import { haversineMeters as haversine } from "./routing/time";

/** Uygulama içi [enlem, boylam] sırasıyla iki nokta arası kuş uçuşu mesafe (metre). */
export function haversineMeters([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]) {
  return haversine({ lat: lat1, lon: lng1 }, { lat: lat2, lon: lng2 });
}

const kmFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** 850 → "850 m", 4230 → "4,2 km" */
export function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${kmFormat.format(meters / 1000)} km`;
}

const METERS_PER_DEG_LAT = 111_320;

/**
 * Bir çizgiyi (GeoJSON sırası: [boylam, enlem]) her segmenti için ince bir dörtgene çevirir.
 * MapLibre'de yerleşik "3D çizgi" katmanı olmadığından, bu dörtgenler fill-extrusion ile
 * yükseltilerek eğik (3D) görünümde havada duran bir şerit gibi çizilir.
 * Kısa mesafelerde yerel düzlem yaklaşımı (enleme göre boylam ölçeği) yeterli doğruluktadır.
 */
export function lineToRibbon(coordinates: number[][], widthMeters: number): number[][][][] {
  const half = widthMeters / 2;
  const polygons: number[][][][] = [];
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
    const dx = (lon2 - lon1) * metersPerDegLon;
    const dy = (lat2 - lat1) * METERS_PER_DEG_LAT;
    const length = Math.hypot(dx, dy);
    if (length < 0.5) continue; // üst üste binen noktalar
    // Segmente dik birim vektör × yarım genişlik, dereceye çevrilmiş
    const offLon = ((-dy / length) * half) / metersPerDegLon;
    const offLat = ((dx / length) * half) / METERS_PER_DEG_LAT;
    polygons.push([
      [
        [lon1 + offLon, lat1 + offLat],
        [lon2 + offLon, lat2 + offLat],
        [lon2 - offLon, lat2 - offLat],
        [lon1 - offLon, lat1 - offLat],
        [lon1 + offLon, lat1 + offLat],
      ],
    ]);
  }
  return polygons;
}
