"use client";

import { Footprints, Info } from "lucide-react";

import { formatDuration, rideColor, rideLabel, type JourneysState } from "@/lib/routing/client";
import { formatClock } from "@/lib/routing/time";
import type { Journey, JourneyLeg } from "@/lib/routing/types";

interface JourneyListProps {
  state: JourneysState;
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/** Yol tarifi seçenekleri ve seçili seçeneğin adım adım anlatımı */
export default function JourneyList({ state, selectedIndex, onSelect }: JourneyListProps) {
  if (state.status === "idle") return null;
  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-2 px-1 py-3 text-sm text-slate-500" aria-live="polite">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        Rota hesaplanıyor…
      </p>
    );
  }
  if (state.status === "error") {
    return <p className="px-1 py-3 text-sm text-rose-700" role="alert">{state.message}</p>;
  }

  const { journeys, notes } = state.data;
  if (journeys.length === 0) {
    return <p className="px-1 py-3 text-sm text-slate-500">{notes.at(-1)}</p>;
  }
  const selected = journeys[Math.min(selectedIndex, journeys.length - 1)];

  return (
    <div className="space-y-2" aria-live="polite">
      <ul className="space-y-2" aria-label="Rota seçenekleri">
        {journeys.map((journey, i) => (
          <li key={i}>
            <JourneyOption journey={journey} selected={journey === selected} onSelect={() => onSelect(i)} />
          </li>
        ))}
      </ul>

      <ol className="space-y-2 rounded-2xl bg-slate-50 p-3" aria-label="Adım adım yol tarifi">
        {selected.legs.map((leg, i) => (
          <LegStep key={i} leg={leg} />
        ))}
      </ol>

      {notes.map((note) => (
        <p key={note} className="flex items-start gap-1.5 px-1 text-xs text-slate-500">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
          {note}
        </p>
      ))}
    </div>
  );
}

function JourneyOption({ journey, selected, onSelect }: { journey: Journey; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-2xl border p-3 text-left transition-colors ${
        selected ? "border-blue-500 bg-blue-50/60" : "border-slate-200 bg-white hover:bg-slate-50"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900 tabular-nums">
          {formatClock(journey.departure)} → {formatClock(journey.arrival)}
        </span>
        <span className="text-sm font-semibold text-slate-900">{formatDuration(journey.durationMin)}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {journey.legs.map((leg, i) => (
          <LegChip key={i} leg={leg} />
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
        {journey.tags.map((tag) => (
          <span key={tag} className="rounded-md bg-emerald-100 px-1.5 font-medium text-emerald-800">
            {tag}
          </span>
        ))}
        <span>{journey.transfers === 0 ? "Aktarmasız" : `${journey.transfers} aktarma`}</span>
        <span>· {journey.walkMeters} m yürüme</span>
      </div>
    </button>
  );
}

function LegChip({ leg }: { leg: JourneyLeg }) {
  if (leg.type === "walk") {
    return (
      <span className="flex items-center gap-0.5 text-xs text-slate-500">
        <Footprints className="h-3.5 w-3.5" aria-hidden />
        {Math.max(1, Math.round((leg.arrival - leg.departure) / 60))}
        <span className="sr-only"> dakika yürüme</span>
      </span>
    );
  }
  return (
    <span
      className="rounded-md px-1.5 text-xs leading-5 font-semibold text-white"
      style={{ backgroundColor: rideColor(leg) }}
    >
      {rideLabel(leg)}
    </span>
  );
}

function LegStep({ leg }: { leg: JourneyLeg }) {
  const minutes = Math.max(1, Math.round((leg.arrival - leg.departure) / 60));
  if (leg.type === "walk") {
    return (
      <li className="flex gap-2 text-sm text-slate-700">
        <span className="w-11 shrink-0 text-xs text-slate-500 tabular-nums">{formatClock(leg.departure)}</span>
        <span>
          <Footprints className="mr-1 inline h-4 w-4 align-[-3px] text-slate-500" aria-hidden />
          {minutes} dk yürü ({leg.meters} m) → <span className="font-medium">{leg.to.name}</span>
        </span>
      </li>
    );
  }
  return (
    <li className="flex gap-2 text-sm text-slate-700">
      <span className="w-11 shrink-0 text-xs text-slate-500 tabular-nums">~{formatClock(leg.departure)}</span>
      <span>
        <span
          className="mr-1 rounded-md px-1.5 text-xs leading-5 font-semibold text-white"
          style={{ backgroundColor: rideColor(leg) }}
        >
          {rideLabel(leg)}
        </span>
        <span className="font-medium">{leg.from.name}</span> durağından{" "}
        <span className="text-slate-500">({leg.headsign} yönü)</span> bin, {leg.stopCount} durak sonra{" "}
        <span className="font-medium">{leg.to.name}</span> durağında in · ~{formatClock(leg.arrival)}
      </span>
    </li>
  );
}
