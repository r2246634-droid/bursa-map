import { describe, expect, it } from "vitest";

import { formatFare, journeyFare, rideFare } from "@/lib/routing/fares";
import type { JourneyLeg, RideLeg, TransitKind } from "@/lib/routing/types";

const point = { name: "D", lat: 40.2, lon: 29 };
const ride = (line: string, kind: TransitKind, departureMin: number): RideLeg => ({
  type: "ride",
  line,
  kind,
  direction: "G",
  headsign: "Son durak",
  from: point,
  to: point,
  departure: 8 * 3600 + departureMin * 60,
  arrival: 8 * 3600 + departureMin * 60 + 600,
  stopCount: 3,
  path: [],
  estimated: true,
});
const walk: JourneyLeg = { type: "walk", from: point, to: point, meters: 300, departure: 0, arrival: 0 };

describe("BursaKart ücret tahmini", () => {
  it("türe ve hatta göre tam bilet", () => {
    expect(rideFare(ride("M1", "metro", 0))).toBe(50);
    expect(rideFare(ride("T1", "tram", 0))).toBe(40.75);
    expect(rideFare(ride("22C", "bus", 0))).toBe(47); // listede yok: kısa hat
    expect(rideFare(ride("801", "bus", 0))).toBe(275);
  });

  it("90 dakika içindeki aktarma indirimli", () => {
    expect(journeyFare([walk, ride("M1", "metro", 0), walk, ride("22C", "bus", 30)])).toBe(71.5);
  });

  it("ilk binişten 90 dakika sonraki biniş tam ücret", () => {
    expect(journeyFare([ride("22C", "bus", 0), ride("1A", "bus", 95)])).toBe(94);
  });

  it("en fazla 3 aktarma indirimli", () => {
    const legs = [0, 10, 20, 30, 40].map((m, i) => ride(`${i}A`, "bus", m));
    expect(journeyFare(legs)).toBe(47 + 3 * 21.5 + 47);
  });

  it("ilçeler arası pahalı hatta aktarma indirimi varsayılmaz; sadece yürüyüş ücretsiz", () => {
    expect(journeyFare([ride("M1", "metro", 0), ride("901", "bus", 20)])).toBe(275);
    expect(journeyFare([walk])).toBe(0);
    expect(formatFare(0)).toBe("Ücretsiz");
    expect(formatFare(68.5)).toBe("68,50 TL");
  });
});
