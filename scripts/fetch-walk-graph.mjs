/**
 * Yaya yol ağı: OSM'den Bursa'nın yürünebilir yollarını indirip sunucunun Dijkstra ile
 * arayacağı kompakt bir grafa çevirir (lib/routing/walk-graph.ts okur).
 *
 *   node scripts/fetch-walk-graph.mjs            # ham veri data/raw'da varsa onu kullanır
 *   node scripts/fetch-walk-graph.mjs --refresh  # Overpass'tan yeniden indirir
 *
 * Alan: BURULAŞ duraklarının ~%98'ini kapsayan dikdörtgen (dışındaki ilçe durakları için
 * yürüme mesafesi kuş uçuşu tahmin olarak kalır).
 *
 * Çıktı data/walk/bursa-walk.bin.gz — küçük-endian, gzip'li:
 *   "BWG1" | düğüm sayısı n (u32) | yönlü kenar sayısı m (u32)
 *   enlem Int32[n] (×1e6) | boylam Int32[n] (×1e6)
 *   CSR: başlangıçlar Uint32[n+1] | hedefler Uint32[m] | uzunluklar Float32[m] (metre)
 * Sadece en büyük bağlı bileşen tutulur: bina içi/özel küçük yol parçalarına yapıştırılan
 * nokta hiçbir yere ulaşamaz duruma düşmesin.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { ATTRIBUTION, distanceMeters, fetchOverpass } from "./lib/osm.mjs";

const BBOX = { south: 40.06, west: 28.7, north: 40.49, east: 29.54 };
const RAW_FILE = "data/raw/walk-ways.json";
const OUT_DIR = "data/walk";
const OUT_FILE = `${OUT_DIR}/bursa-walk.bin.gz`;

// Otoyollar hariç; Türkiye'de birçok bulvar "trunk" etiketli ve kaldırımlı olduğundan dahil
const HIGHWAYS = [
  "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link",
  "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service",
  "pedestrian", "footway", "path", "steps", "track", "cycleway", "corridor", "platform", "road",
];

// Tek sorgu Overpass'ı zorlayıp 504 döndürüyor: alan parçalara bölünür, sonuçlar birleştirilir
const TILES = { rows: 3, cols: 4 };
const query = (bbox) => `[out:json][timeout:180];
way(${bbox})["highway"~"^(${HIGHWAYS.join("|")})$"]["foot"!~"^(no|private)$"]["access"!~"^(no|private)$"]["area"!="yes"];
(._;>;);
out skel qt;`;

async function loadOsm() {
  if (existsSync(RAW_FILE) && !process.argv.includes("--refresh")) {
    console.log(`Ham veri: ${RAW_FILE}`);
    return JSON.parse(readFileSync(RAW_FILE, "utf8"));
  }
  console.log("Overpass'tan yürünebilir yollar indiriliyor (birkaç dakika sürebilir)…");
  const elements = new Map();
  const dLat = (BBOX.north - BBOX.south) / TILES.rows;
  const dLon = (BBOX.east - BBOX.west) / TILES.cols;
  for (let r = 0; r < TILES.rows; r++) {
    for (let c = 0; c < TILES.cols; c++) {
      const s = BBOX.south + r * dLat;
      const w = BBOX.west + c * dLon;
      const part = await fetchOverpass(query(`${s},${w},${s + dLat},${w + dLon}`));
      for (const el of part.elements) elements.set(`${el.type}/${el.id}`, el);
      console.log(`  parça ${r * TILES.cols + c + 1}/${TILES.rows * TILES.cols}: ${part.elements.length} öğe`);
    }
  }
  const osm = { elements: [...elements.values()] };
  mkdirSync("data/raw", { recursive: true });
  writeFileSync(RAW_FILE, JSON.stringify(osm));
  return osm;
}

const osm = await loadOsm();
const coords = new Map(); // OSM düğüm kimliği → [boylam, enlem]
const ways = [];
for (const el of osm.elements) {
  if (el.type === "node") coords.set(el.id, [el.lon, el.lat]);
  else if (el.type === "way") ways.push(el.nodes);
}

// Kenarlar (yönsüz, tekrarsız)
const index = new Map(); // OSM kimliği → yerel sıra
const local = (id) => {
  let i = index.get(id);
  if (i === undefined) index.set(id, (i = index.size));
  return i;
};
const edgeSet = new Set();
const edges = [];
for (const nodes of ways) {
  for (let k = 1; k < nodes.length; k++) {
    const [a, b] = [nodes[k - 1], nodes[k]];
    if (a === b || !coords.has(a) || !coords.has(b)) continue;
    const [u, v] = [local(a), local(b)];
    const key = u < v ? `${u}:${v}` : `${v}:${u}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push([u, v]);
  }
}
const osmIds = [...index.keys()];
const n0 = osmIds.length;

// En büyük bağlı bileşen (birleşim-bul)
const parent = Int32Array.from({ length: n0 }, (_, i) => i);
const find = (x) => {
  while (parent[x] !== x) x = parent[x] = parent[parent[x]];
  return x;
};
for (const [u, v] of edges) parent[find(u)] = find(v);
const sizes = new Map();
for (let i = 0; i < n0; i++) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
const [mainRoot, mainSize] = ranked[0];
console.log(`Bileşenler: ${ranked.length}; en büyük ${mainSize} düğüm, sonrakiler ${ranked.slice(1, 4).map((r) => r[1]).join(", ")}`);

const remap = new Int32Array(n0).fill(-1);
let n = 0;
for (let i = 0; i < n0; i++) if (find(i) === mainRoot) remap[i] = n++;

const lat = new Int32Array(n);
const lon = new Int32Array(n);
for (let i = 0; i < n0; i++) {
  if (remap[i] < 0) continue;
  const [x, y] = coords.get(osmIds[i]);
  lat[remap[i]] = Math.round(y * 1e6);
  lon[remap[i]] = Math.round(x * 1e6);
}

const kept = edges.filter(([u]) => remap[u] >= 0).map(([u, v]) => [remap[u], remap[v]]);
const degree = new Uint32Array(n);
for (const [u, v] of kept) {
  degree[u]++;
  degree[v]++;
}
const offsets = new Uint32Array(n + 1);
for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + degree[i];
const m = offsets[n];
const targets = new Uint32Array(m);
const lengths = new Float32Array(m);
const fill = offsets.slice(0, n);
const point = (i) => [lon[i] / 1e6, lat[i] / 1e6];
for (const [u, v] of kept) {
  const d = distanceMeters(point(u), point(v));
  targets[fill[u]] = v;
  lengths[fill[u]++] = d;
  targets[fill[v]] = u;
  lengths[fill[v]++] = d;
}

const header = Buffer.alloc(12);
header.write("BWG1", 0, "ascii");
header.writeUInt32LE(n, 4);
header.writeUInt32LE(m, 8);
const raw = Buffer.concat([header, ...[lat, lon, offsets, targets, lengths].map((a) => Buffer.from(a.buffer))]);
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, gzipSync(raw, { level: 9 }));
writeFileSync(
  `${OUT_DIR}/meta.json`,
  JSON.stringify({ bbox: BBOX, nodes: n, edges: m / 2, builtAt: new Date().toISOString(), attribution: ATTRIBUTION }, null, 2) + "\n",
);
console.log(`${OUT_FILE}: ${n} düğüm, ${m / 2} kenar, ${(raw.length / 1e6).toFixed(1)} MB → gzip ${(readFileSync(OUT_FILE).length / 1e6).toFixed(1)} MB`);
