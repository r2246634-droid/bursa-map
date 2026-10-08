"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, Clock, LocateFixed, X } from "lucide-react";

import type { RouteEndpoints } from "@/components/map/RouteOverlay";
import type { Place } from "@/data/types";
import { formatDistance, haversineMeters } from "@/lib/geo";
import type { JourneysState } from "@/lib/routing/client";

import JourneyList, { JourneySummary } from "./JourneyList";
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
  /** Kalkış saati (datetime-local değeri); null = şimdi */
  departAt: string | null;
  onDepartAtChange: (value: string | null) => void;
  selectedJourney: number;
  onSelectJourney: (index: number) => void;
  /** Küçültülmüş: sadece seçili rotanın özeti görünür, harita alanı büyür */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** "Konumum": cihaz konumunu başlangıç yapar */
  onUseMyLocation: () => void;
  /** Konum alınıyor (buton dönen simgeye geçer) */
  locating: boolean;
}

/** Tutamaçta bu kadar pikselden uzun sürükleme, dokunma değil kaydırma sayılır */
const DRAG_THRESHOLD_PX = 40;

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
  departAt,
  onDepartAtChange,
  selectedJourney,
  onSelectJourney,
  collapsed,
  onCollapsedChange,
  onUseMyLocation,
  locating,
}: RoutePanelProps) {
  // Tutamaç: aşağı sürükle → küçült, yukarı sürükle → büyüt, dokun (veya Enter) → aç/kapa
  const dragStartY = useRef<number | null>(null);
  const dragged = useRef(false);
  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      dragStartY.current = e.clientY;
      dragged.current = false;
      try {
        // Parmak tutamaçtan kaysa da bırakma olayı buraya gelsin
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Yakalama desteklenmiyorsa (eski tarayıcı) sürükleme yine çalışır, sadece daha hassas olur
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (dragStartY.current === null) return;
      const dy = e.clientY - dragStartY.current;
      dragStartY.current = null;
      if (Math.abs(dy) < DRAG_THRESHOLD_PX) return; // dokunma: onClick halleder
      dragged.current = true;
      onCollapsedChange(dy > 0);
    },
    onPointerCancel: () => {
      dragStartY.current = null;
    },
    onClick: () => {
      // Sürüklemenin ardından gelen click olayı ikinci kez değiştirmesin
      if (dragged.current) {
        dragged.current = false;
        return;
      }
      onCollapsedChange(!collapsed);
    },
  };

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
      <button
        type="button"
        {...handleProps}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Yol tarifi panelini büyüt" : "Yol tarifi panelini küçült, haritayı göster"}
        className="-mx-4 -mt-2 mb-1 flex h-6 w-[calc(100%+2rem)] cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-1.5 w-10 rounded-full bg-slate-300" aria-hidden />
      </button>

      <header className={`flex items-center justify-between ${collapsed ? "mb-1" : "mb-3"}`}>
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

      {collapsed && (
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          className="w-full rounded-xl px-1 py-1 text-left hover:bg-slate-900/5"
        >
          {from && to ? (
            <JourneySummary state={journeys} selectedIndex={selectedJourney} />
          ) : (
            <span className="text-sm text-slate-500">Başlangıç ve varış seçmek için yukarı kaydırın</span>
          )}
        </button>
      )}

      {/* Küçültülünce gizlenir ama DOM'da kalır: yazılan metinler ve seçimler korunur */}
      <div hidden={collapsed}>
        <div className="flex items-stretch gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <PlaceCombobox
              value={fromText}
              onChange={typeFrom}
              onSelect={selectFrom}
              placeholder="Nereden?"
              ariaLabel="Nereden"
              trailingWhenEmpty={
                <button
                  type="button"
                  onClick={onUseMyLocation}
                  disabled={locating}
                  aria-label="Başlangıç olarak konumumu kullan"
                  className="flex shrink-0 items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-70"
                >
                  {locating ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-200 border-t-blue-700" />
                  ) : (
                    <LocateFixed className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Konumum
                </button>
              }
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

        <div className="mt-3 flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          <button
            type="button"
            onClick={() => onDepartAtChange(null)}
            aria-pressed={departAt === null}
            className={`rounded-full px-3 py-1 font-medium ${
              departAt === null ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700"
            }`}
          >
            Şimdi
          </button>
          <input
            type="datetime-local"
            value={departAt ?? ""}
            onChange={(e) => onDepartAtChange(e.target.value || null)}
            aria-label="Kalkış tarihi ve saati"
            className={`min-w-0 flex-1 rounded-full px-3 py-1 text-base outline-none ${
              departAt ? "bg-blue-50 text-blue-800 ring-1 ring-blue-500" : "bg-slate-100 text-slate-700"
            }`}
          />
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
