/**
 * Bursa raylı sistem hatlarını (BursaRay metro + BurTram tramvay) OpenStreetMap'ten
 * (Overpass API) çekip uygulamanın kullandığı sade GeoJSON formatına çevirir.
 *
 *   npm run data:bursaray   →  data/bursaray.json
 *
 * Veri © OpenStreetMap katkıda bulunanlar, ODbL lisansı.
 */
import { writeFile } from "node:fs/promises";

import {
  ATTRIBUTION,
  distanceMeters,
  fetchOverpass,
  indexOsm,
  slugId,
  stitchWays,
  toLineGeometry,
} from "./lib/osm.mjs";

/**
 * Çekilecek hatlar. Her hattın tek yön relation'ı yeterli (diğer yön aynı rayları kullanıyor).
 *  - reverse: geometriyi ters çevir. Ortak gövdedeki metro hatlarını yan yana kaydırarak
 *    (offset) çiziyoruz; kaydırma yönü çizim yönüne bağlı olduğundan M1/M2 batı → doğu yazılır.
 *  - fallbackColor: OSM'de `colour` etiketi yoksa kullanılacak renk.
 */
const LINES = [
  { ref: "M1", mode: "metro", relation: 7868620 }, // Geçit/Balat → Arabayatağı
  { ref: "M2", mode: "metro", relation: 7869620, reverse: true }, // Kestel → Üniversite
  // Tramvay renkleri OSM'de yok; buradakiler resmi renkler değil, ayırt edilebilir seçildi
  { ref: "T1", mode: "tram", relation: 11322581, fallbackColor: "#16a34a" }, // Kent Meydanı – Heykel (ring)
  { ref: "T2", mode: "tram", relation: 14502329, fallbackColor: "#d97706" }, // Kent Meydanı → Terminal
  { ref: "T3", mode: "tram", relation: 19781239, fallbackColor: "#0891b2" }, // Zafer Plaza → Çınarönü
];

const LINE_ORDER = LINES.map((l) => l.ref);

/** OSM `colour` etiketi isim olarak geliyor; haritada kullanılacak hex karşılıkları */
const COLOR_HEX = { red: "#e30613", black: "#1f2937", blue: "#0057b8", green: "#16a34a" };

/**
 * Aktarma istasyonu:
 *  - aynı türdeki hatların ayrıldığı uç istasyonlar (ör. M1/M2 için Bursaspor/Acemler), veya
 *  - bu mesafede diğer türden (metro ↔ tramvay) bir istasyon bulunanlar.
 */
const TRANSFER_RADIUS_M = 250;

/**
 * OSM'deki bilinen hatalar/eksikler. Dosyaya yazmadan hemen önce uygulanır.
 * OSM'de düzeltildiklerinde betik uyarı verir; o zaman buradan silinebilir.
 */
const OSM_OVERRIDES = {
  lines: {
    // OSM'de "black" olarak etiketli, resmi hat rengi mavi
    M2: { color: "#0057b8" },
  },
  stations: [
    // OSM'deki M2 relation'ında Duaçınarı durağı eksik
    { mode: "metro", name: "Duaçınarı", addLines: ["M2"] },
  ],
};

const byLineOrder = (a, b) => LINE_ORDER.indexOf(a) - LINE_ORDER.indexOf(b);

function fetchOsm() {
  const ids = LINES.map((l) => l.relation).join(",");
  return fetchOverpass(`[out:json][timeout:90];rel(id:${ids});out body;>;out body qt;`);
}

function buildNetwork(osm) {
  const { nodes, relations, nodeCoord, routeWays, stopNodeIds } = indexOsm(osm);

  // Tramvay durakları OSM'de "T1-Heykel" gibi hat önekiyle adlandırılmış
  const stationName = (node) => node.tags?.name?.replace(/^[A-Z]\d+\s*-\s*/, "");

  const lineFeatures = [];
  /** "mod:isim" → istasyon. Aynı türde ortak duraklar tek kayıtta birleşir. */
  const stations = new Map();
  /** Her hattın sıralı durak anahtarları (ayrım noktası tespiti için) */
  const stopKeysByLine = new Map();

  for (const line of LINES) {
    const rel = relations.get(line.relation);
    if (!rel) throw new Error(`Relation ${line.relation} (${line.ref}) bulunamadı`);

    let parts = stitchWays(routeWays(rel));
    if (line.reverse) parts = parts.reverse().map((p) => [...p].reverse());

    lineFeatures.push({
      type: "Feature",
      properties: {
        type: "line",
        mode: line.mode,
        id: line.ref,
        // OSM `name` etiketleri tutarsız ("T1 Tramvay Hattı"); güzergâhı from/to'dan kuruyoruz
        name:
          rel.tags.from && rel.tags.to ? `${rel.tags.from} – ${rel.tags.to}` : (rel.tags.name ?? line.ref),
        color: COLOR_HEX[rel.tags.colour] ?? rel.tags.colour ?? line.fallbackColor ?? "#64748b",
      },
      geometry: toLineGeometry(parts),
    });

    const keys = [];
    for (const nodeId of stopNodeIds(rel)) {
      const name = stationName(nodes.get(nodeId));
      if (!name) continue;
      const key = `${line.mode}:${name}`;
      keys.push(key);
      const existing = stations.get(key);
      if (existing) {
        if (!existing.lines.includes(line.ref)) existing.lines.push(line.ref);
      } else {
        stations.set(key, { mode: line.mode, name, coord: nodeCoord(nodeId), lines: [line.ref] });
      }
    }
    stopKeysByLine.set(line.ref, keys);
  }

  // Aynı türdeki hatların ortak bölümünün iki ucu = hatların ayrıldığı aktarma istasyonları
  const branchKeys = new Set();
  for (const keys of stopKeysByLine.values()) {
    const shared = keys.filter((k) => stations.get(k).lines.length > 1);
    if (shared.length) {
      branchKeys.add(shared[0]);
      branchKeys.add(shared.at(-1));
    }
  }

  const all = [...stations.entries()];
  const stationFeatures = all.map(([key, s]) => ({
    type: "Feature",
    properties: {
      type: "station",
      mode: s.mode,
      id: slugId(s.mode, s.name),
      name: s.name,
      lines: s.lines.sort(byLineOrder),
      transfer:
        branchKeys.has(key) ||
        all.some(
          ([, other]) =>
            other.mode !== s.mode && distanceMeters(other.coord, s.coord) <= TRANSFER_RADIUS_M,
        ),
    },
    geometry: { type: "Point", coordinates: s.coord },
  }));

  return {
    type: "FeatureCollection",
    // Veri kaynağı ve lisans bilgisi (GeoJSON'da ek üst düzey alanlara izin var)
    attribution: ATTRIBUTION,
    generatedAt: new Date().toISOString().slice(0, 10),
    features: [...lineFeatures, ...stationFeatures],
  };
}

/** OSM_OVERRIDES tablosunu koleksiyona uygular (yerinde değiştirir). */
function overrideOsmData(collection) {
  const lines = collection.features.filter((f) => f.properties.type === "line");
  const stations = collection.features.filter((f) => f.properties.type === "station");

  for (const [ref, patch] of Object.entries(OSM_OVERRIDES.lines)) {
    const line = lines.find((f) => f.properties.id === ref);
    if (!line) {
      console.warn(`[override] ${ref} hattı bulunamadı, atlandı`);
      continue;
    }
    if (patch.color && line.properties.color === patch.color) {
      console.warn(`[override] ${ref} rengi zaten ${patch.color}; OSM düzeltilmiş olabilir`);
    }
    Object.assign(line.properties, patch);
  }

  for (const { mode, name, addLines } of OSM_OVERRIDES.stations) {
    const station = stations.find((f) => f.properties.mode === mode && f.properties.name === name);
    if (!station) {
      console.warn(`[override] ${mode} istasyonu "${name}" bulunamadı, atlandı`);
      continue;
    }
    const missing = addLines.filter((ref) => !station.properties.lines.includes(ref));
    if (missing.length === 0) {
      console.warn(`[override] "${name}" zaten ${addLines.join(", ")} içeriyor; OSM düzeltilmiş olabilir`);
    }
    station.properties.lines = [...station.properties.lines, ...missing].sort(byLineOrder);
  }

  return collection;
}

const collection = overrideOsmData(buildNetwork(await fetchOsm()));
await writeFile(new URL("../data/bursaray.json", import.meta.url), JSON.stringify(collection) + "\n");

for (const mode of ["metro", "tram"]) {
  const stations = collection.features.filter(
    (f) => f.properties.type === "station" && f.properties.mode === mode,
  );
  const transfers = stations.filter((f) => f.properties.transfer).map((f) => f.properties.name);
  console.log(`${mode}: ${stations.length} istasyon. Aktarma: ${transfers.join(", ") || "-"}`);
}
