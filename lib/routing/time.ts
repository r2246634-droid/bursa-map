/**
 * Sefer saatleri ve süre tahmini yardımcıları.
 *
 * Veri setinde her hattın sadece ilk duraktan kalkış saatleri var. Ara duraklara varış saati,
 * duraklar arası kuş uçuşu mesafe (Haversine) ve ortalama araç hızıyla tahmin edilir.
 */

export const SECONDS_PER_DAY = 24 * 60 * 60;

/** "08:30" veya "08:30:00" → 30600 */
export function parseClock(text: string): number {
  const [h, m, s = "0"] = text.split(":");
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** 30600 → "08:30" (gece yarısını geçen saatler 24 saat içine katlanır) */
export function formatClock(seconds: number): string {
  const rounded = Math.round(seconds / 60) * 60;
  const t = ((rounded % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

interface LatLon {
  lat: number;
  lon: number;
}

/** İki nokta arası kuş uçuşu mesafe (metre), Haversine formülü */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

export interface TravelTimeOptions {
  /** Ortalama hız (km/s), duraklarda bekleme dahil. Şehir içi otobüs için 20 km/s */
  speedKmh: number;
  /**
   * Yol katsayısı: araç duraklar arasında düz çizgide değil sokaklarda gider.
   * Kuş uçuşu mesafe bu katsayıyla çarpılır (1 = tam kuş uçuşu).
   */
  roadFactor?: number;
}

/**
 * Bir sefer deseninde her durağa ilk duraktan itibaren kaç saniyede varıldığını tahmin eder.
 *
 *   offset[0] = 0
 *   offset[i] = offset[i-1] + haversine(durak[i-1], durak[i]) × yolKatsayısı / hız
 *
 * Sonuç tüm seferler için aynıdır (trafik/saat farkı yok sayılır); bir seferin i. duraktaki
 * saati = kalkış + offset[i] (bkz. interpolateStopTimes).
 */
export function estimateStopOffsets(stops: LatLon[], { speedKmh, roadFactor = 1 }: TravelTimeOptions): number[] {
  const metersPerSecond = (speedKmh * 1000) / 3600;
  const offsets = [0];
  for (let i = 1; i < stops.length; i++) {
    const meters = haversineMeters(stops[i - 1], stops[i]) * roadFactor;
    offsets.push(offsets[i - 1] + meters / metersPerSecond);
  }
  return offsets;
}

/**
 * İlk duraktan kalkış saatinden (saniye) her durağa tahmini varış saatini üretir.
 * Örnek: 08:00 kalkış, 20 km/s, duraklar 0 / 400 / 900 m → 08:00, 08:01:12, 08:02:42
 */
export function interpolateStopTimes(departure: number, offsets: number[]): number[] {
  return offsets.map((offset) => departure + offset);
}
