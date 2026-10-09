/**
 * Yaya yol ağı üzerinde arama — SADECE SUNUCUDA.
 *
 * Graf scripts/fetch-walk-graph.mjs ile OSM'nin yürünebilir yollarından üretilir
 * (data/walk/bursa-walk.bin.gz). Noktalar en yakın yol PARÇASINA (düğüme değil) yapıştırılır;
 * arama o parçanın iki ucundan başlar. Yapıştırma mesafesi (noktadan yola düz yürüyüş)
 * toplama eklenir.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export interface LatLon {
  lat: number;
  lon: number;
}

/** Bursa enleminde düz (equirectangular) yaklaşım: kısa mesafelerde haversine ile ~%0,1 fark */
const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320 * Math.cos((40.2 * Math.PI) / 180);
/** Grid hücresi (derece) ≈ 170 m */
const CELL_DEG = 0.002;
/** Nokta bundan uzaktaki yollara yapıştırılmaz (ör. ağın dışında kalan ilçeler) */
export const MAX_SNAP_M = 400;

export interface Snap {
  /** Yapıştırılan parçanın uçları ve uzunluğu */
  u: number;
  v: number;
  len: number;
  /** Parça üzerindeki konum: 0 = u, 1 = v */
  t: number;
  /** Noktadan yola düz mesafe */
  offset: number;
  /** Yol üzerindeki izdüşüm [boylam, enlem] */
  at: [number, number];
}

export interface GraphPath {
  meters: number;
  /** [boylam, enlem], başlangıç ve bitiş noktaları dahil */
  path: [number, number][];
}

export class WalkGraph {
  readonly nodeCount: number;
  private readonly from: Uint32Array;
  private readonly grid = new Map<number, number[]>();
  // Arama tamponları her sorguda yeniden ayrılmaz; geçerlilik "nesil" damgasıyla izlenir
  private readonly dist: Float64Array;
  private readonly prev: Int32Array;
  private readonly seen: Uint32Array;
  private generation = 0;

  constructor(
    /** ×1e6 tamsayı koordinatlar */
    private readonly lat: Int32Array,
    private readonly lon: Int32Array,
    /** CSR komşuluk: offsets[i]..offsets[i+1] arası targets/lengths */
    private readonly offsets: Uint32Array,
    private readonly targets: Uint32Array,
    private readonly lengths: Float32Array,
  ) {
    const n = (this.nodeCount = lat.length);
    this.from = new Uint32Array(targets.length);
    for (let i = 0; i < n; i++) this.from.fill(i, offsets[i], offsets[i + 1]);
    this.dist = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.seen = new Uint32Array(n);

    // Her yönsüz parça (u < v) kapladığı grid hücrelerine eklenir
    for (let e = 0; e < targets.length; e++) {
      const u = this.from[e];
      const v = targets[e];
      if (u > v) continue;
      const [x0, x1] = [Math.min(lon[u], lon[v]), Math.max(lon[u], lon[v])].map((x) => Math.floor(x / 1e6 / CELL_DEG));
      const [y0, y1] = [Math.min(lat[u], lat[v]), Math.max(lat[u], lat[v])].map((y) => Math.floor(y / 1e6 / CELL_DEG));
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = cellKey(x, y);
          const list = this.grid.get(key);
          if (list) list.push(e);
          else this.grid.set(key, [e]);
        }
      }
    }
  }

  static fromBuffer(buf: Buffer): WalkGraph {
    if (buf.toString("ascii", 0, 4) !== "BWG1") throw new Error("Yaya ağı dosyası tanınmadı");
    const n = buf.readUInt32LE(4);
    const m = buf.readUInt32LE(8);
    // Typed array'ler 4 bayt hizalı olmalı: tamponu kopyalayıp baştan hizalı ArrayBuffer kullan
    const ab = new Uint8Array(buf).buffer;
    let at = 12;
    const take = <T>(Ctor: new (b: ArrayBuffer, o: number, l: number) => T, count: number): T => {
      const arr = new Ctor(ab, at, count);
      at += count * 4;
      return arr;
    };
    return new WalkGraph(
      take(Int32Array, n),
      take(Int32Array, n),
      take(Uint32Array, n + 1),
      take(Uint32Array, m),
      take(Float32Array, m),
    );
  }

  private x(i: number) {
    return this.lon[i] / 1e6;
  }
  private y(i: number) {
    return this.lat[i] / 1e6;
  }

  /** Noktayı en yakın yol parçasına yapıştırır; MAX_SNAP_M içinde yol yoksa null */
  snap(p: LatLon, maxMeters = MAX_SNAP_M): Snap | null {
    const cx = Math.floor(p.lon / CELL_DEG);
    const cy = Math.floor(p.lat / CELL_DEG);
    const reach = Math.ceil(maxMeters / (CELL_DEG * M_PER_DEG_LON));
    let best: Snap | null = null;
    // Halka halka genişle; bulunan en iyi aday bir sonraki halkadan yakınsa dur
    for (let r = 0; r <= reach; r++) {
      if (best && best.offset < (r - 1) * CELL_DEG * M_PER_DEG_LON) break;
      for (let x = cx - r; x <= cx + r; x++) {
        for (let y = cy - r; y <= cy + r; y++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
          for (const e of this.grid.get(cellKey(x, y)) ?? []) {
            const candidate = this.project(p, e);
            if (candidate.offset <= maxMeters && (!best || candidate.offset < best.offset)) best = candidate;
          }
        }
      }
    }
    return best;
  }

  private project(p: LatLon, e: number): Snap {
    const u = this.from[e];
    const v = this.targets[e];
    const ax = (this.x(u) - p.lon) * M_PER_DEG_LON;
    const ay = (this.y(u) - p.lat) * M_PER_DEG_LAT;
    const bx = (this.x(v) - p.lon) * M_PER_DEG_LON;
    const by = (this.y(v) - p.lat) * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2));
    const px = ax + t * dx;
    const py = ay + t * dy;
    return {
      u,
      v,
      len: this.lengths[e],
      t,
      offset: Math.hypot(px, py),
      at: [p.lon + px / M_PER_DEG_LON, p.lat + py / M_PER_DEG_LAT],
    };
  }

  /**
   * Çok kaynaklı Dijkstra / A*. Kaynaklar başlangıç maliyetleriyle verilir; goal verilirse
   * hedefe en kısa yol bulununca (ve sezgisel ile) erken durur. maxMeters'ı aşan düğümler açılmaz.
   */
  private search(sources: [number, number][], maxMeters: number, goal?: { x: number; y: number; done: (reached: (i: number) => number) => number }) {
    const gen = ++this.generation;
    const { dist, prev, seen, offsets, targets, lengths } = this;
    const heap = new MinHeap();
    const reached = (i: number) => (seen[i] === gen ? dist[i] : Infinity);
    const h = (i: number) =>
      goal ? 0.99 * Math.hypot((this.x(i) - goal.x) * M_PER_DEG_LON, (this.y(i) - goal.y) * M_PER_DEG_LAT) : 0;
    for (const [node, cost] of sources) {
      if (seen[node] === gen && dist[node] <= cost) continue;
      seen[node] = gen;
      dist[node] = cost;
      prev[node] = -1;
      heap.push(node, cost + h(node));
    }
    while (heap.size) {
      const [node, key] = heap.pop();
      const d = dist[node];
      if (key - h(node) > d + 1e-9) continue; // eski kayıt
      if (goal && key >= goal.done(reached)) break;
      if (d > maxMeters) break;
      for (let k = offsets[node]; k < offsets[node + 1]; k++) {
        const next = targets[k];
        const nd = d + lengths[k];
        if (seen[next] === gen && dist[next] <= nd) continue;
        seen[next] = gen;
        dist[next] = nd;
        prev[next] = node;
        heap.push(next, nd + h(next));
      }
    }
    return reached;
  }

  private static ends(s: Snap): [number, number][] {
    return [
      [s.u, s.offset + s.t * s.len],
      [s.v, s.offset + (1 - s.t) * s.len],
    ];
  }

  /**
   * Bir noktadan çok sayıda noktaya yürüme mesafeleri (graf yönsüz: tersi de aynı).
   * Yola yapıştırılamayan (ağ dışındaki) hedef null, maxMeters içinde ulaşılamayan Infinity.
   */
  distances(origin: LatLon, points: LatLon[], maxMeters: number): (number | null)[] | null {
    const start = this.snap(origin);
    if (!start) return null;
    const reached = this.search(WalkGraph.ends(start), maxMeters);
    return points.map((p) => {
      const end = this.snap(p);
      if (!end) return null;
      let best = Math.min(...WalkGraph.ends(end).map(([node, extra]) => reached(node) + extra));
      if (sameSegment(start, end)) best = Math.min(best, start.offset + Math.abs(start.t - end.t) * start.len + end.offset);
      return best <= maxMeters ? best : Infinity;
    });
  }

  /** İki nokta arası en kısa yürüme güzergâhı; yol yoksa veya maxMeters'ı aşıyorsa null */
  route(a: LatLon, b: LatLon, maxMeters: number): GraphPath | null {
    const start = this.snap(a);
    const end = this.snap(b);
    if (!start || !end) return null;
    const goals = WalkGraph.ends(end);
    let best = Infinity;
    let bestNode = -1;
    const done = (reached: (i: number) => number) => {
      // Hedef parçanın uçlarından birine ulaşıldıysa en iyi toplamı güncelle
      for (const [node, extra] of goals) {
        const total = reached(node) + extra;
        if (total < best) [best, bestNode] = [total, node];
      }
      return best;
    };
    done(this.search(WalkGraph.ends(start), maxMeters, { x: end.at[0], y: end.at[1], done }));

    const direct = sameSegment(start, end) ? start.offset + Math.abs(start.t - end.t) * start.len + end.offset : Infinity;
    if (direct <= best && direct <= maxMeters) {
      return { meters: direct, path: dedupe([[a.lon, a.lat], start.at, end.at, [b.lon, b.lat]]) };
    }
    if (bestNode < 0 || best > maxMeters) return null;

    const nodes: number[] = [];
    for (let i = bestNode; i !== -1; i = this.prev[i]) nodes.push(i);
    nodes.reverse();
    return {
      meters: best,
      path: dedupe([[a.lon, a.lat], start.at, ...nodes.map((i): [number, number] => [this.x(i), this.y(i)]), end.at, [b.lon, b.lat]]),
    };
  }
}

const cellKey = (x: number, y: number) => x * 100_000 + y;
/** Ardışık aynı noktalar (ör. yola tam düğümde yapıştırma) çizgiye girmesin */
const dedupe = (path: [number, number][]) =>
  path.filter((p, i) => i === 0 || Math.abs(p[0] - path[i - 1][0]) > 1e-9 || Math.abs(p[1] - path[i - 1][1]) > 1e-9);
const sameSegment = (a: Snap, b: Snap) => a.u === b.u && a.v === b.v;

/** İkili yığın (düğüm, anahtar) */
class MinHeap {
  private nodes: number[] = [];
  private keys: number[] = [];
  get size() {
    return this.nodes.length;
  }
  push(node: number, key: number) {
    const { nodes, keys } = this;
    let i = nodes.length;
    nodes.push(node);
    keys.push(key);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] <= key) break;
      nodes[i] = nodes[parent];
      keys[i] = keys[parent];
      i = parent;
    }
    nodes[i] = node;
    keys[i] = key;
  }
  pop(): [number, number] {
    const { nodes, keys } = this;
    const top: [number, number] = [nodes[0], keys[0]];
    const lastNode = nodes.pop()!;
    const lastKey = keys.pop()!;
    if (nodes.length) {
      let i = 0;
      const n = nodes.length;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && keys[child + 1] < keys[child]) child++;
        if (keys[child] >= lastKey) break;
        nodes[i] = nodes[child];
        keys[i] = keys[child];
        i = child;
      }
      nodes[i] = lastNode;
      keys[i] = lastKey;
    }
    return top;
  }
}

/** Dosyanın repo içindeki yeri; Vercel paketine next.config outputFileTracingIncludes ile girer */
export const WALK_GRAPH_FILE = path.join("data", "walk", "bursa-walk.bin.gz");

let loaded: WalkGraph | null | undefined;

/** Grafı ilk kullanımda yükler; dosya yoksa null (yürüyüşler kuş uçuşu tahmin olarak kalır) */
export function getWalkGraph(): WalkGraph | null {
  if (loaded !== undefined) return loaded;
  if (process.env.WALK_GRAPH === "off") return (loaded = null); // testler: sentetik graf kullanır
  try {
    const started = performance.now();
    loaded = WalkGraph.fromBuffer(gunzipSync(readFileSync(path.join(process.cwd(), WALK_GRAPH_FILE))));
    console.info(`[walking] yaya ağı yüklendi: ${loaded.nodeCount} düğüm, ${Math.round(performance.now() - started)} ms`);
  } catch (error) {
    console.warn(`[walking] yaya ağı yüklenemedi (${(error as Error).message}); kuş uçuşu tahmin kullanılacak`);
    loaded = null;
  }
  return loaded;
}

/** Testler için: sentetik graf (veya null) kullan */
export function setWalkGraph(graph: WalkGraph | null | undefined) {
  loaded = graph;
}
