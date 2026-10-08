import { BusFront, MapPin, TrainFront, TramFront, type LucideIcon } from "lucide-react";

import { LAYER_BY_ID } from "@/data/layers";
import { LINE_COLORS, STATION_LABEL } from "@/data/transit-network";
import type { LineRef, Place, TransitMode } from "@/data/types";
import { BUS_LINE_COLOR, lineRouteSummary } from "@/lib/burulas";

const MODE_ICON: Record<TransitMode, LucideIcon> = {
  metro: TrainFront,
  tram: TramFront,
  bus: BusFront,
};

/** Arama önerileri ve sonuç kartlarında ortak kullanılan küçük görsel parçalar. */

/**
 * Hat rozeti. Raylı hatlar kendi renginde; otobüs hatları tek tip mor çerçeveli.
 * (BURULAŞ'ta "B1"/"B2" otobüs hattıdır — metro B1/B2 rengini almaması için tür ayrımı şart.)
 */
export function LineBadge({ line, bus = false }: { line: LineRef; bus?: boolean }) {
  if (bus) {
    return (
      <span
        className="rounded-md border px-1.5 text-[11px] leading-4 font-semibold"
        style={{ borderColor: BUS_LINE_COLOR, color: BUS_LINE_COLOR }}
      >
        {line}
      </span>
    );
  }
  return (
    <span
      className="rounded-md px-1.5 py-px text-[11px] leading-4 font-semibold text-white"
      style={{ backgroundColor: LINE_COLORS[line] }}
    >
      {line}
    </span>
  );
}

/** Kart ve öneri satırlarında gösterilecek en fazla hat rozeti; fazlası "+N" */
const MAX_INLINE_BADGES = 6;

export function TransferTag() {
  return (
    <span className="rounded-md bg-violet-100 px-1.5 py-px text-[11px] leading-4 font-semibold text-violet-700">
      Aktarma
    </span>
  );
}

export function PlaceIcon({ place, className = "h-10 w-10" }: { place: Place; className?: string }) {
  const Icon =
    place.kind === "station" ? MODE_ICON[place.mode] : place.kind === "line" ? BusFront : MapPin;
  const color =
    place.kind === "line" || (place.kind === "station" && place.mode === "bus")
      ? BUS_LINE_COLOR
      : place.kind === "station"
        ? LINE_COLORS[place.lines[0]]
        : place.kind === "poi"
          ? LAYER_BY_ID[place.layer].color
          : "#475569"; // altlıktan seçilen yer / bırakılan iğne

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl text-white ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden
    >
      <Icon className="h-1/2 w-1/2" />
    </span>
  );
}

export function placeSubtitle(place: Place) {
  if (place.kind === "poi") return LAYER_BY_ID[place.layer].label;
  if (place.kind === "station") return STATION_LABEL[place.mode];
  if (place.kind === "line") return "Otobüs hattı";
  return place.category;
}

/** "Metro istasyonu  B1 B2  Aktarma" satırı */
export function PlaceMeta({ place }: { place: Place }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
      <span className="mr-0.5">{placeSubtitle(place)}</span>
      {place.kind === "station" && (
        <>
          {place.lines.slice(0, MAX_INLINE_BADGES).map((line) => (
            <LineBadge key={line} line={line} bus={place.mode === "bus"} />
          ))}
          {place.lines.length > MAX_INLINE_BADGES && (
            <span className="text-[11px] font-medium">+{place.lines.length - MAX_INLINE_BADGES}</span>
          )}
          {place.transfer && <TransferTag />}
        </>
      )}
      {place.kind === "line" && <span className="truncate">· {lineRouteSummary(place.line)}</span>}
    </span>
  );
}
