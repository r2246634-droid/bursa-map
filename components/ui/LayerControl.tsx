"use client";

import { Layers, X } from "lucide-react";

import { LAYERS } from "@/data/layers";
import type { LayerDefinition, LayerId } from "@/data/types";

const MAIN_LAYERS = LAYERS.filter((l) => !l.nearby);
const NEARBY_LAYERS = LAYERS.filter((l) => l.nearby);

interface LayerControlProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  visibleLayers: Set<LayerId>;
  onToggle: (id: LayerId) => void;
}

export function LayerToggleButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Katmanları göster"
      className="glass flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-slate-700 active:scale-95"
    >
      <Layers className="h-5 w-5" />
    </button>
  );
}

/** Mobilde alttan açılan sheet, masaüstünde sağ üstte panel. */
export default function LayerControl({ open, onOpenChange, visibleLayers, onToggle }: LayerControlProps) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-[1100]">
      <button
        type="button"
        aria-label="Paneli kapat"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-slate-900/20 md:bg-transparent"
      />

      <section
        role="dialog"
        aria-label="Harita katmanları"
        className="glass absolute inset-x-0 bottom-0 rounded-t-3xl p-5 pb-6 md:inset-x-auto md:top-20 md:right-4 md:bottom-auto md:w-80 md:rounded-3xl"
      >
        <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-300 md:hidden" />
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Katmanlar</h2>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Kapat"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-900/5"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="max-h-[60dvh] overflow-y-auto md:max-h-[70dvh]">
          <LayerList layers={MAIN_LAYERS} visibleLayers={visibleLayers} onToggle={onToggle} />
          <h3 className="mt-4 px-2 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
            Çevredeki yerler
          </h3>
          <p className="mb-1 px-2 text-xs text-slate-500">
            Haritanın ortasındaki ~1 km çevrede, yakınlaştırınca tüm ekranda görünür.
          </p>
          <LayerList layers={NEARBY_LAYERS} visibleLayers={visibleLayers} onToggle={onToggle} />
        </div>
      </section>
    </div>
  );
}

function LayerList({
  layers,
  visibleLayers,
  onToggle,
}: {
  layers: LayerDefinition[];
  visibleLayers: Set<LayerId>;
  onToggle: (id: LayerId) => void;
}) {
  return (
    <ul className="space-y-1">
      {layers.map((layer) => (
        <li key={layer.id}>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-slate-900/5">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: layer.color }} aria-hidden />
            <span className="flex-1 text-sm text-slate-800">{layer.label}</span>
            <input
              type="checkbox"
              checked={visibleLayers.has(layer.id)}
              onChange={() => onToggle(layer.id)}
              className="peer sr-only"
            />
            {/* Checkbox'ın switch görünümü */}
            <span className="relative h-6 w-10 rounded-full bg-slate-300 transition-colors peer-checked:bg-blue-600 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
          </label>
        </li>
      ))}
    </ul>
  );
}
