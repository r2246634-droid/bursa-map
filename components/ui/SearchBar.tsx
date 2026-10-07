"use client";

import { Search } from "lucide-react";

import type { Place } from "@/data/types";

import PlaceCombobox from "./PlaceCombobox";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (place: Place) => void;
}

/**
 * Üst arama çubuğu. Öneri listesi kutunun hemen altında açılır: mobilde klavye açıkken
 * alttaki sonuç kartları klavyenin arkasında kaldığı için öneriler üstte gösterilir.
 */
export default function SearchBar({ value, onChange, onSelect }: SearchBarProps) {
  return (
    <form role="search" onSubmit={(e) => e.preventDefault()} className="flex-1">
      <PlaceCombobox
        value={value}
        onChange={onChange}
        onSelect={onSelect}
        placeholder="Durak, hat veya yer ara…"
        ariaLabel="Haritada ara"
        leading={<Search className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />}
        fieldClassName="glass h-12 rounded-2xl px-4"
      />
    </form>
  );
}
