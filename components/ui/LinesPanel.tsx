"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";

import type { Place } from "@/data/types";
import { BUS_LINE_COLOR, DIRECTION_LABEL, DIRECTION_ORDER, lineRouteSummary, loadBusData } from "@/lib/burulas";
import { createSearchIndex } from "@/lib/search";

import FavoriteButton from "./FavoriteButton";
import SheetPanel from "./SheetPanel";

type LinePlace = Extract<Place, { kind: "line" }>;

interface LinesPanelProps {
  open: boolean;
  onClose: () => void;
  onSelectLine: (place: Place) => void;
}

const collator = new Intl.Collator("tr", { numeric: true });

/**
 * Tüm otobüs hatlarının listesi. Üstteki filtre, aramayla aynı Türkçe duyarlı indeksi kullanır:
 * hat numarası ("22c") veya güzergâhtaki durak adı ("terminal", "üniversite") ile bulunur.
 */
export default function LinesPanel({ open, onClose, onSelectLine }: LinesPanelProps) {
  const [lines, setLines] = useState<LinePlace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");

  // Veri ilk açılışta yüklenir (arama için zaten yüklenmişse önbellekten anında gelir)
  useEffect(() => {
    if (!open || lines) return;
    let cancelled = false;
    loadBusData()
      .then(({ linePlaces }) => {
        if (cancelled) return;
        setFailed(false);
        setLines(
          [...(linePlaces as LinePlace[])].sort((a, b) => collator.compare(a.line.code, b.line.code)),
        );
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, lines]);

  const index = useMemo(() => (lines ? createSearchIndex(lines) : null), [lines]);
  const visible = useMemo(() => {
    if (!lines || !index) return [];
    return filter.trim() ? index.search(filter, lines.length) : lines;
  }, [lines, index, filter]);

  const toolbar = (
    <div className="mb-2">
      <label className="flex h-11 items-center gap-2 rounded-2xl bg-slate-100 px-3">
        <Search className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Hat no veya durak adı (ör. 22C, terminal)"
          aria-label="Hatları filtrele"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
        />
        {filter && (
          <button
            type="button"
            onClick={() => setFilter("")}
            aria-label="Filtreyi temizle"
            className="rounded-full p-1 text-slate-500 hover:bg-slate-900/5"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </label>
      {lines && (
        <p className="mt-2 px-1 text-xs text-slate-500" aria-live="polite">
          {filter.trim() ? `${visible.length} sonuç` : `${lines.length} otobüs hattı`}
        </p>
      )}
    </div>
  );

  return (
    <SheetPanel open={open} title="Hatlar" onClose={onClose} toolbar={toolbar}>
      {failed && <p className="px-3 py-6 text-center text-sm text-slate-500">Hat listesi yüklenemedi.</p>}
      {!lines && !failed && <LineListSkeleton />}
      {lines && visible.length === 0 && (
        <p className="px-3 py-6 text-center text-sm text-slate-500">“{filter}” ile eşleşen hat yok.</p>
      )}
      <ul className="divide-y divide-slate-900/5">
        {visible.map((place) => (
          <li key={place.id} className="[content-visibility:auto] [contain-intrinsic-size:auto_64px]">
            <LineRow place={place} onSelect={() => onSelectLine(place)} />
          </li>
        ))}
      </ul>
    </SheetPanel>
  );
}

export function LineRow({ place, onSelect }: { place: LinePlace; onSelect: () => void }) {
  const { line } = place;
  const directions = DIRECTION_ORDER.filter((d) => line.stopCount[d]);
  return (
    <div className="flex items-center gap-1 pr-1">
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-900/5"
      >
        <span
          className="flex h-9 min-w-12 shrink-0 items-center justify-center rounded-lg px-1.5 text-sm font-bold text-white"
          style={{ backgroundColor: BUS_LINE_COLOR }}
        >
          {line.code}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm text-slate-800">{lineRouteSummary(line)}</span>
          <span className="text-xs text-slate-500">
            {directions.map((d) => `${DIRECTION_LABEL[d]} ${line.stopCount[d]} durak`).join(" · ")}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>
      <FavoriteButton place={place} />
    </div>
  );
}

function LineListSkeleton() {
  return (
    <ul aria-label="Hatlar yükleniyor" className="space-y-2 px-2 pt-1">
      {Array.from({ length: 8 }, (_, i) => (
        <li key={i} className="flex animate-pulse items-center gap-3 py-2">
          <span className="h-9 w-12 rounded-lg bg-slate-200" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-4/5 rounded bg-slate-200" />
            <span className="block h-2.5 w-2/5 rounded bg-slate-100" />
          </span>
        </li>
      ))}
    </ul>
  );
}
