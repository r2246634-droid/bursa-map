"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, X } from "lucide-react";

import type { RouteEndpoints } from "@/components/map/RouteOverlay";
import type { Place } from "@/data/types";
import { formatDistance, haversineMeters } from "@/lib/geo";
import type { JourneysState } from "@/lib/routing/client";

import JourneyList from "./JourneyList";
import PlaceCombobox from "./PlaceCombobox";

/** Yol tarifinde uç nokta bir yer olmalı; otobüs hatları önerilmez */
const isEndpointCandidate = (place: Place) => place.kind !== "line";

interface RoutePanelProps extends RouteEndpoints {
  open: boolean;
  onChange: (route: RouteEndpoints) => void;
  onClose: () => void;
  /** Panelin görünen yüksekliği; harita odaklanırken bu alanı boş bırakır */
  onHeightChange: (height: number) => void;
  /** Sunucudan (RAPTOR) gelen yol tarifi seçenekleri */
  journeys: JourneysState;
  selectedJourney: number;
  onSelectJourney: (index: number) => void;
}

/**
 * Alttan açılan "Yol Tarifi" paneli. Kapalıyken de DOM'da kalır (kaydırma animasyonu ve
 * yazılan metinlerin korunması için); `inert` ile odak ve ekran okuyucudan gizlenir.
 */
export default function RoutePanel({
  open,
  from,
  to,
  onChange,
  onClose,
  onHeightChange,
  journeys,
  selectedJourney,
  onSelectJourney,
}: RoutePanelProps) {
  const sheetRef = useRef<HTMLElement>(null);
  // Kutudaki metin seçili yerden bağımsız: kullanıcı yazarken seçim temizlenir
  const [fromText, setFromText] = useState(from?.name ?? "");
  const [toText, setToText] = useState(to?.name ?? "");

  // Uç nokta panel dışından seçilirse (haritadaki "Buraya git", haritaya dokunma) kutuyu güncelle.
  // Seçim temizlendiğinde (kullanıcı yazarken) metne dokunmuyoruz.
  // Efekt yerine render sırasında güncelliyoruz: ekstra bir render turunu önler
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
  const [prevFrom, setPrevFrom] = useState(from);
  const [prevTo, setPrevTo] = useState(to);
  if (from !== prevFrom) {
    setPrevFrom(from);
    if (from) setFromText(from.name);
  }
  if (to !== prevTo) {
    setPrevTo(to);
    if (to) setToText(to.name);
  }

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const observer = new ResizeObserver(() => onHeightChange(open ? sheet.offsetHeight : 0));
    observer.observe(sheet);
    onHeightChange(open ? sheet.offsetHeight : 0);
    return () => observer.disconnect();
  }, [open, onHeightChange]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const typeFrom = (text: string) => {
    setFromText(text);
    if (from) onChange({ from: null, to });
  };
  const typeTo = (text: string) => {
    setToText(text);
    if (to) onChange({ from, to: null });
  };
  const selectFrom = (place: Place) => {
    setFromText(place.name);
    onChange({ from: place, to });
  };
  const selectTo = (place: Place) => {
    setToText(place.name);
    onChange({ from, to: place });
  };
  const swap = () => {
    setFromText(toText);
    setToText(fromText);
    onChange({ from: to, to: from });
  };

  const distance = from && to ? haversineMeters(from.position, to.position) : null;

  return (
    <section
      ref={sheetRef}
      role="dialog"
      aria-label="Yol tarifi"
      aria-hidden={!open}
      inert={!open}
      className={`absolute inset-x-0 bottom-0 z-[1100] mx-auto max-h-[88%] max-w-lg overflow-y-auto overscroll-contain rounded-t-3xl bg-white/95 px-4 pt-2 pb-4 shadow-[0_-8px_30px_rgb(15_23_42/0.15)] backdrop-blur-md transition-transform duration-300 ease-out ${
        open ? "translate-y-0" : "translate-y-full"
      }`}
    >
      <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />

      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">Yol Tarifi</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Yol tarifini kapat"
          className="rounded-full p-1.5 text-slate-500 hover:bg-slate-900/5"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <PlaceCombobox
            value={fromText}
            onChange={typeFrom}
            onSelect={selectFrom}
            placeholder="Nereden?"
            ariaLabel="Nereden"
            listPlacement="inline"
            filter={isEndpointCandidate}
            leading={<EndpointDot variant="from" />}
            fieldClassName="h-12 rounded-2xl bg-slate-100 px-3"
          />
          <PlaceCombobox
            value={toText}
            onChange={typeTo}
            onSelect={selectTo}
            placeholder="Nereye?"
            ariaLabel="Nereye"
            listPlacement="inline"
            filter={isEndpointCandidate}
            leading={<EndpointDot variant="to" />}
            fieldClassName="h-12 rounded-2xl bg-slate-100 px-3"
          />
        </div>
        <button
          type="button"
          onClick={swap}
          disabled={!fromText && !toText}
          aria-label="Başlangıç ve varış noktalarını değiştir"
          className="mt-7 flex h-10 w-10 shrink-0 items-center justify-center self-start rounded-full text-slate-600 hover:bg-slate-900/5 disabled:opacity-40"
        >
          <ArrowUpDown className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4">
        {distance !== null ? (
          <>
            <JourneyList state={journeys} selectedIndex={selectedJourney} onSelect={onSelectJourney} />
            <p className="mt-2 px-1 text-xs text-slate-400">
              Kuş uçuşu mesafe: <span className="tabular-nums">{formatDistance(distance)}</span>
            </p>
          </>
        ) : (
          <p className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            {from || to ? "Diğer noktayı da seçin." : "Başlangıç ve varış noktasını seçin."}
          </p>
        )}
      </div>
    </section>
  );
}

function EndpointDot({ variant }: { variant: "from" | "to" }) {
  return (
    <span
      aria-hidden
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
        variant === "from" ? "bg-emerald-600" : "bg-rose-600"
      }`}
    >
      {variant === "from" ? "A" : "B"}
    </span>
  );
}
