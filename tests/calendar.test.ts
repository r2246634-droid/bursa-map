import { describe, expect, it } from "vitest";

import { holidayName, neighbourSchedules, serviceClock } from "@/lib/routing/calendar";

describe("serviceClock — Türkiye saati ve uygulanan tarife", () => {
  it("UTC 05:30 Perşembe → İstanbul 08:30, Perşembe tarifesi", () => {
    expect(serviceClock(new Date("2026-10-08T05:30:00Z"))).toEqual({
      date: "2026-10-08",
      weekday: 4,
      schedule: 4,
      holiday: null,
      seconds: 30600,
    });
  });

  it("UTC'de Pazar gecesi, İstanbul'da Pazartesi olabilir (gün dönümü sunucu saat dilimine bağlı değil)", () => {
    const c = serviceClock(new Date("2026-10-11T22:30:00Z"));
    expect(c).toMatchObject({ date: "2026-10-12", weekday: 1, schedule: 1, seconds: 5400 });
  });

  it("Pazar günü 7 numaralı tarifeyi kullanır", () => {
    expect(serviceClock(new Date("2026-10-11T09:00:00Z")).schedule).toBe(7);
  });
});

describe("resmi tatillerde Pazar tarifesi", () => {
  it("29 Ekim 2026 Perşembe: Cumhuriyet Bayramı → tarife 7", () => {
    const c = serviceClock(new Date("2026-10-29T06:00:00Z"));
    expect(c).toMatchObject({ weekday: 4, schedule: 7, holiday: "Cumhuriyet Bayramı" });
  });

  it("dini bayramlar (2026 ve 2027)", () => {
    expect(holidayName("2026-05-28")).toBe("Kurban Bayramı");
    expect(holidayName("2027-05-17")).toBe("Kurban Bayramı");
    expect(holidayName("2027-03-09")).toBe("Ramazan Bayramı");
  });

  it("arife günleri ve sıradan günler tatil değildir", () => {
    expect(holidayName("2026-03-19")).toBeNull(); // Ramazan Bayramı arifesi (yarım gün)
    expect(holidayName("2026-05-26")).toBeNull(); // Kurban Bayramı arifesi
    expect(holidayName("2026-10-08")).toBeNull();
  });

  it("sabit tatiller her yıl aynı gün", () => {
    for (const year of [2026, 2027, 2030]) {
      expect(holidayName(`${year}-04-23`)).toBe("Ulusal Egemenlik ve Çocuk Bayramı");
      expect(holidayName(`${year}-08-30`)).toBe("Zafer Bayramı");
    }
  });
});

describe("neighbourSchedules — gece yarısını geçen seferler için komşu günler", () => {
  it("Pazartesi'nin öncesi Pazar (7), sonrası Salı (2)", () => {
    expect(neighbourSchedules(new Date("2026-10-12T09:00:00Z"))).toEqual({ previous: 7, next: 2 });
  });

  it("tatilden bir gün sonra: önceki gün tarifesi Pazar (7)", () => {
    // 30 Ekim 2026 Cuma; önceki gün 29 Ekim (Cumhuriyet Bayramı) → Pazar tarifesi
    expect(neighbourSchedules(new Date("2026-10-30T09:00:00Z")).previous).toBe(7);
  });
});
