import { POIS } from "./pois";
import { TRANSIT_STATIONS } from "./transit-network";
import type { Place } from "./types";

/** Aranabilir tüm yerler: ilgi noktaları + metro/tramvay istasyonları + otobüs durakları */
export const PLACES: Place[] = [
  ...POIS.map((poi): Place => ({
    kind: "poi",
    id: poi.id,
    name: poi.name,
    position: poi.position,
    layer: poi.layer,
    aliases: poi.aliases,
  })),
  ...TRANSIT_STATIONS.map(({ properties: p, geometry }): Place => {
    const [lng, lat] = geometry.coordinates;
    return {
      kind: "station",
      id: p.id,
      name: p.name,
      position: [lat, lng],
      layer: p.mode,
      mode: p.mode,
      lines: p.lines,
      transfer: p.transfer,
    };
  }),
];

/** Haritada tıklanan kendi katmanlarımızdaki öğeyi (istasyon, öne çıkan nokta) bulmak için */
export const PLACE_BY_ID = new Map(PLACES.map((p) => [p.id, p]));
