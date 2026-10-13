"use client";

import { useSyncExternalStore } from "react";

import { PLACE_BY_ID, PLACES } from "@/data/places";
import type { Place } from "@/data/types";

import { approxDistanceM, loadAmenities } from "./amenities";
import { loadBusData } from "./burulas";
import { BURSA_CENTER } from "./map-config";
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
  // Binlerce market/cami/okul, aynı puanlı durak ve adreslerin arkasında kalsın
  if (place.kind === "amenity") return 0.3;
  return 0;
}

let index: SearchIndex<Place> = createSearchIndex(PLACES, placeBoost);
const placeById = new Map(PLACE_BY_ID);
const listeners = new Set<() => void>();
/** Tembel yüklenen gruplar (otobüs, çevredeki yerler): indeks her yüklemede hepsiyle yeniden kurulur */
let busPlaces: Place[] = [];
let amenityPlaces: Place[] = [];
let loading: Promise<void> | null = null;
let amenityLoading: Promise<void> | null = null;

function rebuildIndex() {
  index = createSearchIndex([...PLACES, ...busPlaces, ...amenityPlaces], placeBoost);
  for (const listener of listeners) listener();
}

/** BURULAŞ verisini yükleyip arama indeksine ekler (birden çok çağrı tek yükleme yapar) */
export function ensureBusPlacesLoaded(): Promise<void> {
  loading ??= loadBusData()
    .then(({ linePlaces, stopPlaces }) => {
      busPlaces = [...linePlaces, ...stopPlaces];
      for (const p of busPlaces) placeById.set(p.id, p);
      rebuildIndex();
    })
    .catch((error) => {
      loading = null;
      console.error("BURULAŞ verisi yüklenemedi", error);
    });
  return loading;
}

/**
 * Çevredeki yerleri (market, okul, eczane…) yükleyip haritada tıklanabilir ve aranabilir yapar.
 * Adsız olanlar (ör. adsız park) aramaya girmez, haritada dokunulunca yine bulunur.
 */
export function ensureAmenityPlacesLoaded(): Promise<void> {
  amenityLoading ??= loadAmenities()
    .then(({ places, searchable }) => {
      for (const p of places) placeById.set(p.id, p);
      amenityPlaces = searchable;
      rebuildIndex();
    })
    .catch((error) => {
      amenityLoading = null;
      console.error("Çevredeki yerler yüklenemedi", error);
    });
  return amenityLoading;
}

/** Arama kutusuna odaklanınca: aranabilecek tüm tembel veriler */
export function ensureSearchDataLoaded(): void {
  void ensureBusPlacesLoaded();
  void ensureAmenityPlacesLoaded();
}

/** Haritanın baktığı nokta [enlem, boylam]; MapView her kamera hareketi bitince günceller */
let viewCenter: [number, number] = [BURSA_CENTER[1], BURSA_CENTER[0]];
export function setSearchCenter(center: [number, number]) {
  viewCenter = center;
}

/**
 * Aynı puanlı sonuçlarda (ör. "a101" → yüzlerce A101) haritanın baktığı yere yakın olan öne
 * geçsin. Sadece çevredeki yerlere uygulanır; diğerleri ad sırasında kalır.
 */
export function nearViewFirst(place: Place): number {
  return place.kind === "amenity" ? approxDistanceM(viewCenter, place.position) : 0;
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
