"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import BursaMap from "@/components/map/Map";
import type { PanelInset, RouteEndpoints } from "@/components/map/RouteOverlay";
import BottomNav, { type TabId } from "@/components/ui/BottomNav";
import LayerControl, { LayerToggleButton } from "@/components/ui/LayerControl";
import LinesPanel from "@/components/ui/LinesPanel";
import ResultCards from "@/components/ui/ResultCards";
import RoutePanel from "@/components/ui/RoutePanel";
import SavedPanel from "@/components/ui/SavedPanel";
import SearchBar from "@/components/ui/SearchBar";
import { DEFAULT_VISIBLE_LAYERS } from "@/data/layers";
import { PLACES } from "@/data/places";
import { POIS } from "@/data/pois";
import type { LayerId, Place } from "@/data/types";
import { busLinePlaceId } from "@/lib/burulas";
import { useHydrateFavorites } from "@/lib/favorites";
import { getCurrentPlace, locationErrorMessage, locationPermissionGranted } from "@/lib/geolocation";
import { journeysUrl, useJourneys } from "@/lib/routing/client";
import { droppedPin } from "@/lib/map-features";
import { ensureBusPlacesLoaded, findPlaceById, nearViewFirst, usePlaceIndex } from "@/lib/place-search";

const CARD_LIMIT = 20;
const NOTICE_MS = 4000;
const EMPTY_ROUTE: RouteEndpoints = { from: null, to: null };
const NO_INSET: PanelInset = { bottom: 0, left: 0 };

/** Uygulama durumunu (sekme, katmanlar, arama, seçim, rota) tutan ve UI parçalarını birleştiren kabuk. */
export default function MapShell() {
  const [activeTab, setActiveTab] = useState<TabId>("map");
  const [visibleLayers, setVisibleLayers] = useState(() => new Set(DEFAULT_VISIBLE_LAYERS));
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [route, setRoute] = useState<RouteEndpoints>(EMPTY_ROUTE);
  const [routePanelInset, setRoutePanelInset] = useState<PanelInset>(NO_INSET);
  // Panel her ölçümde yeni nesne bildirir; değer aynıysa durumu (ve haritayı) değiştirme
  const handleRouteInsetChange = useCallback(
    (next: PanelInset) =>
      setRoutePanelInset((prev) => (prev.bottom === next.bottom && prev.left === next.left ? prev : next)),
    [],
  );
  /** Yol tarifi kalkış saati (datetime-local değeri); null = şimdi */
  const [departAt, setDepartAt] = useState<string | null>(null);
  const journeys = useJourneys(route.from, route.to, departAt);
  // Seçili seçenek, hangi aramaya ait olduğuyla saklanır: uç noktalar değişince ilk seçeneğe döner
  const [journeyChoice, setJourneyChoice] = useState<{ url: string | null; index: number }>({ url: null, index: 0 });
  const currentUrl = journeysUrl(route.from, route.to, departAt);
  const selectedJourneyIndex = journeyChoice.url === currentUrl ? journeyChoice.index : 0;
  const selectedJourney =
    journeys.status === "done" ? (journeys.data.journeys[selectedJourneyIndex] ?? null) : null;
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const placeIndex = usePlaceIndex();
  useHydrateFavorites();

  // BURULAŞ hat ve durakları (~1 MB) ilk ekran çizildikten sonra, tarayıcı boşta kalınca yüklensin:
  // haritada durağa dokunma ve arama için hazır olur, açılış hızını etkilemez
  useEffect(() => {
    const load = () => void ensureBusPlacesLoaded();
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(load, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(load, 1500);
    return () => clearTimeout(id);
  }, []);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const routeMode = activeTab === "route";
  /** Yol tarifi panelinde iki uç da seçili: harita rotaya odaklanır */
  const routeActive = routeMode && route.from !== null && route.to !== null;
  const [routeCollapsed, setRouteCollapsed] = useState(false);
  const [routeRefitToken, setRouteRefitToken] = useState(0);

  /**
   * Rota gösterilirken haritada sadece rotanın kendi bacakları kalsın: metro, tramvay ve
   * otobüs durağı katmanları gizlenir (rota metro kullanıyorsa o bacak yine hat renginde çizilir).
   * Kullanıcının katman ayarı değişmez; panel kapanınca katmanlar eski haline döner.
   */
  const mapLayers = useMemo(() => {
    if (!routeActive) return visibleLayers;
    const next = new Set(visibleLayers);
    for (const layer of ["metro", "tram", "bus"] as const) next.delete(layer);
    return next;
  }, [routeActive, visibleLayers]);

  /** "Konumum": cihaz konumunu yol tarifinin başlangıcı yapar */
  const [locating, setLocating] = useState(false);
  const startFromMyLocation = async ({ silent = false } = {}) => {
    setLocating(true);
    try {
      const here = await getCurrentPlace();
      // Kullanıcı bu arada başka bir başlangıç seçtiyse üzerine yazma
      setRoute((prev) => (silent && prev.from ? prev : { ...prev, from: here }));
      setRouteCollapsed(false);
    } catch (error) {
      if (!silent) showNotice(locationErrorMessage(error));
    } finally {
      setLocating(false);
    }
  };

  /**
   * Başlangıç boşken, konum izni daha önce verilmişse sormadan konumdan başla (Google Haritalar gibi).
   * İzin hiç verilmemişse izin penceresi kendiliğinden açılmaz; kullanıcı "Konumum"a basar.
   */
  const autoStartFromMyLocation = async () => {
    if (await locationPermissionGranted()) void startFromMyLocation({ silent: true });
  };

  /** Tutamaçla küçült/büyüt: rota yeni alana yeniden sığdırılır */
  const handleRouteCollapsedChange = (collapsed: boolean) => {
    setRouteCollapsed(collapsed);
    setRouteRefitToken((t) => t + 1);
  };
  /** Haritanın üstünü kaplayan bir panel açık mı (Rota, Hatlar, Kayıtlı): üst arama ve kartlar gizlenir */
  const panelOpen = activeTab !== "map";

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
        ? placeIndex.search(query, CARD_LIMIT, undefined, nearViewFirst)
        : PLACES.filter((p) => p.kind === "poi" && visibleLayers.has(p.layer)),
    [query, visibleLayers, placeIndex],
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

  /** Durak kartındaki hat rozetine dokunuldu: hattı seç (güzergâhı indirilip haritada çizilir) */
  const handleSelectLine = (code: string) => {
    const place = findPlaceById(busLinePlaceId(code));
    if (place) handleSelect(place);
    else showNotice(`${code} hattının güzergâhı bulunamadı`);
  };

  /** Haritada bir yere dokunuldu: rota modunda boş uca yazılır, değilse bilgi kartı açılır */
  const handleMapPlaceClick = (place: Place) => {
    if (routeMode) {
      setRoute((prev) => (prev.from ? { ...prev, to: place } : { ...prev, from: place }));
      setRouteCollapsed(false); // yeni uç seçildi: seçenekler görünsün
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
    setRouteCollapsed(false);
    setSelectedPlace(null);
    setActiveTab("route");
    if (end === "to" && !route.from) void autoStartFromMyLocation();
  };

  const handleTabChange = (tab: TabId) => {
    // Açık panelin sekmesine tekrar basmak paneli kapatır
    setActiveTab((current) => (current === tab ? "map" : tab));
    setLayerPanelOpen(false);
    if (tab === "route") setSelectedPlace(null); // seçili yerin bilgi kartı panelin arkasında kalmasın
    if (tab === "route" && activeTab !== "route" && !route.from) void autoStartFromMyLocation();
  };

  /** Hatlar/Kayıtlı panelinden bir öğe seçildi: paneli kapat, haritada göster */
  const handlePanelSelect = (place: Place) => {
    setActiveTab("map");
    handleSelect(place);
  };

  const handleRouteChange = (next: RouteEndpoints) => {
    setRoute(next);
    setRouteCollapsed(false);
    if (next.from) revealLayerOf(next.from);
    if (next.to) revealLayerOf(next.to);
  };

  // Panellerin Escape/ResizeObserver efektlerine bağımlılık olarak gidiyor; kimliği sabit kalmalı
  const closePanel = useCallback(() => setActiveTab("map"), []);

  return (
    <div className="flex h-dvh flex-col">
      <main className="relative flex-1 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <BursaMap
            pois={POIS}
            visibleLayers={mapLayers}
            selectedPlace={selectedPlace}
            route={routeMode ? route : null}
            journey={routeMode ? selectedJourney : null}
            routeRefitToken={routeRefitToken}
            // Kullanıcı haritayı kaydırmaya başlayınca panel küçülür (kamera zıplamaz)
            onUserDrag={() => routeActive && setRouteCollapsed(true)}
            routeInset={routeMode ? routePanelInset : NO_INSET}
            onPlaceClick={handleMapPlaceClick}
            onEmptyClick={handleEmptyMapClick}
            onNotice={showNotice}
          />
        </div>

        {/* Üst overlay: arama + katman butonu. Dış kapsayıcı tıklamaları haritaya geçirir.
            Bir panel açıkken arama gizlenir (Rota'da Nereden/Nereye, Hatlar'da kendi filtresi var). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[1001] pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex max-w-2xl justify-end gap-2 p-4">
            {!panelOpen && (
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
        {!panelOpen && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[1000]">
            <div className="pointer-events-auto mx-auto max-w-5xl">
              <ResultCards
                places={cardPlaces}
                selected={selectedPlace}
                onSelect={handleSelect}
                onClearSelection={() => setSelectedPlace(null)}
                onDirections={handleDirections}
                onSelectLine={handleSelectLine}
              />
            </div>
          </div>
        )}

        <RoutePanel
          open={routeMode}
          from={route.from}
          to={route.to}
          onChange={handleRouteChange}
          onClose={closePanel}
          onInsetChange={handleRouteInsetChange}
          journeys={journeys}
          departAt={departAt}
          onDepartAtChange={setDepartAt}
          selectedJourney={selectedJourneyIndex}
          onSelectJourney={(index) => setJourneyChoice({ url: currentUrl, index })}
          collapsed={routeCollapsed}
          onCollapsedChange={handleRouteCollapsedChange}
          onUseMyLocation={() => void startFromMyLocation()}
          locating={locating}
        />

        <LinesPanel open={activeTab === "lines"} onClose={closePanel} onSelectLine={handlePanelSelect} />
        <SavedPanel open={activeTab === "saved"} onClose={closePanel} onSelect={handlePanelSelect} />

        {notice && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-0 top-20 z-[1200] mt-[env(safe-area-inset-top)] flex justify-center px-4"
          >
            <p className="rounded-full bg-slate-900/85 px-4 py-2 text-sm text-white shadow-lg">{notice}</p>
          </div>
        )}

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
