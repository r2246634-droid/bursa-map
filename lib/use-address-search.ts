"use client";

import { useEffect, useState } from "react";

import type { Place } from "@/data/types";

import { cachedAddresses, searchAddresses } from "./geocode";

export type AddressSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; places: Place[] }
  | { status: "error" };

/** Kullanıcı yazmayı bırakınca istek atılır; her tuşta değil */
const DEBOUNCE_MS = 500;
/** Daha kısa sorgular adres aramasında anlamlı sonuç vermiyor */
const MIN_LENGTH = 3;

const IDLE: AddressSearchState = { status: "idle" };
const LOADING: AddressSearchState = { status: "loading" };

/**
 * Arama kutusundaki metinle adres arar (Photon, lib/geocode.ts). Metin değişince bekleyen
 * istek iptal edilir; boş/kısa metinde "idle" döner. Önbellekteki sorgu beklemeden gösterilir.
 */
export function useAddressSearch(query: string): AddressSearchState {
  const trimmed = query.trim();
  const key = trimmed.length >= MIN_LENGTH ? trimmed : null;
  // Sonuç hangi sorguya ait olduğuyla saklanır: sorgu değişince "yükleniyor" durumu
  // efekt içinde setState ile değil, anahtar uyuşmazlığından türetilir (use-reverse-geocode.ts gibi)
  const [entry, setEntry] = useState<{ key: string; state: AddressSearchState } | null>(null);

  useEffect(() => {
    if (key === null || cachedAddresses(key)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAddresses(key, controller.signal)
        .then((places) => setEntry({ key, state: { status: "done", places } }))
        .catch((error: unknown) => {
          if ((error as Error).name !== "AbortError") setEntry({ key, state: { status: "error" } });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);

  if (key === null) return IDLE;
  const cached = cachedAddresses(key);
  if (cached) return { status: "done", places: cached };
  return entry && entry.key === key ? entry.state : LOADING;
}
