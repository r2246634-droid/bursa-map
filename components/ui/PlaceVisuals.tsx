import { BusFront, MapPin, TrainFront, TramFront, type LucideIcon } from "lucide-react";

import { LAYER_BY_ID } from "@/data/layers";
import { LINE_COLORS, STATION_LABEL } from "@/data/transit-network";
import type { LineRef, Place, TransitMode } from "@/data/types";

const MODE_ICON: Record<TransitMode, LucideIcon> = {
  metro: TrainFront,
  tram: TramFront,
  bus: BusFront,
};

/** Arama önerileri ve sonuç kartlarında ortak kullanılan küçük görsel parçalar. */

export function LineBadge({ line }: { line: LineRef }) {
  return (
    <span
      className="rounded-md px-1.5 py-px text-[11px] leading-4 font-semibold text-white"
      style={{ backgroundColor: LINE_COLORS[line] }}
    >
      {line}
    </span>
  );
}

export function TransferTag() {
  return (
    <span className="rounded-md bg-violet-100 px-1.5 py-px text-[11px] leading-4 font-semibold text-violet-700">
      Aktarma
    </span>
  );
}

export function PlaceIcon({ place, className = "h-10 w-10" }: { place: Place; className?: string }) {
  const Icon = place.kind === "station" ? MODE_ICON[place.mode] : MapPin;
  const color =
    place.kind === "station"
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
  return place.category;
}

/** "Metro istasyonu  B1 B2  Aktarma" satırı */
export function PlaceMeta({ place }: { place: Place }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
      <span className="mr-0.5">{placeSubtitle(place)}</span>
      {place.kind === "station" && (
        <>
          {place.lines.map((line) => (
            <LineBadge key={line} line={line} />
          ))}
          {place.transfer && <TransferTag />}
        </>
      )}
    </span>
  );
}
