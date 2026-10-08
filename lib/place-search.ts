"use client";

import { useSyncExternalStore } from "react";

import { PLACE_BY_ID, PLACES } from "@/data/places";
import type { Place } from "@/data/types";

import { loadBusData } from "./burulas";
import { createSearchIndex, type SearchIndex } from "./search";

/**
 * Uygulama genelinde tek arama indeksi.
 * Başta sadece küçük statik yerlerle (öne çıkan noktalar + metro/tramvay istasyonları) kurulur;
 * BURULAŞ verisi (409 hat, ~7.500 durak) ilk ihtiyaçta yüklenince indeks yeniden kurulur ve
 * abone bileşenler (arama kutuları, sonuç kartları) güncellenir.
 */

/**
 * Sıralamada eşit puanlı sonuçlardan önce gelecekler (düşük = önce):
 * öne çıkan noktalar ve raylı istasyonlar binlerce otobüs durağının arasında kaybolmasın.
 */
function boostOf(place: Place): number {
  if (place.kind === "poi") return -0.3;
  if (place.kind === "station" && place.mode !== "bus") return -0.3;
  if (place.kind === "line") return -0.1;
  return 0;
}

let index: SearchIndex<Place> = createSearchIndex(PLACES, boostOf);
const placeById = new Map(PLACE_BY_ID);
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

/** BURULAŞ verisini yükleyip arama indeksine ekler (birden çok çağrı tek yükleme yapar) */
export function ensureBusPlacesLoaded(): Promise<void> {
  loading ??= loadBusData()
    .then(({ linePlaces, stopPlaces }) => {
      for (const p of [...linePlaces, ...stopPlaces]) placeById.set(p.id, p);
      index = createSearchIndex([...PLACES, ...linePlaces, ...stopPlaces], boostOf);
      for (const listener of listeners) listener();
    })
    .catch((error) => {
      loading = null;
      console.error("BURULAŞ verisi yüklenemedi", error);
    });
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Güncel arama indeksi; BURULAŞ verisi yüklenince bileşen yeniden çizilir */
export function usePlaceIndex(): SearchIndex<Place> {
  return useSyncExternalStore(subscribe, () => index, () => index);
}

/** Haritada tıklanan öğenin kimliğinden yeri bulur (otobüs durakları yüklendiyse onlar dahil) */
export function findPlaceById(id: string): Place | undefined {
  return placeById.get(id);
}
