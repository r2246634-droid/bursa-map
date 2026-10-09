import { afterEach, describe, expect, it } from "vitest";

import { refineWalkLegs } from "@/lib/routing/refine";
import { haversineMeters } from "@/lib/routing/time";
import type { Journey, RideLeg, WalkLeg } from "@/lib/routing/types";
import { setWalkGraph, WalkGraph } from "@/lib/routing/walk-graph";
import { walkDistances, walkPath } from "@/lib/routing/walking";

import { graphOf } from "./walk-graph-fixture";

/**
 * Yaya ağı (lib/routing/walk-graph.ts) ve onu kullanan yürüyüş iyileştirmesi (refine.ts).
 *
 * Bir bina adası (≈ 170 m × 110 m) etrafında sokaklar; A ve B adanın karşı köşelerinde:
 *
 *   n3 ─────── n2
 *   │  (bina)   │      A ≈ n0'ın yanı, B ≈ n2'nin yanı
 *   n0 ─────── n1      kuş uçuşu çapraz ≈ 200 m, sokaktan ≈ 300 m
 *
 *   n4 ── n5   (ayrı, bağlantısız küçük parça)
 */
const LON0 = 29.06;
const LAT0 = 40.19;
const DX = 0.002; // ≈ 170 m
const DY = 0.001; // ≈ 111 m
const nodes: [number, number][] = [
  [LON0, LAT0],
  [LON0 + DX, LAT0],
  [LON0 + DX, LAT0 + DY],
  [LON0, LAT0 + DY],
  [LON0 + 0.02, LAT0],
  [LON0 + 0.021, LAT0],
];
const block = () => graphOf(nodes, [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5]]);
const ll = ([lon, lat]: [number, number]) => ({ lat, lon });
const A = { name: "A", lat: LAT0 - 0.0001, lon: LON0 }; // yolun ≈ 11 m güneyi
const B = { name: "B", lat: LAT0 + DY + 0.0001, lon: LON0 + DX };

afterEach(() => setWalkGraph(undefined));

describe("WalkGraph", () => {
  it("noktayı en yakın yol parçasına (düğüme değil) yapıştırır", () => {
    const snap = block().snap({ lat: LAT0 - 0.0002, lon: LON0 + DX / 2 })!;
    expect([snap.u, snap.v].sort()).toEqual([0, 1]);
    expect(snap.t).toBeCloseTo(0.5, 2);
    expect(snap.offset).toBeCloseTo(22, 0);
    expect(snap.at[1]).toBeCloseTo(LAT0, 6);
  });

  it("güzergâh binanın içinden değil sokaklardan geçer; mesafeye yola çıkış dahildir", () => {
    const route = block().route(A, B, 5000)!;
    const around = haversineMeters(ll(nodes[0]), ll(nodes[1])) + haversineMeters(ll(nodes[1]), ll(nodes[2]));
    expect(route.meters).toBeCloseTo(around + 11.06 * 2, 0);
    expect(route.meters).toBeGreaterThan(haversineMeters(A, B) * 1.3);
    expect(route.path[0]).toEqual([A.lon, A.lat]);
    expect(route.path.at(-1)).toEqual([B.lon, B.lat]);
    // Adanın iki yanı eşit uzunlukta: köşelerden birinden döner, çaprazdan geçmez
    const corner = (i: number) => route.path.some(([x, y]) => Math.abs(x - nodes[i][0]) < 1e-9 && Math.abs(y - nodes[i][1]) < 1e-9);
    expect(corner(1) || corner(3)).toBe(true);
    expect(route.path).toHaveLength(5);
  });

  it("aynı yol parçası üzerindeki iki nokta arasında doğrudan yürür", () => {
    const route = block().route({ lat: LAT0, lon: LON0 + 0.0005 }, { lat: LAT0, lon: LON0 + 0.0015 }, 5000)!;
    expect(route.meters).toBeCloseTo(0.001 * 111_320 * Math.cos((LAT0 * Math.PI) / 180), -1);
    expect(route.path).toHaveLength(2); // noktalar zaten yolun üzerinde: tek düz parça
  });

  it("mesafeler: bağlantısız parçaya ve sınırı aşana Infinity, ağ dışındaki noktaya null", () => {
    const g = block();
    const far = { lat: LAT0 + 0.05, lon: LON0 }; // en yakın yol ≈ 5 km
    const island = ll(nodes[4]);
    const [toB, toIsland, toFar] = g.distances(A, [B, island, far], 5000)!;
    expect(toB).toBeCloseTo(g.route(A, B, 5000)!.meters, 3);
    expect(toIsland).toBe(Infinity);
    expect(toFar).toBeNull();
    expect(g.distances(A, [B], 100)).toEqual([Infinity]);
    expect(g.distances(far, [B], 5000)).toBeNull();
  });

  it("betiğin ürettiği ikili dosya biçimini okur", () => {
    const parts = [
      Int32Array.from([LAT0 * 1e6, LAT0 * 1e6]),
      Int32Array.from([LON0 * 1e6, (LON0 + DX) * 1e6]),
      Uint32Array.from([0, 1, 2]),
      Uint32Array.from([1, 0]),
      Float32Array.from([170, 170]),
    ];
    const header = Buffer.alloc(12);
    header.write("BWG1", 0, "ascii");
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(2, 8);
    const g = WalkGraph.fromBuffer(Buffer.concat([header, ...parts.map((p) => Buffer.from(p.buffer))]));
    expect(g.nodeCount).toBe(2);
    expect(g.route({ lat: LAT0, lon: LON0 }, { lat: LAT0, lon: LON0 + DX }, 1000)?.meters).toBeCloseTo(170, 0);
  });
});

describe("walking (varsayılan graf)", () => {
  it("graf yoksa null döner (çağıran kuş uçuşu tahmine düşer)", () => {
    setWalkGraph(null);
    expect(walkDistances(A, [B])).toBeNull();
    expect(walkPath(A, B)).toBeNull();
  });
});

describe("refineWalkLegs — seçenekleri sokak yürüyüşüyle güncelleme", () => {
  const walk = (from: typeof A, to: typeof A, meters: number): WalkLeg => ({
    type: "walk",
    from,
    to,
    meters,
    departure: 0,
    arrival: 0,
  });
  const ride = (departure: number, arrival: number): RideLeg => ({
    type: "ride",
    line: "22C",
    kind: "bus",
    direction: "R",
    headsign: "Son",
    from: B,
    to: A,
    departure,
    arrival,
    stopCount: 5,
    path: [],
    estimated: true,
  });
  const journey = (legs: Journey["legs"]): Journey => ({
    departure: 0,
    arrival: 0,
    durationMin: 0,
    transfers: 0,
    walkMeters: 0,
    legs,
    tags: [],
  });
  const t0 = 8 * 3600;

  it("yürüme bacağına sokak güzergâhı ekler ve çıkış saatini gerçek mesafeye göre öne alır", () => {
    setWalkGraph(block());
    const real = Math.round(block().route(A, B, 5000)!.meters);
    const { journeys, allStreetRouted } = refineWalkLegs([journey([walk(A, B, 200), ride(t0 + 600, t0 + 1200)])], t0);
    expect(allStreetRouted).toBe(true);
    const [first] = journeys[0].legs as [WalkLeg];
    expect(first).toMatchObject({ meters: real, streetRouted: true });
    expect(first.departure).toBeCloseTo(t0 + 600 - real / 1.25, 6);
    expect(first.path?.length).toBeGreaterThan(4);
  });

  it("gerçek yürüyüşle aktarmaya yetişilemeyen seçeneği eler", () => {
    // Aktarma için 1 dk var; sokaktan ≈ 300 m (4 dk) yürünmesi gerekiyor
    setWalkGraph(block());
    const tooTight = journey([ride(t0, t0 + 600), walk(A, B, 60), ride(t0 + 660, t0 + 1200)]);
    expect(refineWalkLegs([tooTight], t0).journeys).toEqual([]);
  });

  it("sokaktan yol bulunamazsa yürüyüş tahmin olarak kalır ve bildirilir", () => {
    setWalkGraph(block());
    const island = { name: "Ada", ...ll(nodes[4]) };
    const { journeys, allStreetRouted } = refineWalkLegs([journey([walk(A, island, 300), ride(t0 + 1800, t0 + 2400)])], t0);
    expect(allStreetRouted).toBe(false);
    expect(journeys[0].legs[0]).toMatchObject({ meters: 300 });
    expect((journeys[0].legs[0] as WalkLeg).path).toBeUndefined();
  });
});
