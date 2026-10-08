import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Adres servisi istemcisi: uç nokta ayarı, saniyede 1 istek sınırı, önbellek ve iptal.
 * Modül, uç noktayı yüklenirken okuduğu için her testte yeniden içe aktarılır.
 */
const answer = { name: "Bursa Teknik Üniversitesi", address: { road: "Mimar Sinan Cd.", town: "Yıldırım" } };

async function load(endpoint?: string) {
  vi.resetModules();
  if (endpoint) vi.stubEnv("NEXT_PUBLIC_REVERSE_GEOCODE_URL", endpoint);
  return import("@/lib/reverse-geocode");
}

describe("reverseGeocode", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("varsayılan olarak OSM Nominatim'e Türkçe adres ister ve kısa adres üretir", async () => {
    const { reverseGeocode } = await load();
    const result = await reverseGeocode([40.1885, 29.13]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/reverse");
    expect(url.searchParams.get("accept-language")).toBe("tr");
    expect(result).toEqual({ name: "Bursa Teknik Üniversitesi", address: "Mimar Sinan Cd., Yıldırım" });
  });

  it("uç nokta ortam değişkeniyle değişir; uç noktadaki anahtar parametresi korunur", async () => {
    const { reverseGeocode } = await load("https://geo.example.com/v1/reverse?key=GIZLI");
    await reverseGeocode([40.2, 29.0]);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.host).toBe("geo.example.com");
    expect(url.searchParams.get("key")).toBe("GIZLI");
    expect(url.searchParams.get("lat")).toBe("40.2");
  });

  it("art arda isteklerin arasında en az ~1 sn bekler (Nominatim politikası)", async () => {
    const { reverseGeocode } = await load();
    const first = reverseGeocode([40.21, 29.01]);
    const second = reverseGeocode([40.22, 29.02]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1); // henüz 1 sn dolmadı
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.all([first, second]);
  });

  it("aynı konum ikinci kez sorulursa önbellekten döner", async () => {
    const { reverseGeocode } = await load();
    await reverseGeocode([40.23, 29.03]);
    await reverseGeocode([40.23, 29.03]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sırada beklerken iptal edilen istek hiç gönderilmez", async () => {
    const { reverseGeocode } = await load();
    const first = reverseGeocode([40.24, 29.04]);
    const controller = new AbortController();
    const second = reverseGeocode([40.25, 29.05], controller.signal);
    // Beklenti zamanlayıcı ilerlemeden bağlanır; aksi halde ret "işlenmemiş" sayılır
    const rejected = expect(second).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await vi.advanceTimersByTimeAsync(2000);
    await first;
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
