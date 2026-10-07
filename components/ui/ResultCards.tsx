"use client";

import { MapPin, Navigation, X } from "lucide-react";

import { LINE_NAMES } from "@/data/transit-network";
import type { Place } from "@/data/types";
import { useReverseGeocode } from "@/lib/use-reverse-geocode";

import { LineBadge, PlaceIcon, PlaceMeta, TransferTag, placeSubtitle } from "./PlaceVisuals";

interface ResultCardsProps {
  places: Place[];
  selected: Place | null;
  onSelect: (place: Place) => void;
  onClearSelection: () => void;
  /** "Buradan / Buraya yol tarifi": seçili yeri rotanın başlangıç veya varış noktası yapar */
  onDirections: (place: Place, end: "from" | "to") => void;
}

/**
 * Seçim yoksa: yatay kaydırılabilir (scroll-snap) sonuç kartları.
 * Seçim varsa: seçilen yerin bilgi kartı (istasyonsa geçen hatlarla birlikte).
 */
export default function ResultCards({
  places,
  selected,
  onSelect,
  onClearSelection,
  onDirections,
}: ResultCardsProps) {
  if (selected) {
    return (
      <div className="px-4 pb-3">
        {/* key: başka yer seçilince kartın iç durumu (adres) sıfırlansın */}
        <PlaceDetailCard
          key={selected.id}
          place={selected}
          onClose={onClearSelection}
          onDirections={onDirections}
        />
      </div>
    );
  }

  if (places.length === 0) return null;

  return (
    <ul className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-3">
      {places.map((place) => (
        <li key={place.id} className="snap-start">
          <button
            type="button"
            onClick={() => onSelect(place)}
            className="glass flex h-20 w-64 items-center gap-3 rounded-2xl p-3 text-left transition active:scale-[0.98]"
          >
            <PlaceIcon place={place} />
            <span className="min-w-0">
              <span className="line-clamp-2 text-sm font-medium text-slate-900">{place.name}</span>
              <PlaceMeta place={place} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

interface PlaceDetailCardProps {
  place: Place;
  onClose: () => void;
  onDirections: (place: Place, end: "from" | "to") => void;
}

function PlaceDetailCard({ place, onClose, onDirections }: PlaceDetailCardProps) {
  const geocode = useReverseGeocode(place.position);
  const resolved = geocode.status === "done" ? geocode.result : null;
  // Boş noktaya bırakılan iğnenin adı adres sorgusundan gelir ("Seçilen konum" yerine)
  const isPin = place.id.startsWith("pin-");
  const title = isPin && resolved?.name ? resolved.name : place.name;
  const routePlace = title === place.name ? place : { ...place, name: title };

  return (
    <article
      aria-label={`${place.name} bilgileri`}
      className="glass mx-auto max-w-md rounded-3xl p-4"
    >
      <header className="flex items-start gap-3">
        <PlaceIcon place={place} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-tight font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
            {placeSubtitle(place)}
            {place.kind === "station" && place.transfer && <TransferTag />}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Bilgi kartını kapat"
          className="-mt-1 -mr-1 rounded-full p-1.5 text-slate-500 hover:bg-slate-900/5"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {place.kind === "station" && (
        <section className="mt-3 border-t border-slate-900/10 pt-3">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Geçen hatlar
          </h3>
          <ul className="space-y-1.5">
            {place.lines.map((line) => (
              <li key={line} className="flex items-center gap-2 text-sm text-slate-800">
                <LineBadge line={line} />
                <span className="truncate">{LINE_NAMES[line]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-sm text-slate-600">
        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        {geocode.status === "loading" && <span className="text-slate-400">Adres yükleniyor…</span>}
        {geocode.status === "error" && <span className="text-slate-400">Adres alınamadı</span>}
        {geocode.status === "done" && (resolved?.address || formatCoords(place.position))}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onDirections(routePlace, "to")}
          className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-blue-600 text-sm font-medium text-white active:scale-[0.98]"
        >
          <Navigation className="h-4 w-4" aria-hidden />
          Buraya git
        </button>
        <button
          type="button"
          onClick={() => onDirections(routePlace, "from")}
          className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-blue-50 text-sm font-medium text-blue-700 active:scale-[0.98]"
        >
          Buradan başla
        </button>
      </div>
    </article>
  );
}

const coordFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 5 });
const formatCoords = ([lat, lng]: [number, number]) => `${coordFormat.format(lat)}, ${coordFormat.format(lng)}`;
