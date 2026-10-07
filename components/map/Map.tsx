"use client";

import dynamic from "next/dynamic";

import type { MapViewProps } from "./MapView";

/**
 * Leaflet `window` nesnesine ihtiyaç duyduğundan sunucuda çalışamaz.
 * `ssr: false` ile MapView sadece tarayıcıda yüklenir.
 * (App Router'da `ssr: false` yalnızca Client Component içinde kullanılabilir.)
 */
const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

function MapSkeleton() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-100">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-300 border-t-blue-600" />
    </div>
  );
}

export default function BursaMap(props: MapViewProps) {
  return <MapView {...props} />;
}
