import { describe, expect, it } from "vitest";

import type { Network, Pattern, Stop } from "@/lib/routing/network";
import { planJourneys, type RouteQuery } from "@/lib/routing/raptor";
import { haversineMeters, parseClock } from "@/lib/routing/time";
import type { RideLeg } from "@/lib/routing/types";

/**
 * Sonucu elle hesaplanabilen küçük bir ağ: doğu-batı doğrultusunda 4 durak, aralar ~1 km.
 *
 *   S0 ──A──▶ S1 ──A──▶ S2 ──B──▶ S3
 *   S0 ─────────────C (yavaş, direkt)──────────▶ S3
 */
const STEP = 0.012; // boylam ≈ 1.020 m (enlem 40°)
const stops: Stop[] = [0, 1, 2, 3].map((i) => ({ id: 100 + i, name: `S${i}`, lat: 40, lon: 29 + i * STEP }));

const pattern = (line: string, stopIdx: number[], offsets: number[], departures: Record<number, string[]>): Pattern => ({
  line,
  kind: "bus",
  direction: "G",
  headsign: stops[stopIdx.at(-1)!].name,
  stops: stopIdx,
  offsets,
  departures: Object.fromEntries(Object.entries(departures).map(([d, list]) => [Number(d), list.map(parseClock)])),
});

function makeNetwork(patterns: Pattern[]): Network {
  const stopPatterns: Network["stopPatterns"] = stops.map(() => []);
  patterns.forEach((p, pi) => p.stops.forEach((s, position) => stopPatterns[s].push({ pattern: pi, position })));
  return {
    stops,
    patterns,
    stopPatterns,
    footpaths: stops.map(() => []),
    nearbyStops: (lat, lon, radius) =>
      stops
        .map((s, stop) => ({ stop, meters: haversineMeters({ lat, lon }, s) }))
        .filter((x) => x.meters <= radius)
        .sort((a, b) => a.meters - b.meters),
  };
}

const at = (i: number) => ({ name: `S${i}`, lat: stops[i].lat, lon: stops[i].lon });
const THURSDAY = 4;
const query = (fromStop: number, toStop: number, time: string, extra: Partial<RouteQuery> = {}): RouteQuery => ({
  from: at(fromStop),
  to: at(toStop),
  day: THURSDAY,
  time: parseClock(time),
  ...extra,
});
const rides = (legs: { type: string }[]) => legs.filter((l): l is RideLeg => l.type === "ride").map((l) => l.line);

describe("RAPTOR — temel yolculuklar", () => {
  const A = pattern("A", [0, 1, 2], [0, 300, 600], { [THURSDAY]: ["08:00", "08:30"] });
  const B = pattern("B", [2, 3], [0, 300], { [THURSDAY]: ["08:15", "08:50"] });
  const C = pattern("C", [0, 3], [0, 2400], { [THURSDAY]: ["08:05"] });
  const net = makeNetwork([A, B, C]);

  it("Pareto seçenekleri: aktarmalı hızlı (A→B) ve aktarmasız yavaş (C) birlikte döner", () => {
    const journeys = planJourneys(query(0, 3, "07:55"), net);
    expect(journeys.map((j) => ({ rides: rides(j.legs), transfers: j.transfers }))).toEqual([
      { rides: ["A", "B"], transfers: 1 },
      { rides: ["C"], transfers: 0 },
    ]);
    expect(journeys[0].tags).toContain("En hızlı");
    // Tek biniş (47 TL) aktarmalıdan (47 + 21,50 TL) ucuz
    expect(journeys[1].tags).toEqual(expect.arrayContaining(["En az aktarma", "En ucuz"]));
    expect(journeys.map((j) => j.fare)).toEqual([68.5, 47]);
  });

  it("alternatifler: başka hatla giden, en iyi olmayan seçenek de listelenir", () => {
    // D, C ile aynı yerden aynı yere ama daha geç varıyor: tek RAPTOR aramasında çıkmaz,
    // C yasaklanınca bulunur
    const D = pattern("D", [0, 3], [0, 2700], { [THURSDAY]: ["08:10"] });
    const journeys = planJourneys(query(0, 3, "07:55"), makeNetwork([A, B, C, D]));
    expect(journeys.map((j) => rides(j.legs).join(">"))).toEqual(["A>B", "C", "D"]);
    expect(journeys[2].tags).toEqual([]);
  });

  it("varış saatleri kalkış + durak süresinden hesaplanır (A 08:00 + 10 dk, B 08:15 + 5 dk)", () => {
    const [fastest] = planJourneys(query(0, 3, "07:55"), net);
    const [a, b] = fastest.legs.filter((l): l is RideLeg => l.type === "ride");
    expect([a.departure, a.arrival]).toEqual([parseClock("08:00"), parseClock("08:10")]);
    expect([b.departure, b.arrival]).toEqual([parseClock("08:15"), parseClock("08:20")]);
    expect(fastest.arrival).toBe(parseClock("08:20"));
  });

  it("kalkış saatinden önce kalkmış sefere binilmez", () => {
    // 08:01'de çıkan kişi A'nın 08:00 seferini kaçırır, C (08:05) direkt seçenek kalır
    const journeys = planJourneys(query(0, 3, "08:01"), net);
    expect(journeys[0].legs.find((l) => l.type === "ride")).toMatchObject({ line: "C" });
  });

  it("o saatten sonra sefer yoksa sonuç boş", () => {
    expect(planJourneys(query(0, 3, "09:00"), net)).toEqual([]);
  });
});

describe("RAPTOR — aktarma payı (3 dk)", () => {
  it("inişten 2 dk sonra kalkan sefere aktarma yapılmaz", () => {
    const A = pattern("A", [0, 1, 2], [0, 300, 600], { [THURSDAY]: ["08:00"] }); // S2'ye 08:10
    const B = pattern("B", [2, 3], [0, 300], { [THURSDAY]: ["08:12", "08:40"] });
    const journeys = planJourneys(query(0, 3, "07:55"), makeNetwork([A, B]));
    const b = journeys[0].legs.filter((l): l is RideLeg => l.type === "ride")[1];
    expect(b.departure).toBe(parseClock("08:40")); // 08:12 kaçırıldı (08:10 + 3 dk > 08:12)
  });
});

describe("RAPTOR — gün sınırları", () => {
  it("gece yarısını geçen önceki gün seferi yakalanır (Çarşamba 23:50 kalkış, Perşembe 00:05 arama)", () => {
    const N = pattern("N", [0, 1, 3], [0, 900, 1800], { 3: ["23:50"] });
    const journeys = planJourneys(query(1, 3, "00:04", { previousDay: 3 }), makeNetwork([N]));
    const ride = journeys[0].legs.find((l): l is RideLeg => l.type === "ride")!;
    expect(ride.line).toBe("N");
    expect(ride.departure).toBe(parseClock("00:05")); // 23:50 + 15 dk
    expect(ride.arrival).toBe(parseClock("00:20"));
  });

  it("akşam aramasında ertesi günün sabah seferi önerilir", () => {
    const M = pattern("M", [0, 3], [0, 1200], { [THURSDAY]: ["07:00"], 5: ["05:30"] });
    const journeys = planJourneys(query(0, 3, "23:30", { nextDay: 5 }), makeNetwork([M]));
    const ride = journeys[0].legs.find((l): l is RideLeg => l.type === "ride")!;
    expect(ride.departure).toBe(parseClock("05:30") + 86_400);
  });

  it("tarife günü değiştirilince (ör. tatilde Pazar) o günün seferleri kullanılır", () => {
    const S = pattern("S", [0, 3], [0, 1200], { [THURSDAY]: ["08:00"], 7: ["10:00"] });
    const net = makeNetwork([S]);
    const weekday = planJourneys(query(0, 3, "07:30"), net);
    expect(weekday[0].legs.find((l) => l.type === "ride")).toMatchObject({ departure: parseClock("08:00") });
    const holiday = planJourneys(query(0, 3, "07:30", { day: 7 }), net);
    expect(holiday[0].legs.find((l) => l.type === "ride")).toMatchObject({ departure: parseClock("10:00") });
  });
});

describe("RAPTOR — yürüme", () => {
  it("yakın hedefe yürüyerek seçeneği sunulur", () => {
    const net = makeNetwork([]);
    const near = { name: "Yakın", lat: 40, lon: 29.004 }; // ~340 m
    const journeys = planJourneys({ from: at(0), to: near, day: THURSDAY, time: parseClock("08:00") }, net);
    expect(journeys).toHaveLength(1);
    expect(journeys[0].tags).toContain("Yürüyerek");
    expect(journeys[0].legs).toEqual([expect.objectContaining({ type: "walk" })]);
  });
});
