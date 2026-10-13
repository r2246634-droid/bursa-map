"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import type { Place } from "@/data/types";
import { ensureSearchDataLoaded, nearViewFirst, usePlaceIndex } from "@/lib/place-search";
import { useAddressSearch } from "@/lib/use-address-search";

import { PlaceIcon, PlaceMeta } from "./PlaceVisuals";

interface PlaceComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onSelect: (place: Place) => void;
  placeholder: string;
  ariaLabel: string;
  /** Kutunun solundaki ikon/işaret */
  leading?: ReactNode;
  /** Kutu boşken sağda gösterilir (ör. "Konumum" butonu); yazınca yerini temizle butonu alır */
  trailingWhenEmpty?: ReactNode;
  /**
   * overlay: liste kutunun altında haritanın üstüne açılır (üst arama çubuğu).
   * inline: liste akışın içinde açılır, kapsayıcıyı uzatır (alttan açılan panel).
   */
  listPlacement?: "overlay" | "inline";
  /** Giriş satırının görünümü (arka plan, yükseklik, köşe) */
  fieldClassName?: string;
  limit?: number;
  /** Önerileri daraltır, ör. yol tarifinde hatlar uç nokta olamaz */
  filter?: (place: Place) => boolean;
}

/**
 * Türkçe duyarlı, harf hatası affeden yer arama kutusu (lib/search.ts). Üst arama çubuğu ve
 * Yol Tarifi panelindeki Nereden/Nereye kutuları bunu kullanır.
 * Önce kendi verimiz (istasyon, durak, hat, öne çıkan nokta), altında "Adres Sonuçları" başlığıyla
 * sokak/mahalle adresleri (Photon, yazma bitince 500 ms sonra — lib/use-address-search.ts).
 * Adres seçilince "feature" türünde bir yer olur: harita oraya gider ve iğne bırakır.
 * ARIA combobox deseni: ok tuşlarıyla iki grupta birlikte gezinme, Enter ile seçme, Escape ile kapatma.
 */
export default function PlaceCombobox({
  value,
  onChange,
  onSelect,
  placeholder,
  ariaLabel,
  leading,
  trailingWhenEmpty,
  listPlacement = "overlay",
  fieldClassName = "",
  limit = 8,
  filter,
}: PlaceComboboxProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const index = usePlaceIndex();
  const suggestions = useMemo(
    () => index.search(value, limit, filter, nearViewFirst),
    [index, value, limit, filter],
  );
  const open = focused && value.trim() !== "";
  // Liste kapalıyken (ör. seçimden sonra kutuda yerin adı yazarken) adres servisine istek atılmaz
  const addressSearch = useAddressSearch(open ? value : "");
  const addresses = useMemo(
    () =>
      addressSearch.status === "done"
        ? filter
          ? addressSearch.places.filter(filter)
          : addressSearch.places
        : [],
    [addressSearch, filter],
  );
  /** Klavyeyle gezinilen tüm seçenekler: önce yerel sonuçlar, sonra adresler */
  const options = useMemo(() => [...suggestions, ...addresses], [suggestions, addresses]);
  const noResults =
    suggestions.length === 0 &&
    (addressSearch.status === "idle" || (addressSearch.status === "done" && addresses.length === 0));

  const select = (place: Place) => {
    onSelect(place);
    setFocused(false);
    inputRef.current?.blur(); // mobilde klavyeyi kapat, haritanın odaklandığı yer görünsün
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Liste boşken -1'e düşmesin
      setActiveIndex((i) => Math.max(0, Math.min(i + 1, options.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && options[activeIndex]) {
      e.preventDefault();
      select(options[activeIndex]);
    } else if (e.key === "Escape") {
      setFocused(false);
    }
  };

  const renderOption = (place: Place, i: number) => (
    <li
      key={place.id}
      id={`${listId}-${i}`}
      role="option"
      aria-selected={i === activeIndex}
      // mousedown'da varsayılanı engelle: aksi halde input blur olur, liste tıklamadan önce kapanır
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => select(place)}
      onMouseEnter={() => setActiveIndex(i)}
      className={`flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2 ${
        i === activeIndex ? "bg-slate-900/5" : ""
      }`}
    >
      <PlaceIcon place={place} className="h-8 w-8" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-slate-900">{place.name}</span>
        <PlaceMeta place={place} />
      </span>
    </li>
  );

  const listClassName =
    listPlacement === "overlay"
      ? "glass absolute inset-x-0 top-14 z-10 max-h-[60dvh] overflow-y-auto rounded-2xl p-1.5"
      : "mt-1.5 max-h-56 overflow-y-auto rounded-2xl bg-white p-1.5 ring-1 ring-slate-900/10";

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 ${fieldClassName}`}>
        {leading}
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setActiveIndex(0);
            setFocused(true);
          }}
          onFocus={() => {
            setFocused(true);
            ensureSearchDataLoaded(); // otobüs hat/durakları ve çevredeki yerler ilk aramada yüklensin
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          // 16px altı font iOS'ta otomatik zoom tetikler
          className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none placeholder:text-slate-500 [&::-webkit-search-cancel-button]:hidden"
        />
        {!value && trailingWhenEmpty}
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label={`${ariaLabel}: temizle`}
            className="rounded-full p-1 text-slate-500 hover:bg-slate-900/5"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <ul id={listId} role="listbox" aria-label={`${ariaLabel}: öneriler`} className={listClassName}>
          {noResults ? (
            <li className="px-3 py-3 text-sm text-slate-500">Sonuç bulunamadı</li>
          ) : (
            <>
              {suggestions.map((place, i) => renderOption(place, i))}
              {addressSearch.status !== "idle" && (
                <>
                  <li
                    role="presentation"
                    className="px-2 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-slate-500 uppercase"
                  >
                    Adres Sonuçları
                  </li>
                  {addressSearch.status === "loading" ? (
                    <li role="presentation" className="px-2 py-2 text-sm text-slate-500">
                      Adresler aranıyor…
                    </li>
                  ) : addressSearch.status === "error" ? (
                    <li role="presentation" className="px-2 py-2 text-sm text-slate-500">
                      Adres servisine ulaşılamadı
                    </li>
                  ) : addresses.length === 0 ? (
                    <li role="presentation" className="px-2 py-2 text-sm text-slate-500">
                      Adres bulunamadı
                    </li>
                  ) : (
                    addresses.map((place, i) => renderOption(place, suggestions.length + i))
                  )}
                </>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
