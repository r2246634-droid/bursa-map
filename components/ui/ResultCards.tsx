"use client";

import { MapPin, Navigation, X } from "lucide-react";
import type { ReactNode } from "react";

import { LINE_NAMES } from "@/data/transit-network";
import type { BusLine, Place } from "@/data/types";
import { DIRECTION_LABEL, DIRECTION_ORDER, formatStopName } from "@/lib/burulas";
import { useReverseGeocode } from "@/lib/use-reverse-geocode";

import FavoriteButton from "./FavoriteButton";
import { LineBadge, PlaceIcon, PlaceMeta, TransferTag, placeSubtitle } from "./PlaceVisuals";

interface ResultCardsProps {
  places: Place[];
  selected: Place | null;
  onSelect: (place: Place) => void;
  onClearSelection: () => void;
  /** "Buradan / Buraya yol tarifi": seçili yeri rotanın başlangıç veya varış noktası yapar */
  onDirections: (place: Place, end: "from" | "to") => void;
  /** Durak kartındaki bir otobüs hattına dokunuldu */
  onSelectLine: (code: string) => void;
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
  onSelectLine,
}: ResultCardsProps) {
  if (selected) {
    return (
      <div className="px-4 pb-3">
        {selected.kind === "line" ? (
          <LineDetailCard place={selected} line={selected.line} onClose={onClearSelection} />
        ) : (
          // key: başka yer seçilince kartın iç durumu (adres) sıfırlansın
          <PlaceDetailCard
            key={selected.id}
            place={selected}
            onClose={onClearSelection}
            onDirections={onDirections}
            onSelectLine={onSelectLine}
          />
        )}
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

/** Kartların ortak çerçevesi: ikon, başlık, alt başlık, kaydet ve kapat düğmeleri */
function CardShell({
  place,
  favoritePlace = place,
  title,
  subtitle,
  onClose,
  children,
}: {
  place: Place;
  /** Kaydedilecek hali (ör. bırakılan iğnenin adres sorgusundan gelen adı) */
  favoritePlace?: Place;
  title: string;
  subtitle: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <article aria-label={`${title} bilgileri`} className="glass mx-auto max-w-md rounded-3xl p-4">
      <header className="flex items-start gap-3">
        <PlaceIcon place={place} className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base leading-tight font-semibold text-slate-900">{title}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">{subtitle}</p>
        </div>
        <div className="-mt-1 -mr-1 flex items-center">
          <FavoriteButton place={favoritePlace} />
          <button
            type="button"
            onClick={onClose}
            aria-label="Bilgi kartını kapat"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-900/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>
      {children}
    </article>
  );
}

/** Otobüs hattı: yönler, her yönün başlangıç → bitiş durağı ve durak sayısı */
function LineDetailCard({ place, line, onClose }: { place: Place; line: BusLine; onClose: () => void }) {
  const directions = DIRECTION_ORDER.filter((d) => line.termini[d]);
  return (
    <CardShell place={place} title={`${line.code} hattı`} subtitle={placeSubtitle(place)} onClose={onClose}>
      <ul className="mt-3 space-y-2 border-t border-slate-900/10 pt-3">
        {directions.map((dir) => {
          const [from, to] = line.termini[dir]!;
          return (
            <li key={dir} className="text-sm">
              <span className="mr-2 inline-block w-12 text-xs font-medium tracking-wide text-slate-500 uppercase">
                {DIRECTION_LABEL[dir]}
              </span>
              <span className="text-slate-800">
                {formatStopName(from).name} → {formatStopName(to).name}
              </span>
              <span className="ml-1.5 text-xs whitespace-nowrap text-slate-400">
                {line.stopCount[dir]} durak
              </span>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

interface PlaceDetailCardProps {
  place: Place;
  onClose: () => void;
  onDirections: (place: Place, end: "from" | "to") => void;
  onSelectLine: (code: string) => void;
}

function PlaceDetailCard({ place, onClose, onDirections, onSelectLine }: PlaceDetailCardProps) {
  const geocode = useReverseGeocode(place.position);
  const resolved = geocode.status === "done" ? geocode.result : null;
  // Boş noktaya bırakılan iğnenin adı adres sorgusundan gelir ("Seçilen konum" yerine)
  const isPin = place.id.startsWith("pin-");
  const title = isPin && resolved?.name ? resolved.name : place.name;
  const routePlace = title === place.name ? place : { ...place, name: title };

  return (
    <CardShell
      place={place}
      favoritePlace={routePlace}
      title={title}
      onClose={onClose}
      subtitle={
        <>
          {placeSubtitle(place)}
          {place.kind === "station" && place.transfer && <TransferTag />}
        </>
      }
    >
      {place.kind === "station" && place.mode === "bus" && (
        <section className="mt-3 border-t border-slate-900/10 pt-3">
          <h3 className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Geçen hatlar ({place.lines.length})
          </h3>
          <ul className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
            {place.lines.map((code) => (
              <li key={code}>
                <button
                  type="button"
                  onClick={() => onSelectLine(code)}
                  aria-label={`${code} hattını haritada göster`}
                  className="rounded-md active:scale-95"
                >
                  <LineBadge line={code} bus />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {place.kind === "station" && place.mode !== "bus" && (
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
    </CardShell>
  );
}

const coordFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 5 });
const formatCoords = ([lat, lng]: [number, number]) => `${coordFormat.format(lat)}, ${coordFormat.format(lng)}`;
