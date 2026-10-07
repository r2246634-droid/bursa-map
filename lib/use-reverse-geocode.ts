"use client";

import { useEffect, useState } from "react";

import { reverseGeocode, type ReverseGeocodeResult } from "./reverse-geocode";

type State =
  | { status: "loading" }
  | { status: "done"; result: ReverseGeocodeResult | null }
  | { status: "error" };

const LOADING: State = { status: "loading" };

/** Konumun adresini getirir; konum değişince önceki istek iptal edilir. */
export function useReverseGeocode(position: [number, number] | null): State {
  const [lat, lng] = position ?? [null, null];
  const key = lat === null ? null : `${lat},${lng}`;
  // Sonucu hangi konuma ait olduğuyla birlikte saklıyoruz: konum değişince "yükleniyor"
  // durumu efekt içinde setState ile değil, anahtar uyuşmazlığından türetiliyor
  const [entry, setEntry] = useState<{ key: string; state: State } | null>(null);

  useEffect(() => {
    if (lat === null || lng === null) return;
    const requestKey = `${lat},${lng}`;
    const controller = new AbortController();
    reverseGeocode([lat, lng], controller.signal)
      .then((result) => setEntry({ key: requestKey, state: { status: "done", result } }))
      .catch((error: unknown) => {
        if ((error as Error).name !== "AbortError") {
          setEntry({ key: requestKey, state: { status: "error" } });
        }
      });
    return () => controller.abort();
  }, [lat, lng]);

  return entry && entry.key === key ? entry.state : LOADING;
}
