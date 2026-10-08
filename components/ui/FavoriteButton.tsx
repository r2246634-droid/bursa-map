"use client";

import { Heart } from "lucide-react";

import type { Place } from "@/data/types";
import { useFavorites, useIsFavorite } from "@/lib/favorites";

/** Kalp: yeri/hattı kayıtlılara ekler veya çıkarır */
export default function FavoriteButton({ place, className = "" }: { place: Place; className?: string }) {
  const saved = useIsFavorite(place.id);
  const toggle = useFavorites((s) => s.toggle);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation(); // liste satırının içindeyken satırı seçmesin
        toggle(place);
      }}
      aria-pressed={saved}
      aria-label={saved ? `${place.name}: kayıtlılardan çıkar` : `${place.name}: kaydet`}
      title={saved ? "Kayıtlılardan çıkar" : "Kaydet"}
      className={`rounded-full p-1.5 transition-colors hover:bg-slate-900/5 active:scale-90 ${className}`}
    >
      <Heart
        className={`h-5 w-5 ${saved ? "fill-rose-500 text-rose-500" : "text-slate-500"}`}
        aria-hidden
      />
    </button>
  );
}
