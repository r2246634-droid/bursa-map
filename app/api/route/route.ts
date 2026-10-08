import { NextResponse, type NextRequest } from "next/server";

import { BURSA_BOUNDS } from "@/lib/map-config";
import { planJourneys } from "@/lib/routing/raptor";
import { istanbulClock } from "@/lib/routing/time";
import type { RouteErrorResponse, RoutePoint, RouteResponse } from "@/lib/routing/types";

/**
 * Toplu taşıma yol tarifi.
 *
 *   GET /api/route?from=40.2123,29.0145&to=40.2659,29.0532[&fromName=…&toName=…][&at=2026-10-08T08:30:00+03:00]
 *
 * `at` verilmezse şimdiki zaman (Türkiye saati) kullanılır. Ağ (graf) ilk istekte kurulur
 * ve sunucu süreci boyunca bellekte kalır; sonraki istekler sadece RAPTOR aramasıdır.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const [west, south, east, north] = BURSA_BOUNDS;

function parsePoint(value: string | null, name: string | null, fallbackName: string): RoutePoint | null {
  const match = value?.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const [lat, lon] = [Number(match[1]), Number(match[2])];
  if (lat < south || lat > north || lon < west || lon > east) return null;
  return { lat, lon, name: name?.trim().slice(0, 120) || fallbackName };
}

function error(message: string, status: number) {
  return NextResponse.json<RouteErrorResponse>({ error: message }, { status });
}

export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const from = parsePoint(params.get("from"), params.get("fromName"), "Başlangıç");
  const to = parsePoint(params.get("to"), params.get("toName"), "Varış");
  if (!from || !to) {
    return error("from ve to parametreleri Bursa sınırı içinde 'enlem,boylam' olmalı", 400);
  }

  const at = params.get("at");
  const date = at ? new Date(at) : new Date();
  if (Number.isNaN(date.getTime())) return error("at parametresi geçerli bir tarih/saat değil", 400);
  const { day, seconds } = istanbulClock(date);

  const started = performance.now();
  const journeys = planJourneys({ from, to, day, time: seconds });
  const elapsedMs = Math.round(performance.now() - started);

  const notes = [
    "Varış saatleri ilk duraktan kalkış saatine göre tahmin edilmiştir (otobüs 20, tramvay 16, metro 35 km/s ortalama).",
  ];
  if (journeys.length === 0) {
    notes.push("Bu saatte uygun sefer bulunamadı. Gece saatlerinde sefer olmayabilir; başka bir saat deneyin.");
  }

  return NextResponse.json<RouteResponse>(
    { journeys, serviceDay: day, queryTime: seconds, notes },
    { headers: { "Cache-Control": "no-store", "Server-Timing": `raptor;dur=${elapsedMs}` } },
  );
}
