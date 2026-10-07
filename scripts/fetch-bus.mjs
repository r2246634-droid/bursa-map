/**
 * Seçili (öncelikli) otobüs hatlarını OpenStreetMap'ten çekip data/bus.json'a yazar.
 * Yüzlerce hattın tamamı yerine sadece BUS_ROUTES listesindeki hat numaraları alınır.
 *
 *   npm run data:bus   →  data/bus.json
 *
 * Aktarma tespiti için data/bursaray.json kullanılır; önce `npm run data:bursaray` çalışmış olmalı.
 * Veri © OpenStreetMap katkıda bulunanlar, ODbL lisansı.
 */
import { readFile, writeFile } from "node:fs/promises";

import {
  ATTRIBUTION,
  BURSA_BOUNDS,
  distanceMeters,
  fetchOverpass,
  indexOsm,
  isInsideBursa,
  slugId,
  stitchWays,
  toLineGeometry,
} from "./lib/osm.mjs";

/**
 * Öncelikli hatlar. Yeni hat eklemek için ref (hat numarası) ve renk eklemek yeterli.
 *
 * Not (2026-10): OSM'de Bursa için yalnızca ~17 otobüs güzergâhı var; BTÜ Mimar Sinan/Yıldırım
 * ve Terminal hatları henüz girilmemiş. Bulunamayan ref'ler için betik uyarı verir.
 */
const BUS_ROUTES = [
  { ref: "801", color: "#7c3aed" }, // Mustafakemalpaşa – Üniversite İstasyonu Aktarma Merkezi
  { ref: "901", color: "#db2777" }, // Karacabey – Üniversite İstasyonu Aktarma Merkezi
];

/** Bu mesafede metro/tramvay istasyonu olan durak "aktarma" sayılır */
const RAIL_TRANSFER_RADIUS_M = 150;

/** Aktarma merkezlerindeki peronlar OSM'de sadece "Peron 6" diye adlandırılmış */
const PLATFORM_NAME = /^peron\b/i;
const PLATFORM_CONTEXT_RADIUS_M = 300;

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function fetchOsm() {
  const [[south, west], [north, east]] = BURSA_BOUNDS;
  const refs = BUS_ROUTES.map((r) => escapeRegex(r.ref)).join("|");
  return fetchOverpass(
    `[out:json][timeout:90];` +
      `rel(${south},${west},${north},${east})["route"="bus"]["ref"~"^(${refs})$"];` +
      `out body;>;out body qt;`,
  );
}

async function loadRailStations() {
  const rail = JSON.parse(await readFile(new URL("../data/bursaray.json", import.meta.url), "utf8"));
  return rail.features
    .filter((f) => f.properties.type === "station")
    .map((f) => ({ name: f.properties.name, coord: f.geometry.coordinates }));
}

/**
 * "Peron 6" aramada anlamsız; yakındaki raylı istasyonun adını ekler:
 * "Üniversite Aktarma Merkezi – Peron 6"
 */
function contextualStopName(name, coord, railStations) {
  if (!PLATFORM_NAME.test(name)) return name;
  const nearest = railStations
    .map((r) => ({ ...r, d: distanceMeters(r.coord, coord) }))
    .sort((a, b) => a.d - b.d)[0];
  return nearest && nearest.d <= PLATFORM_CONTEXT_RADIUS_M
    ? `${nearest.name} Aktarma Merkezi – ${name}`
    : name;
}

function buildBusNetwork(osm, railStations) {
  const { nodes, relations, nodeCoord, routeWays, stopNodeIds } = indexOsm(osm);
  const lineOrder = BUS_ROUTES.map((r) => r.ref);

  const lineFeatures = [];
  /** isim → durak; birden fazla hattın geçtiği duraklar tek kayıtta birleşir */
  const stops = new Map();
  let droppedOutside = 0;

  for (const route of BUS_ROUTES) {
    // Her iki yön ayrı relation olabilir; hepsinin güzergâhını aynı hatta topluyoruz
    const rels = [...relations.values()].filter((r) => r.tags.ref === route.ref);
    if (rels.length === 0) {
      console.warn(`[bus] ${route.ref} hattı OSM'de bulunamadı, atlandı`);
      continue;
    }

    const parts = rels.flatMap((rel) => stitchWays(routeWays(rel)));
    const { from, to, name } = rels[0].tags;

    lineFeatures.push({
      type: "Feature",
      properties: {
        type: "line",
        mode: "bus",
        id: route.ref,
        name: from && to ? `${from} – ${to}` : (name ?? route.ref),
        color: route.color,
      },
      geometry: toLineGeometry(parts),
    });

    for (const rel of rels) {
      for (const nodeId of stopNodeIds(rel)) {
        const osmName = nodes.get(nodeId).tags?.name;
        if (!osmName) continue;
        const coord = nodeCoord(nodeId);
        const name = contextualStopName(osmName, coord, railStations);
        // Harita Bursa sınırına kilitli; dışarıdaki duraklara gidilemez, aramada da çıkmasın
        if (!isInsideBursa(coord)) {
          droppedOutside++;
          continue;
        }
        const existing = stops.get(name);
        if (existing) {
          if (!existing.lines.includes(route.ref)) existing.lines.push(route.ref);
        } else {
          stops.set(name, { name, coord, lines: [route.ref] });
        }
      }
    }
  }

  const stopFeatures = [...stops.values()].map((s) => ({
    type: "Feature",
    properties: {
      type: "station",
      mode: "bus",
      id: slugId("bus", s.name),
      name: s.name,
      lines: s.lines.sort((a, b) => lineOrder.indexOf(a) - lineOrder.indexOf(b)),
      transfer: railStations.some((r) => distanceMeters(r.coord, s.coord) <= RAIL_TRANSFER_RADIUS_M),
    },
    geometry: { type: "Point", coordinates: s.coord },
  }));

  if (droppedOutside) console.log(`[bus] Bursa sınırı dışındaki ${droppedOutside} durak kaydı atlandı`);

  return {
    type: "FeatureCollection",
    attribution: ATTRIBUTION,
    generatedAt: new Date().toISOString().slice(0, 10),
    features: [...lineFeatures, ...stopFeatures],
  };
}

const [osm, railStations] = await Promise.all([fetchOsm(), loadRailStations()]);
const collection = buildBusNetwork(osm, railStations);
await writeFile(new URL("../data/bus.json", import.meta.url), JSON.stringify(collection) + "\n");

const lines = collection.features.filter((f) => f.properties.type === "line");
const stops = collection.features.filter((f) => f.properties.type === "station");
console.log(
  `bus: ${lines.length} hat (${lines.map((f) => f.properties.id).join(", ")}), ${stops.length} durak. ` +
    `Aktarma: ${stops.filter((f) => f.properties.transfer).map((f) => f.properties.name).join(", ") || "-"}`,
);
