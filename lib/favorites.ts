"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { Place } from "@/data/types";

/**
 * Kayıtlı yerler ve hatlar (tarayıcıda, localStorage).
 *
 * Kayıt kararlı kimliklerle tutulur ve açılışta güncel veriyle eşleştirilir:
 *   metro-bursaspor-acemler, tram-heykel        (raylı istasyonlar, scripts/fetch-bursaray.mjs)
 *   bus-stop-3467                                (BURULAŞ durak no)
 *   bus-line-22C                                 (BURULAŞ hat kodu)
 *   btu-mimar-sinan, bursa-terminal              (öne çıkan noktalar, scripts/fetch-pois.mjs)
 * Böylece veri yenilense de (ad, konum, geçen hatlar) kayıtlar güncel bilgiyi gösterir.
 *
 * İstisna: haritadan dokunulan altlık yerleri ve bırakılan iğneler ("feature") hiçbir veri
 * setinde yok; bunlar için küçük bir anlık görüntü (ad, konum, kategori) saklanır.
 */

type FeatureSnapshot = Extract<Place, { kind: "feature" }>;

export interface FavoriteEntry {
  id: string;
  savedAt: number;
  snapshot?: FeatureSnapshot;
}

interface FavoritesState {
  entries: FavoriteEntry[];
  toggle: (place: Place) => void;
  remove: (id: string) => void;
}

export const useFavorites = create<FavoritesState>()(
  persist(
    (set) => ({
      entries: [],
      toggle: (place) =>
        set(({ entries }) =>
          entries.some((e) => e.id === place.id)
            ? { entries: entries.filter((e) => e.id !== place.id) }
            : {
                entries: [
                  {
                    id: place.id,
                    savedAt: Date.now(),
                    snapshot:
                      place.kind === "feature"
                        ? {
                            kind: "feature",
                            id: place.id,
                            name: place.name,
                            position: place.position,
                            category: place.category,
                          }
                        : undefined,
                  },
                  ...entries,
                ],
              },
        ),
      remove: (id) => set(({ entries }) => ({ entries: entries.filter((e) => e.id !== id) })),
    }),
    {
      name: "bursa-map:favorites",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ entries }) => ({ entries }),
      // Sunucuda üretilen HTML'de kayıt yok; tarayıcıda ilk çizim de aynı olsun diye
      // localStorage'ı yükleme işini ilk render sonrasına (useHydrateFavorites) bırakıyoruz.
      // Aksi halde ör. alt menüdeki sayaç hydration uyuşmazlığı hatası verir.
      skipHydration: true,
    },
  ),
);

/** Uygulama kabuğunda bir kez çağrılır: kayıtları localStorage'dan yükler */
export function useHydrateFavorites() {
  useEffect(() => {
    void useFavorites.persist.rehydrate();
  }, []);
}

export const useIsFavorite = (id: string) => useFavorites((s) => s.entries.some((e) => e.id === id));
export const useFavoriteCount = () => useFavorites((s) => s.entries.length);
