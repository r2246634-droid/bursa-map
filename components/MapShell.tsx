"use client";

import { useCallback, useMemo, useState } from "react";

import BursaMap from "@/components/map/Map";
import type { RouteEndpoints } from "@/components/map/RouteOverlay";
import BottomNav, { type TabId } from "@/components/ui/BottomNav";
import LayerControl, { LayerToggleButton } from "@/components/ui/LayerControl";
import ResultCards from "@/components/ui/ResultCards";
import RoutePanel from "@/components/ui/RoutePanel";
import SearchBar from "@/components/ui/SearchBar";
import { DEFAULT_VISIBLE_LAYERS } from "@/data/layers";
import { PLACES } from "@/data/places";
import { POIS } from "@/data/pois";
import type { LayerId, Place } from "@/data/types";
import { droppedPin } from "@/lib/map-features";
import { searchByName } from "@/lib/search";

const CARD_LIMIT = 20;
const EMPTY_ROUTE: RouteEndpoints = { from: null, to: null };

/** Uygulama durumunu (sekme, katmanlar, arama, seçim, rota) tutan ve UI parçalarını birleştiren kabuk. */
export default function MapShell() {
  const [activeTab, setActiveTab] = useState<TabId>("map");
  const [visibleLayers, setVisibleLayers] = useState(() => new Set(DEFAULT_VISIBLE_LAYERS));
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [route, setRoute] = useState<RouteEndpoints>(EMPTY_ROUTE);
  const [routePanelHeight, setRoutePanelHeight] = useState(0);

  const routeMode = activeTab === "route";

  /** Seçilen yer gizli bir katmandaysa (ör. otobüs kapalıyken bir durak), katmanı aç */
  const revealLayerOf = (place: Place) => {
    if (place.kind === "feature") return;
    const { layer } = place;
    setVisibleLayers((prev) => (prev.has(layer) ? prev : new Set(prev).add(layer)));
  };

  const toggleLayer = (id: LayerId) =>
    setVisibleLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /**
   * Alt kartlar: sorgu varsa tüm yerlerde (istasyonlar dahil) arama sonuçları;
   * sorgu yoksa sadece açık katmanlardaki ilgi noktaları (90+ durağı listelemiyoruz).
   */
  const cardPlaces = useMemo(
    () =>
      query.trim()
        ? searchByName(PLACES, query, CARD_LIMIT)
        : PLACES.filter((p) => p.kind === "poi" && visibleLayers.has(p.layer)),
    [query, visibleLayers],
  );

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedPlace(null); // yeni arama başlayınca bilgi kartı yerine sonuçlar görünsün
  };

  const handleSelect = (place: Place) => {
    setSelectedPlace(place);
    setQuery(place.name);
    revealLayerOf(place);
  };

  /** Haritada bir yere dokunuldu: rota modunda boş uca yazılır, değilse bilgi kartı açılır */
  const handleMapPlaceClick = (place: Place) => {
    if (routeMode) {
      setRoute((prev) => (prev.from ? { ...prev, to: place } : { ...prev, from: place }));
      revealLayerOf(place);
      return;
    }
    handleSelect(place);
  };

  /** Boş bir yere dokunuldu: açık kart varsa kapanır (Google Haritalar gibi), yoksa iğne bırakılır */
  const handleEmptyMapClick = (position: [number, number]) => {
    if (routeMode) return;
    if (selectedPlace) setSelectedPlace(null);
    else setSelectedPlace(droppedPin(position));
  };

  const handleDirections = (place: Place, end: "from" | "to") => {
    setRoute((prev) => ({ ...prev, [end]: place }));
    setSelectedPlace(null);
    setActiveTab("route");
  };

  const handleTabChange = (tab: TabId) => {
    // Rota sekmesine tekrar basmak paneli kapatır
    setActiveTab((current) => (current === tab && tab === "route" ? "map" : tab));
    setLayerPanelOpen(false);
    if (tab === "route") setSelectedPlace(null); // seçili yerin bilgi kartı panelin arkasında kalmasın
  };

  const handleRouteChange = (next: RouteEndpoints) => {
    setRoute(next);
    if (next.from) revealLayerOf(next.from);
    if (next.to) revealLayerOf(next.to);
  };

  // RoutePanel'in ResizeObserver efektine bağımlılık olarak gidiyor; kimliği sabit kalmalı
  const closeRoutePanel = useCallback(() => setActiveTab("map"), []);

  return (
    <div className="flex h-dvh flex-col">
      <main className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <BursaMap
            pois={POIS}
            visibleLayers={visibleLayers}
            selectedPlace={selectedPlace}
            route={routeMode ? route : null}
            bottomInset={routeMode ? routePanelHeight : 0}
            onPlaceClick={handleMapPlaceClick}
            onEmptyClick={handleEmptyMapClick}
          />
        </div>

        {/* Üst overlay: arama + katman butonu. Dış kapsayıcı tıklamaları haritaya geçirir.
            Rota modunda arama Nereden/Nereye kutularına devredildiği için gizlenir. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1001] pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex max-w-2xl justify-end gap-2 p-4">
            {!routeMode && (
              <div className="pointer-events-auto flex-1">
                <SearchBar value={query} onChange={handleQueryChange} onSelect={handleSelect} />
              </div>
            )}
            <div className="pointer-events-auto">
              <LayerToggleButton onClick={() => setLayerPanelOpen(true)} />
            </div>
          </div>
        </div>

        {/* Alt overlay: sonuç kartları veya seçilen yerin bilgi kartı */}
        {!routeMode && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000]">
            <div className="pointer-events-auto mx-auto max-w-5xl">
              <ResultCards
                places={cardPlaces}
                selected={selectedPlace}
                onSelect={handleSelect}
                onClearSelection={() => setSelectedPlace(null)}
                onDirections={handleDirections}
              />
            </div>
          </div>
        )}

        <RoutePanel
          open={routeMode}
          from={route.from}
          to={route.to}
          onChange={handleRouteChange}
          onClose={closeRoutePanel}
          onHeightChange={setRoutePanelHeight}
        />

        <LayerControl
          open={layerPanelOpen}
          onOpenChange={setLayerPanelOpen}
          visibleLayers={visibleLayers}
          onToggle={toggleLayer}
        />
      </main>

      <BottomNav active={activeTab} onChange={handleTabChange} />
    </div>
  );
}
