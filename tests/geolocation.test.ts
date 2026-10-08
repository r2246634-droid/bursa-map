import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentPlace,
  LocationError,
  locationErrorMessage,
  locationPermissionGranted,
  MY_LOCATION_ID,
} from "@/lib/geolocation";

type Success = (p: { coords: { latitude: number; longitude: number } }) => void;
type Failure = (e: { code: number }) => void;

/** Tarayıcı konum servisini taklit eder: ya konum verir ya da verilen kodla hata döner */
function stubGeolocation(result: { lat: number; lon: number } | { code: number }, secure = true) {
  const getCurrentPosition = vi.fn((ok: Success, fail: Failure) => {
    if ("code" in result) fail({ code: result.code });
    else ok({ coords: { latitude: result.lat, longitude: result.lon } });
  });
  vi.stubGlobal("isSecureContext", secure);
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  return getCurrentPosition;
}

afterEach(() => vi.unstubAllGlobals());

describe("getCurrentPlace — 'Konumum' başlangıç noktası", () => {
  it("Bursa içindeki konumu 'Konumum' yerine çevirir", async () => {
    stubGeolocation({ lat: 40.1885, lon: 29.061 });
    await expect(getCurrentPlace()).resolves.toMatchObject({
      id: MY_LOCATION_ID,
      kind: "feature",
      name: "Konumum",
      position: [40.1885, 29.061],
    });
  });

  it("HTTPS olmayan sayfada (ör. http://10.x yerel ağ) konum hiç istenmez", async () => {
    const spy = stubGeolocation({ lat: 40.19, lon: 29.06 }, false);
    await expect(getCurrentPlace()).rejects.toMatchObject({ reason: "insecure" });
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 1 }, "denied"],
    [{ code: 2 }, "unavailable"],
    [{ code: 3 }, "timeout"],
    [{ lat: 41.0082, lon: 28.9784 }, "outside"], // İstanbul
  ] as const)("%o → %s", async (result, reason) => {
    stubGeolocation(result);
    await expect(getCurrentPlace()).rejects.toMatchObject({ reason });
  });

  it("konum servisi olmayan tarayıcı", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {});
    await expect(getCurrentPlace()).rejects.toMatchObject({ reason: "unsupported" });
  });
});

describe("locationErrorMessage", () => {
  it("her hata nedeni için kullanıcıya Türkçe açıklama verir", () => {
    expect(locationErrorMessage(new LocationError("insecure"))).toMatch(/HTTPS/);
    expect(locationErrorMessage(new LocationError("denied"))).toMatch(/izin/);
    expect(locationErrorMessage(new LocationError("outside"))).toMatch(/Bursa dışında/);
    expect(locationErrorMessage(new Error("beklenmedik"))).toMatch(/bulunamadı/);
  });
});

describe("locationPermissionGranted — sormadan doldurma kararı", () => {
  const withPermission = (state: string, secure = true) => {
    vi.stubGlobal("isSecureContext", secure);
    vi.stubGlobal("navigator", { permissions: { query: vi.fn(async () => ({ state })) } });
  };

  it("izin önceden verilmişse true", async () => {
    withPermission("granted");
    await expect(locationPermissionGranted()).resolves.toBe(true);
  });

  it("henüz sorulmamışsa (prompt) veya reddedilmişse false — izin penceresi kendiliğinden açılmaz", async () => {
    withPermission("prompt");
    await expect(locationPermissionGranted()).resolves.toBe(false);
    withPermission("denied");
    await expect(locationPermissionGranted()).resolves.toBe(false);
  });

  it("güvenli olmayan sayfada false", async () => {
    withPermission("granted", false);
    await expect(locationPermissionGranted()).resolves.toBe(false);
  });
});
