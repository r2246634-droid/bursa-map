import type { JourneyLeg, RideLeg } from "./types";

/**
 * BursaKart tam bilet ücretleri — TAHMİNİ.
 *
 * Kaynak: 1 Ekim 2026'da yürürlüğe giren zamlı tarife (Bursa Büyükşehir Belediye Meclisi kararı,
 * yerel basında hat hat yayımlandı, ör. bursahakimiyet.com.tr). BURULAŞ verisinde hat başına ücret
 * kademesi olmadığından listede adı geçmeyen otobüs hatları "kısa hat" sayılır. Ücretler
 * değişince bu dosya güncellenmeli (FARES_AS_OF ile birlikte).
 */
export const FARES_AS_OF = "1 Ekim 2026";

/** TL */
const METRO_FARE = 50;
const TRAM_FARE = 40.75;
/** Listede olmayan otobüs hattı: "kısa hat" ücreti */
const DEFAULT_BUS_FARE = 47;

/** Tarifede ayrıca adı geçen hatlar */
const BUS_FARES: Record<string, number> = {
  "401": 200, // Orhangazi – Bursa Terminal
  "501": 200, // Yenişehir – Kestel
  "901": 225, // Karacabey – Üniversite İstasyonu
  "602": 262.5, // İnegöl – Bursa Terminal
  "904": 262.5, // Karacabey – Bursa Terminal
  "801": 275, // Mustafakemalpaşa – Üniversite İstasyonu
};

/** "Aktarma İndirimi 1" tam ücreti */
const TRANSFER_FARE = 21.5;
/** İlk binişten itibaren bu süre içinde… */
const TRANSFER_WINDOW_S = 90 * 60;
/** …en fazla bu kadar aktarma indirimli */
const MAX_DISCOUNTED_TRANSFERS = 3;
/** Bundan pahalı (ilçeler arası) hatlarda aktarma indirimi varsayılmaz */
const MAX_DISCOUNTABLE_FARE = 75;

export function rideFare(leg: Pick<RideLeg, "kind" | "line">): number {
  if (leg.kind === "metro") return METRO_FARE;
  if (leg.kind === "tram") return TRAM_FARE;
  return BUS_FARES[leg.line] ?? DEFAULT_BUS_FARE;
}

/**
 * Yolculuğun toplam tam bilet ücreti: ilk biniş tam ücret; ilk binişten 90 dakika içindeki
 * en fazla 3 aktarma indirimli (indirimli ücret hattın kendi ücretinden yüksekse hattınki).
 * Sadece yürüyüş 0 TL.
 */
export function journeyFare(legs: JourneyLeg[]): number {
  const rides = legs.filter((l): l is RideLeg => l.type === "ride");
  if (rides.length === 0) return 0;
  const firstBoarding = rides[0].departure;
  let discounted = 0;
  let total = 0;
  rides.forEach((ride, i) => {
    const full = rideFare(ride);
    const canDiscount =
      i > 0 &&
      discounted < MAX_DISCOUNTED_TRANSFERS &&
      ride.departure - firstBoarding <= TRANSFER_WINDOW_S &&
      full <= MAX_DISCOUNTABLE_FARE;
    if (canDiscount) {
      discounted++;
      total += Math.min(full, TRANSFER_FARE);
    } else {
      total += full;
    }
  });
  return Math.round(total * 100) / 100;
}

/** 68.5 → "68,50 TL", 0 → "Ücretsiz" */
export function formatFare(tl: number): string {
  if (tl === 0) return "Ücretsiz";
  return `${tl.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TL`;
}
