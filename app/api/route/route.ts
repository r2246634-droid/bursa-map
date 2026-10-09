import { NextResponse, type NextRequest } from "next/server";

import { BURSA_BOUNDS } from "@/lib/map-config";
import { HOLIDAYS_KNOWN_UNTIL, neighbourSchedules, serviceClock } from "@/lib/routing/calendar";
import { getNetwork } from "@/lib/routing/network";
import { planWithStreetWalking } from "@/lib/routing/refine";
import type { RouteErrorResponse, RoutePoint, RouteResponse } from "@/lib/routing/types";

/**
 * Toplu taşıma yol tarifi.
 *
 *   GET /api/route?from=40.2123,29.0145&to=40.2659,29.0532[&fromName=…&toName=…][&at=2026-10-08T08:30:00+03:00]
 *
 * `at` verilmezse şimdiki zaman (Türkiye saati) kullanılır. Resmi tatillerde Pazar tarifesi uygulanır. Toplu taşıma ağı ve yaya yolu
 * ağı ilk istekte kurulur ve sunucu süreci boyunca bellekte kalır.
 */
export const runtime = "nodejs";
/** Frankfurt: Türkiye'deki kullanıcılara en yakın bölge */
export const preferredRegion = "fra1";
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
  const clock = serviceClock(date);
  const { previous, next } = neighbourSchedules(date);

  // Sokak ağıyla yürüme + RAPTOR (bkz. lib/routing/refine.ts → planWithStreetWalking)
  const started = performance.now();
  const { journeys, allStreetRouted, streetAccess } = planWithStreetWalking(getNetwork(), {
    from,
    to,
    day: clock.schedule,
    time: clock.seconds,
    previousDay: previous,
    nextDay: next,
  });
  const elapsedMs = Math.round(performance.now() - started);

  const notes = [
    "Varış saatleri ilk duraktan kalkış saatine göre tahmin edilmiştir (otobüs 20, tramvay 16, metro 35 km/s ortalama).",
  ];
  if (!streetAccess || !allStreetRouted) {
    notes.push("Yürüme mesafelerinin bir kısmı yaya yolu ağının dışında kaldığı için kuş uçuşu tahmindir.");
  }
  if (clock.holiday) notes.push(`${clock.holiday}: resmi tatil olduğu için Pazar tarifesi uygulandı.`);
  if (Number(clock.date.slice(0, 4)) > HOLIDAYS_KNOWN_UNTIL) {
    notes.push("Bu yılın dini bayram tarihleri takvimde tanımlı değil; bayram günlerinde saatler farklı olabilir.");
  }
  if (journeys.length === 0) {
    notes.push("Bu saatte uygun sefer bulunamadı. Gece saatlerinde sefer olmayabilir; başka bir saat deneyin.");
  }

  return NextResponse.json<RouteResponse>(
    { journeys, serviceDay: clock.schedule, queryTime: clock.seconds, notes },
    { headers: { "Cache-Control": "no-store", "Server-Timing": `plan;dur=${elapsedMs}` } },
  );
}
