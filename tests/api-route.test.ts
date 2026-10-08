import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/route/route";
import type { RouteErrorResponse, RouteResponse } from "@/lib/routing/types";

/** Gerçek veri seti (BURULAŞ) ile, sunucu başlatmadan handler'ı doğrudan çağırır */
async function call(params: Record<string, string>) {
  const url = new URL("http://localhost/api/route");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = GET(new NextRequest(url));
  return { status: res.status, body: (await res.json()) as RouteResponse & RouteErrorResponse };
}

const ACEMLER = "40.212291,29.014518";
const OTOGAR = "40.26586,29.053166";

describe("GET /api/route — girdi doğrulama", () => {
  it("from/to eksik veya bozuksa 400", async () => {
    expect((await call({ to: OTOGAR })).status).toBe(400);
    expect((await call({ from: "abc", to: OTOGAR })).status).toBe(400);
  });

  it("Bursa sınırı dışındaki koordinat 400", async () => {
    const { status, body } = await call({ from: "41.0082,28.9784", to: OTOGAR }); // İstanbul
    expect(status).toBe(400);
    expect(body.error).toMatch(/Bursa/);
  });

  it("geçersiz tarih 400", async () => {
    expect((await call({ from: ACEMLER, to: OTOGAR, at: "dün" })).status).toBe(400);
  });
});

describe("GET /api/route — gerçek ağ", () => {
  it("Acemler → Otogar (Perşembe 08:30): aktarmasız ve aktarmalı seçenekler", async () => {
    const { status, body } = await call({ from: ACEMLER, to: OTOGAR, at: "2026-10-08T08:30:00+03:00" });
    expect(status).toBe(200);
    expect(body.serviceDay).toBe(4);
    expect(body.journeys.length).toBeGreaterThanOrEqual(2);
    expect(body.journeys.some((j) => j.transfers === 0)).toBe(true);
    expect(body.journeys.some((j) => j.tags.includes("En erken varış"))).toBe(true);

    for (const j of body.journeys) {
      // Bacaklar zamanda geriye gitmez; çıkış istenen saatten önce olamaz
      expect(j.departure).toBeGreaterThanOrEqual(30600);
      j.legs.forEach((leg, i) => {
        expect(leg.arrival).toBeGreaterThanOrEqual(leg.departure);
        if (i > 0) expect(leg.departure).toBeGreaterThanOrEqual(j.legs[i - 1].arrival - 1);
      });
    }
  }, 20_000);

  it("29 Ekim (resmi tatil): Pazar tarifesi uygulanır ve not düşülür", async () => {
    const { body } = await call({ from: ACEMLER, to: OTOGAR, at: "2026-10-29T10:00:00+03:00" });
    expect(body.serviceDay).toBe(7);
    expect(body.notes.join(" ")).toMatch(/Cumhuriyet Bayramı/);
  });
});
