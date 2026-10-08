import type { Place } from "@/data/types";

import { BURSA_BOUNDS } from "./map-config";

/**
 * Cihazın anlık konumunu yol tarifi başlangıcı olarak alır.
 *
 * Tarayıcılar konumu sadece güvenli bağlamda (HTTPS veya localhost) verir; yerel ağ adresiyle
 * (http://10.x.x.x) açılan sayfada konum hiç sorulmaz — bu durum ayrıca bildirilir.
 */

export const MY_LOCATION_ID = "my-location";

export type LocationErrorReason = "insecure" | "unsupported" | "denied" | "unavailable" | "timeout" | "outside";

export class LocationError extends Error {
  constructor(public readonly reason: LocationErrorReason) {
    super(reason);
    this.name = "LocationError";
  }
}

const MESSAGES: Record<LocationErrorReason, string> = {
  insecure: "Konum için sayfanın güvenli bağlantıyla (HTTPS) açılması gerekiyor.",
  unsupported: "Bu cihaz veya tarayıcı konum paylaşmayı desteklemiyor.",
  denied: "Konum izni verilmedi. Tarayıcı ayarlarından bu site için konuma izin verebilirsiniz.",
  unavailable: "Konum bulunamadı. Konum servislerinin açık olduğundan emin olun.",
  timeout: "Konum zamanında alınamadı, tekrar deneyin.",
  outside: "Konumunuz Bursa dışında görünüyor; başlangıç noktasını aramadan seçin.",
};

export function locationErrorMessage(error: unknown): string {
  return error instanceof LocationError ? MESSAGES[error.reason] : MESSAGES.unavailable;
}

const [west, south, east, north] = BURSA_BOUNDS;

/** Konumu "Konumum" yerine çevirir (yol tarifinde başlangıç olarak kullanılır) */
export function myLocationPlace(lat: number, lon: number): Place {
  return { kind: "feature", id: MY_LOCATION_ID, name: "Konumum", category: "Mevcut konum", position: [lat, lon] };
}

export function getCurrentPlace({ timeoutMs = 10_000 } = {}): Promise<Place> {
  if (!globalThis.isSecureContext) return Promise.reject(new LocationError("insecure"));
  const geo = globalThis.navigator?.geolocation;
  if (!geo) return Promise.reject(new LocationError("unsupported"));

  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      ({ coords }) => {
        const { latitude: lat, longitude: lon } = coords;
        if (lat < south || lat > north || lon < west || lon > east) reject(new LocationError("outside"));
        else resolve(myLocationPlace(lat, lon));
      },
      (error) => {
        // GeolocationPositionError kodları: 1 izin yok, 2 konum yok, 3 zaman aşımı
        const reason: LocationErrorReason =
          error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
        reject(new LocationError(reason));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

/**
 * Konum izni daha önce verilmiş mi? Verilmişse başlangıç noktası sormadan doldurulabilir;
 * verilmemişse kullanıcı butona basmadan izin penceresi açılmaz.
 */
export async function locationPermissionGranted(): Promise<boolean> {
  try {
    if (!globalThis.isSecureContext || !globalThis.navigator?.permissions) return false;
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state === "granted";
  } catch {
    return false;
  }
}
