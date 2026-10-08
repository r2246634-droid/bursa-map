import { describe, expect, it } from "vitest";

import {
  estimateStopOffsets,
  formatClock,
  haversineMeters,
  interpolateStopTimes,
  parseClock,
} from "@/lib/routing/time";

describe("saat dönüşümleri", () => {
  it("parseClock: 'SS:DD' ve 'SS:DD:ss' → gece yarısından saniye", () => {
    expect(parseClock("00:00")).toBe(0);
    expect(parseClock("08:30")).toBe(30600);
    expect(parseClock("23:59:30")).toBe(86370);
  });

  it("formatClock: dakikaya yuvarlar ve 24 saat içine katlar", () => {
    expect(formatClock(30600)).toBe("08:30");
    expect(formatClock(30629)).toBe("08:30");
    expect(formatClock(30631)).toBe("08:31");
    expect(formatClock(86400 + 600)).toBe("00:10"); // gece yarısını geçen sefer
    expect(formatClock(-60)).toBe("23:59");
  });

  it("parseClock ↔ formatClock gidiş-dönüş tutarlı", () => {
    for (const t of ["00:00", "06:05", "12:00", "19:41", "23:59"]) expect(formatClock(parseClock(t))).toBe(t);
  });
});

describe("haversineMeters", () => {
  it("1 derece enlem ≈ 111,2 km", () => {
    expect(haversineMeters({ lat: 40, lon: 29 }, { lat: 41, lon: 29 })).toBeCloseTo(111_195, -2);
  });

  it("aynı nokta için 0, yön fark etmez", () => {
    const a = { lat: 40.2123, lon: 29.0145 };
    const b = { lat: 40.2659, lon: 29.0532 };
    expect(haversineMeters(a, a)).toBe(0);
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe("ara durak varış tahmini (estimateStopOffsets / interpolateStopTimes)", () => {
  // Kuzeye doğru 0, ~400 m, ~900 m'deki duraklar (0,0036° ≈ 400 m enlem)
  const metersToDegLat = (m: number) => m / 111_195;
  const stops = [0, 400, 900].map((m) => ({ lat: 40 + metersToDegLat(m), lon: 29 }));

  it("20 km/s ile: 400 m → 72 sn, 900 m → 162 sn", () => {
    const offsets = estimateStopOffsets(stops, { speedKmh: 20 });
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeCloseTo(72, 0);
    expect(offsets[2]).toBeCloseTo(162, 0);
  });

  it("yol katsayısı süreleri orantılı uzatır", () => {
    const plain = estimateStopOffsets(stops, { speedKmh: 20 });
    const winding = estimateStopOffsets(stops, { speedKmh: 20, roadFactor: 1.2 });
    expect(winding[2]).toBeCloseTo(plain[2] * 1.2, 6);
  });

  it("süreler artan sırada ve hızlı araçta daha kısa", () => {
    const bus = estimateStopOffsets(stops, { speedKmh: 20 });
    const metro = estimateStopOffsets(stops, { speedKmh: 35 });
    expect(bus[1]).toBeLessThan(bus[2]);
    expect(metro[2]).toBeLessThan(bus[2]);
  });

  it("kalkış saatine eklenerek her durağın saatini verir (08:00 → 08:00, 08:01, 08:03)", () => {
    const offsets = estimateStopOffsets(stops, { speedKmh: 20 });
    const times = interpolateStopTimes(parseClock("08:00"), offsets);
    expect(times.map(formatClock)).toEqual(["08:00", "08:01", "08:03"]);
  });

  it("tek duraklı desende sadece kalkış saati döner", () => {
    expect(estimateStopOffsets([{ lat: 40, lon: 29 }], { speedKmh: 20 })).toEqual([0]);
  });
});
