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
 * Sıralama önceliği (puana eklenir, düşük = önce). Puanlar: 0 tam eşleşme, 1 baştan eşleşme,
 * 2 kelime başı eşleşme (lib/search.ts).
 *
 * Öne çıkan noktalar ve raylı istasyonlar binlerce otobüs durağının arasında kaybolmasın diye
 * -1,1: böylece ör. "acemler" aramasında kelime başı eşleşen metro istasyonu "Bursaspor/Acemler"
 * (2 − 1,1 = 0,9), baştan eşleşen otobüs durağı "Acemler 1"in (1) önüne geçer.
 * Bilinçli sonuç: baştan eşleşen bir aktarma merkezi/istasyon (1 − 1,1 = −0,1), adı aramayla
 * birebir aynı olan bir otobüs durağının (0) da önüne geçer — bu ikisi toplamsal öncelikle
 * aynı anda sağlanamaz; önemli yeri öne almak tercih edildi.
 */
export function placeBoost(place: Place): number {
  if (place.kind === "poi") return -1.1;
  if (place.kind === "station" && place.mode !== "bus") return -1.1;
  if (place.kind === "line") return -0.1;
  return 0;
}

let index: SearchIndex<Place> = createSearchIndex(PLACES, placeBoost);
const placeById = new Map(PLACE_BY_ID);
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;

/** BURULAŞ verisini yükleyip arama indeksine ekler (birden çok çağrı tek yükleme yapar) */
export function ensureBusPlacesLoaded(): Promise<void> {
  loading ??= loadBusData()
    .then(({ linePlaces, stopPlaces }) => {
      for (const p of [...linePlaces, ...stopPlaces]) placeById.set(p.id, p);
      index = createSearchIndex([...PLACES, ...linePlaces, ...stopPlaces], placeBoost);
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
