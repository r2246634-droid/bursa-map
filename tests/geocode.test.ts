import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeAddressQuery, placeFromPhoton } from "@/lib/geocode";
import { BURSA_BOUNDS } from "@/lib/map-config";

/**
 * Adres arama istemcisi (Photon): kısaltma açma, sonucu yere çevirme, istek parametreleri,
 * tekrar ayıklama ve önbellek. Modül uç noktayı yüklenirken okuduğu için yeniden içe aktarılır.
 */
async function load(endpoint?: string) {
  vi.resetModules();
  if (endpoint) vi.stubEnv("NEXT_PUBLIC_GEOCODE_URL", endpoint);
  return import("@/lib/geocode");
}

const street = (name: string, district: string, lon = 29.1085, lat = 40.1866, osm_id = 1) => ({
  geometry: { coordinates: [lon, lat] as [number, number] },
  properties: { osm_type: "W", osm_id, osm_key: "highway", type: "street", name, district, city: "Yıldırım" },
});

describe("normalizeAddressQuery — Türkçe adres kısaltmaları", () => {
  it("sok./cad./mah./bulv. açılır, 'no' kapı numarasından atılır", () => {
    expect(normalizeAddressQuery("1. esen sok. no 17 yıldırım")).toBe("1. esen sokak 17 yıldırım");
    expect(normalizeAddressQuery("Mimar Sinan Cd. No:10")).toBe("Mimar Sinan caddesi 10");
    expect(normalizeAddressQuery("esentepe mh. 5. sk.")).toBe("esentepe mahallesi 5. sokak");
    expect(normalizeAddressQuery("Fevzi Çakmak Blv no.3")).toBe("Fevzi Çakmak bulvarı 3");
  });

  it("kelimelerin içindeki benzer harflere dokunmaz", () => {
    expect(normalizeAddressQuery("Mahmut Sokullu nolu")).toBe("Mahmut Sokullu nolu");
  });
});

describe("placeFromPhoton", () => {
  it("sokak sonucu: ad sokak, alt satır tür + mahalle, ilçe; konum [enlem, boylam]", () => {
    expect(placeFromPhoton(street("1. Esen Sokak", "152 Evler"))).toEqual({
      kind: "feature",
      id: "address-W1",
      name: "1. Esen Sokak",
      position: [40.1866, 29.1085],
      category: "Cadde / sokak · 152 Evler, Yıldırım",
    });
  });

  it("adsız bina: sokak + kapı numarası ad olur", () => {
    const place = placeFromPhoton({
      geometry: { coordinates: [29.1, 40.2] },
      properties: { type: "house", osm_key: "building", street: "Ulus Sokağı", housenumber: "17", district: "Ulus" },
    });
    expect(place).toMatchObject({ name: "Ulus Sokağı No:17", category: "Adres · Ulus" });
  });

  it("adı olan yer: tür Türkçe kategori, sokak alt satıra", () => {
    const place = placeFromPhoton({
      geometry: { coordinates: [29.1, 40.2] },
      properties: { type: "house", osm_key: "amenity", osm_value: "hospital", name: "X Hastanesi", street: "Y Cd.", city: "Nilüfer" },
    });
    expect(place).toMatchObject({ name: "X Hastanesi", category: "Hastane · Y Cd., Nilüfer" });
  });

  it("adı ve sokağı olmayan sonuç atlanır", () => {
    expect(placeFromPhoton({ geometry: { coordinates: [29, 40] }, properties: { type: "house" } })).toBeNull();
  });
});

describe("searchAddresses", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const respond = (features: unknown[]) =>
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ features }), { status: 200 }));

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Photon'a Bursa merkez önceliği ve Bursa sınır kutusuyla, kısaltmaları açılmış sorgu gönderir", async () => {
    respond([]);
    const { searchAddresses } = await load();
    await searchAddresses("1. esen sok. no 17 yıldırım");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://photon.komoot.io/api/");
    expect(url.searchParams.get("q")).toBe("1. esen sokak 17 yıldırım");
    expect(url.searchParams.get("lat")).toBe("40.1885");
    expect(url.searchParams.get("lon")).toBe("29.0610");
    expect(url.searchParams.get("bbox")).toBe(BURSA_BOUNDS.join(","));
  });

  it("uç nokta ortam değişkeniyle değişir", async () => {
    respond([]);
    const { searchAddresses } = await load("https://photon.example.com/api?key=K");
    await searchAddresses("kent");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.host).toBe("photon.example.com");
    expect(url.searchParams.get("key")).toBe("K");
  });

  it("aynı caddenin parçalarını tek sonuca indirir, en fazla 3 sonuç döndürür", async () => {
    respond([
      street("Mimar Sinan Caddesi", "Mimar Sinan", 29.12, 40.18, 1),
      street("Mimar Sinan Caddesi", "Mimar Sinan", 29.13, 40.19, 2),
      street("A Sokak", "X", 29, 40, 3),
      street("B Sokak", "X", 29, 40, 4),
      street("C Sokak", "X", 29, 40, 5),
    ]);
    const { searchAddresses } = await load();
    const places = await searchAddresses("mimar sinan");
    expect(places.map((p) => p.name)).toEqual(["Mimar Sinan Caddesi", "A Sokak", "B Sokak"]);
  });

  it("sonuçlar önbelleğe alınır: aynı sorgu (büyük/küçük harf farkıyla) tekrar istek atmaz", async () => {
    respond([street("1. Esen Sokak", "152 Evler")]);
    const { searchAddresses, cachedAddresses } = await load();
    expect(cachedAddresses("1. Esen Sok.")).toBeUndefined();
    await searchAddresses("1. esen sok.");
    await searchAddresses("1. ESEN SOKAK");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedAddresses("1. Esen Sok.")?.[0].name).toBe("1. Esen Sokak");
  });

  it("HTTP hatasında reddeder ve önbelleğe yazmaz", async () => {
    fetchMock.mockImplementation(async () => new Response("", { status: 503 }));
    const { searchAddresses, cachedAddresses } = await load();
    await expect(searchAddresses("kent")).rejects.toThrow("Photon 503");
    expect(cachedAddresses("kent")).toBeUndefined();
  });
});
