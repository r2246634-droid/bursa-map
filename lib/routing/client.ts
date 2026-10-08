"use client";

import { useEffect, useState } from "react";

import { LINE_COLORS } from "@/data/transit-network";
import type { Place } from "@/data/types";
import { BUS_LINE_COLOR } from "@/lib/burulas";

import type { RideLeg, RouteErrorResponse, RouteResponse } from "./types";

export type JourneysState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; data: RouteResponse }
  | { status: "error"; message: string };

const IDLE: JourneysState = { status: "idle" };
const LOADING: JourneysState = { status: "loading" };

/**
 * İstek adresi aynı zamanda sonucun anahtarı: uç noktalar veya kalkış saati değişince eski sonuç
 * gösterilmez. departAt: <input type="datetime-local"> değeri ("2026-10-08T08:30"), null = şimdi.
 * Türkiye'de yaz saati uygulaması olmadığından saat dilimi sabit +03:00'tır.
 */
export function journeysUrl(from: Place | null, to: Place | null, departAt: string | null = null): string | null {
  if (!from || !to) return null;
  const params = new URLSearchParams({
    from: from.position.join(","),
    to: to.position.join(","),
    fromName: from.name,
    toName: to.name,
  });
  if (departAt) params.set("at", `${departAt}:00+03:00`);
  return `/api/route?${params}`;
}

/** Nereden/Nereye seçilince yol tarifini sunucudan (RAPTOR) ister */
export function useJourneys(from: Place | null, to: Place | null, departAt: string | null = null): JourneysState {
  const url = journeysUrl(from, to, departAt);
  const [entry, setEntry] = useState<{ url: string; state: JourneysState } | null>(null);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (res) => {
        const body = (await res.json()) as RouteResponse | RouteErrorResponse;
        if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
        setEntry({ url, state: { status: "done", data: body } });
      })
      .catch((error: unknown) => {
        if ((error as Error).name === "AbortError") return;
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setEntry({
          url,
          state: {
            status: "error",
            message: offline ? "Yol tarifi için internet bağlantısı gerekiyor." : "Yol tarifi alınamadı.",
          },
        });
      });
    return () => controller.abort();
  }, [url]);

  if (!url) return IDLE;
  return entry?.url === url ? entry.state : LOADING;
}

/* ---- Görünüm yardımcıları ---- */

/** BURULAŞ metro kodları (M1/M2) uygulamadaki metro hatlarına (B1/B2) karşılık gelir */
const RAIL_ALIAS: Record<string, string> = { M1: "B1", M2: "B2" };

export function rideColor(leg: Pick<RideLeg, "kind" | "line">): string {
  if (leg.kind === "bus") return BUS_LINE_COLOR;
  return LINE_COLORS[RAIL_ALIAS[leg.line] ?? leg.line] ?? BUS_LINE_COLOR;
}

/** Ekranda gösterilecek hat adı: metro "M1" yerine haritadaki "B1" */
export const rideLabel = (leg: Pick<RideLeg, "line">) => RAIL_ALIAS[leg.line] ?? leg.line;

/** 95 → "1 sa 35 dk", 12 → "12 dk" */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} dk`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} sa ${m} dk` : `${h} sa`;
}
