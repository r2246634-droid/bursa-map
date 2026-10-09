import { afterEach, describe, expect, it, vi } from "vitest";

import type { Journey, RideLeg, WalkLeg } from "@/lib/routing/types";

/**
 * Sokak ağı yürüyüşü (lib/routing/walking.ts + refine.ts). OSRM cevapları taklit edilir;
 * modüller servis adresini çağrı anında okuduğundan her test kendi WALK_ROUTER_URL'ini kurar.
 */
const A = { lat: 40.2123, lon: 29.0145, name: "A" };
const B = { lat: 40.2118, lon: 29.0128, name: "B" };

function stubOsrm(handler: (url: URL) => unknown) {
  vi.stubEnv("WALK_ROUTER_URL", "https://osrm.test/foot");
  const fetchMock = vi.fn(async (input: string | URL) => {
    const body = handler(new URL(String(input)));
    return body === undefined ? new Response("hata", { status: 500 }) : Response.json(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function fresh() {
  vi.resetModules(); // walkPath önbelleği testler arasında taşınmasın
  return { walking: await import("@/lib/routing/walking"), refine: await import("@/lib/routing/refine") };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("walkDistances (OSRM table)", () => {
  it("sokak mesafesine yola yapıştırma mesafelerini ekler", async () => {
    stubOsrm(() => ({
      code: "Ok",
      distances: [[130, 1448]],
      sources: [{ distance: 12 }],
      destinations: [{ distance: 8 }, { distance: 20 }],
    }));
    const { walking } = await fresh();
    expect(await walking.walkDistances(A, [B, B])).toEqual([130 + 12 + 8, 1448 + 12 + 20]);
  });

  it("reverse: duraklardan noktaya (varış yürüyüşü) ve yol bulunamayan hedef null", async () => {
    const fetchMock = stubOsrm(() => ({
      code: "Ok",
      distances: [[300], [null]],
      sources: [{ distance: 5 }, { distance: 5 }],
      destinations: [{ distance: 10 }],
    }));
    const { walking } = await fresh();
    expect(await walking.walkDistances(A, [B, B], { reverse: true })).toEqual([315, null]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("sources=1;2&destinations=0");
  });

  it("servis hata verirse null (çağıran kuş uçuşu tahmine döner)", async () => {
    stubOsrm(() => undefined);
    const { walking } = await fresh();
    expect(await walking.walkDistances(A, [B])).toBeNull();
  });

  it("WALK_ROUTER_URL=off iken hiç istek atılmaz", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("WALK_ROUTER_URL", "off");
    const { walking } = await fresh();
    expect(await walking.walkDistances(A, [B])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("walkPath (OSRM route)", () => {
  it("sokak güzergâhını uç noktalarla birlikte ve yapıştırma mesafeleri dahil döner; önbelleğe alır", async () => {
    const fetchMock = stubOsrm(() => ({
      code: "Ok",
      routes: [{ distance: 130, geometry: { coordinates: [[29.0144, 40.2122], [29.013, 40.212]] } }],
      waypoints: [{ distance: 10 }, { distance: 16 }],
    }));
    const { walking } = await fresh();
    const result = await walking.walkPath(A, B);
    expect(result).toEqual({
      meters: 156,
      path: [[A.lon, A.lat], [29.0144, 40.2122], [29.013, 40.212], [B.lon, B.lat]],
    });
    await walking.walkPath(A, B);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("yürüme bacağına sokak güzergâhı ekler ve çıkış saatini gerçek mesafeye göre öne alır", async () => {
    stubOsrm(() => ({
      code: "Ok",
      routes: [{ distance: 600, geometry: { coordinates: [[29.014, 40.212]] } }],
      waypoints: [{ distance: 0 }, { distance: 0 }],
    }));
    const { refine } = await fresh();
    const t0 = 8 * 3600;
    // Tahmin 300 m'ydi; sokaktan 600 m çıkıyor → 8 dk erken çıkmak gerekir (1,25 m/sn)
    const { journeys, allStreetRouted } = await refine.refineWalkLegs(
      [journey([walk(A, B, 300), ride(t0 + 600, t0 + 1200)])],
      t0,
    );
    expect(allStreetRouted).toBe(true);
    const [first] = journeys[0].legs as [WalkLeg];
    expect(first).toMatchObject({ meters: 600, streetRouted: true, departure: t0 + 600 - 480 });
    expect(first.path?.length).toBeGreaterThan(2);
  });

  it("gerçek yürüyüşle aktarmaya yetişilemeyen seçeneği eler", async () => {
    stubOsrm(() => ({
      code: "Ok",
      routes: [{ distance: 900, geometry: { coordinates: [] } }], // 12 dk yürüme
      waypoints: [{ distance: 0 }, { distance: 0 }],
    }));
    const { refine } = await fresh();
    const t0 = 8 * 3600;
    const tooTight = journey([ride(t0, t0 + 600), walk(A, B, 200), ride(t0 + 900, t0 + 1500)]); // 5 dk aktarma
    const { journeys } = await refine.refineWalkLegs([tooTight], t0);
    expect(journeys).toEqual([]);
  });

  it("servis yanıt vermezse yürüyüş tahmin olarak kalır ve bildirilir", async () => {
    stubOsrm(() => undefined);
    const { refine } = await fresh();
    const t0 = 8 * 3600;
    const { journeys, allStreetRouted } = await refine.refineWalkLegs(
      [journey([walk(A, B, 300), ride(t0 + 600, t0 + 1200)])],
      t0,
    );
    expect(allStreetRouted).toBe(false);
    expect(journeys[0].legs[0]).toMatchObject({ meters: 300 });
    expect((journeys[0].legs[0] as WalkLeg).path).toBeUndefined();
  });
});
