import { afterEach, describe, expect, it } from "vitest";

import type { Network, Pattern, Stop } from "@/lib/routing/network";
import { planWithStreetWalking } from "@/lib/routing/refine";
import { haversineMeters, parseClock } from "@/lib/routing/time";
import type { RideLeg, WalkLeg } from "@/lib/routing/types";
import { setWalkGraph } from "@/lib/routing/walk-graph";

import { graphOf } from "./walk-graph-fixture";

/**
 * planWithStreetWalking: durak seçimi kuş uçuşuna değil sokaktan yürüme mesafesine göre yapılır.
 *
 *   S0 ──A──▶ S2  (varışa kuş uçuşu ~300 m, ama arada dere: köprü 1 km kuzeyde → ~2.300 m)
 *   S0 ──C──▶ S3  (varışa ~550 m, düz sokak)
 */
const stops: Stop[] = [
  { id: 1, name: "S0", lat: 40, lon: 29 },
  { id: 2, name: "S2", lat: 40, lon: 29.03 },
  { id: 3, name: "S3", lat: 40, lon: 29.04 },
];
const DEST = { name: "Varış", lat: 40, lon: 29.0335 };
const ORIGIN = { name: "S0", lat: 40, lon: 29 };

//            n2 ═köprü═ n3
//            ║          ║
// n0 ─────── n1  (dere)  n4 ── n5
const streets = () =>
  graphOf(
    [[29, 40], [29.03, 40], [29.03, 40.009], [29.0335, 40.009], [29.0335, 40], [29.04, 40]],
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]],
  );

const pattern = (line: string, s: number[], offsets: number[]): Pattern => ({
  line,
  kind: "bus",
  direction: "G",
  headsign: stops[s.at(-1)!].name,
  stops: s,
  offsets,
  departures: { 4: [parseClock("08:00")] },
});

function network(): Network {
  const patterns = [pattern("A", [0, 1], [0, 600]), pattern("C", [0, 2], [0, 900])];
  const stopPatterns: Network["stopPatterns"] = stops.map(() => []);
  patterns.forEach((p, pi) => p.stops.forEach((st, position) => stopPatterns[st].push({ pattern: pi, position })));
  return {
    stops,
    patterns,
    stopPatterns,
    footpaths: stops.map(() => []),
    nearbyStops: (lat, lon, radius) =>
      stops
        .map((st, stop) => ({ stop, meters: haversineMeters({ lat, lon }, st) }))
        .filter((x) => x.meters <= radius)
        .sort((a, b) => a.meters - b.meters),
  };
}

const query = { from: ORIGIN, to: DEST, day: 4, time: parseClock("07:55") };
const rideLine = (legs: { type: string }[]) => (legs.find((l) => l.type === "ride") as RideLeg | undefined)?.line;

afterEach(() => setWalkGraph(undefined));

describe("planWithStreetWalking", () => {
  it("kuş uçuşu yakın ama sokaktan uzak durağı bırakır, gerçekten yakın olanı seçer", () => {
    setWalkGraph(streets());
    const plan = planWithStreetWalking(network(), query);
    expect(plan.streetAccess).toBe(true);
    expect(plan.allStreetRouted).toBe(true);
    const [journey] = plan.journeys;
    expect(rideLine(journey.legs)).toBe("C");
    const last = journey.legs.at(-1) as WalkLeg;
    expect(last).toMatchObject({ type: "walk", streetRouted: true });
    expect(last.meters).toBeCloseTo(haversineMeters(stops[2], DEST), -1);
  });

  it("yaya ağı yoksa kuş uçuşu tahminle arar ve bunu bildirir", () => {
    setWalkGraph(null);
    const plan = planWithStreetWalking(network(), query);
    expect(plan.streetAccess).toBe(false);
    expect(rideLine(plan.journeys[0].legs)).toBe("A");
  });
});
