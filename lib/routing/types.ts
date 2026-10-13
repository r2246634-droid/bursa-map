/**
 * Yol tarifi API'sinin (app/api/route) cevap tipleri. Hem sunucu hem tarayıcı kullanır;
 * bu dosya sadece tip içerir.
 *
 * Saatler: Türkiye saatine göre gece yarısından itibaren saniye (ör. 08:30 → 30600).
 */

export type TransitKind = "bus" | "metro" | "tram";

export interface RoutePoint {
  name: string;
  lat: number;
  lon: number;
  /** BURULAŞ durak numarası (durak ise) */
  stopId?: number;
}

export interface WalkLeg {
  type: "walk";
  from: RoutePoint;
  to: RoutePoint;
  /** Yürüme mesafesi: sokak ağından (streetRouted) ya da kuş uçuşu × 1,25 tahmini */
  meters: number;
  departure: number;
  arrival: number;
  /** Sokaklardan geçen güzergâh, [boylam, enlem]; yoksa haritada düz çizgi çizilir */
  path?: [number, number][];
  streetRouted?: boolean;
}

export interface RideLeg {
  type: "ride";
  /** Hat kodu, ör. "22C", "M1" */
  line: string;
  kind: TransitKind;
  /** G = gidiş, D = dönüş, R = ring */
  direction: "G" | "D" | "R";
  /** Aracın gittiği son durak (yön tabelası) */
  headsign: string;
  from: RoutePoint;
  to: RoutePoint;
  departure: number;
  arrival: number;
  /** Binilen duraktan inilen durağa kadar geçilen durak sayısı */
  stopCount: number;
  /** Duraklar üzerinden çizgi, [boylam, enlem] */
  path: [number, number][];
  /** Varış saati ilk durak kalkışından hız varsayımıyla tahmin edildi */
  estimated: true;
}

export type JourneyLeg = WalkLeg | RideLeg;

export interface Journey {
  /** Başlangıç noktasından çıkış */
  departure: number;
  arrival: number;
  durationMin: number;
  transfers: number;
  walkMeters: number;
  /** Yürüme + araç güzergâhı toplam mesafe (metre) */
  distanceMeters: number;
  /** Tahmini BursaKart tam bilet toplamı (TL, aktarma indirimi dahil; bkz. fares.ts) */
  fare: number;
  legs: JourneyLeg[];
  /**
   * Kullanıcıya gösterilecek etiketler (raptor.ts → JOURNEY_TAGS): hangi ölçütte en iyi olduğu
   * ("En hızlı", "En ucuz"…) ve "Yürüyerek"
   */
  tags: string[];
}

export interface RouteResponse {
  journeys: Journey[];
  /** 1 = Pazartesi … 7 = Pazar */
  serviceDay: number;
  queryTime: number;
  /** Uyarılar (ör. sefer saati tahmini, sonuç bulunamadı nedeni) */
  notes: string[];
}

export interface RouteErrorResponse {
  error: string;
}
