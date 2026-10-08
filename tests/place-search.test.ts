import { describe, expect, it } from "vitest";

import { PLACES } from "@/data/places";
import type { Place } from "@/data/types";
import { placeBoost } from "@/lib/place-search";
import { createSearchIndex } from "@/lib/search";

/** Gerçek veri setinden tipik iki otobüs durağı (BURULAŞ adları) */
const busStop = (id: number, name: string): Place => ({
  kind: "station",
  id: `bus-stop-${id}`,
  name,
  position: [40.21, 29.01],
  layer: "bus",
  mode: "bus",
  lines: ["1D"],
  transfer: false,
});

describe("uygulama arama sıralaması (placeBoost)", () => {
  const index = createSearchIndex(
    [...PLACES, busStop(1, "Acemler 1"), busStop(2, "Acemler 2"), busStop(3, "Acemler")],
    placeBoost,
  );
  const ids = (q: string, n = 10) => index.search(q, n).map((p) => p.id);

  it("'acemler': metro istasyonu, adı 'Acemler' ile başlayan otobüs duraklarının önünde", () => {
    const order = ids("acemler");
    expect(order.indexOf("metro-bursaspor-acemler")).toBeLessThan(order.indexOf("bus-stop-1"));
    expect(order.indexOf("metro-bursaspor-acemler")).toBeLessThan(order.indexOf("bus-stop-2"));
  });

  it("otobüs durakları arasında adı birebir eşleşen öne geçer", () => {
    const order = ids("acemler");
    expect(order.indexOf("bus-stop-3")).toBeLessThan(order.indexOf("bus-stop-1"));
  });

  it("öne çıkan nokta (aktarma merkezi) tüm otobüs duraklarının önünde, ilk sırada", () => {
    expect(ids("acemler")[0]).toBe("acemler-aktarma");
  });

  it("raylı istasyonlar ve öne çıkan noktalar öncelikli, otobüs durakları nötr", () => {
    expect(placeBoost(busStop(9, "X"))).toBe(0);
    const metro = PLACES.find((p) => p.id === "metro-bursaspor-acemler")!;
    expect(placeBoost(metro)).toBeLessThan(-1); // kelime başı (2) eşleşmeyi baştan eşleşmenin (1) önüne geçirir
    expect(placeBoost(metro)).toBeGreaterThan(-2); // ama tam eşleşmeyi (0) geçemez
  });
});
