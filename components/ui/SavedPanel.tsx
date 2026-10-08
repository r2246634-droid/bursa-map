"use client";

import { useEffect, useState } from "react";
import { Heart, Trash2 } from "lucide-react";

import type { Place } from "@/data/types";
import { useFavorites, type FavoriteEntry } from "@/lib/favorites";
import { ensureBusPlacesLoaded, findPlaceById, usePlaceIndex } from "@/lib/place-search";

import FavoriteButton from "./FavoriteButton";
import { LineRow } from "./LinesPanel";
import { PlaceIcon, PlaceMeta } from "./PlaceVisuals";
import SheetPanel from "./SheetPanel";

interface SavedPanelProps {
  open: boolean;
  onClose: () => void;
  onSelect: (place: Place) => void;
}

/** Otobüs hat/durak kimlikleri BURULAŞ verisi yüklenince çözülebilir */
const needsBusData = (id: string) => id.startsWith("bus-");

type Resolved =
  | { entry: FavoriteEntry; status: "ok"; place: Place }
  | { entry: FavoriteEntry; status: "loading" | "missing" };

/**
 * Kayıtlı yerler ve hatlar. localStorage'daki kimlikler güncel veriyle eşleştirilir; veri
 * setinden kalkmış bir kayıt (ör. kaldırılan hat) sessizce kaybolmaz, silinebilir olarak gösterilir.
 */
export default function SavedPanel({ open, onClose, onSelect }: SavedPanelProps) {
  const entries = useFavorites((s) => s.entries);
  const remove = useFavorites((s) => s.remove);
  // Otobüs verisi yüklendiğinde (indeks değişince) yeniden eşleştirmek için abone ol
  usePlaceIndex();
  const [busLoad, setBusLoad] = useState<"idle" | "done">("idle");

  const hasBusEntries = entries.some((e) => needsBusData(e.id));
  useEffect(() => {
    if (!open || !hasBusEntries) return;
    let cancelled = false;
    void ensureBusPlacesLoaded().finally(() => !cancelled && setBusLoad("done"));
    return () => {
      cancelled = true;
    };
  }, [open, hasBusEntries]);

  const resolved: Resolved[] = entries.map((entry) => {
    const place = entry.snapshot ?? findPlaceById(entry.id);
    if (place) return { entry, status: "ok", place };
    return { entry, status: needsBusData(entry.id) && busLoad !== "done" ? "loading" : "missing" };
  });

  const lines = resolved.filter((r) => r.status === "ok" && r.place.kind === "line");
  const places = resolved.filter((r) => !(r.status === "ok" && r.place.kind === "line"));

  return (
    <SheetPanel open={open} title="Kayıtlı" onClose={onClose}>
      {entries.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <Heart className="mb-3 h-8 w-8 text-slate-300" aria-hidden />
          <p className="text-sm font-medium text-slate-700">Henüz kayıtlı bir şey yok</p>
          <p className="mt-1 text-sm text-slate-500">
            Bir durağın, yerin veya hattın bilgi kartındaki kalbe dokunarak buraya ekleyebilirsiniz.
          </p>
        </div>
      ) : (
        <>
          {lines.length > 0 && (
            <Section title="Hatlar">
              {lines.map((r) =>
                r.status === "ok" && r.place.kind === "line" ? (
                  <li key={r.entry.id}>
                    <LineRow place={r.place} onSelect={() => onSelect(r.place)} />
                  </li>
                ) : null,
              )}
            </Section>
          )}
          {places.length > 0 && (
            <Section title="Duraklar ve yerler">
              {places.map((r) => (
                <li key={r.entry.id}>
                  {r.status === "ok" ? (
                    <div className="flex items-center gap-1 pr-1">
                      <button
                        type="button"
                        onClick={() => onSelect(r.place)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-slate-900/5"
                      >
                        <PlaceIcon place={r.place} className="h-9 w-9" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-slate-900">
                            {r.place.name}
                          </span>
                          <PlaceMeta place={r.place} />
                        </span>
                      </button>
                      <FavoriteButton place={r.place} />
                    </div>
                  ) : (
                    <UnresolvedRow
                      id={r.entry.id}
                      loading={r.status === "loading"}
                      onRemove={() => remove(r.entry.id)}
                    />
                  )}
                </li>
              ))}
            </Section>
          )}
        </>
      )}
    </SheetPanel>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="px-3 pt-1 pb-1 text-xs font-medium tracking-wide text-slate-500 uppercase">{title}</h3>
      <ul className="divide-y divide-slate-900/5">{children}</ul>
    </section>
  );
}

function UnresolvedRow({ id, loading, onRemove }: { id: string; loading: boolean; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 px-2 py-2.5">
      <span className="h-9 w-9 shrink-0 animate-pulse rounded-xl bg-slate-200" aria-hidden />
      <span className="min-w-0 flex-1 text-sm text-slate-500">
        {loading ? "Yükleniyor…" : "Bu kayıt artık veride bulunamıyor"}
        <span className="block truncate text-xs text-slate-400">{id}</span>
      </span>
      {!loading && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Kaydı sil"
          className="rounded-full p-1.5 text-slate-500 hover:bg-slate-900/5"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
