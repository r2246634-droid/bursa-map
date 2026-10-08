import { describe, expect, it } from "vitest";

import { busLinePlaceId, busStopPlaceId, formatStopName, lineRouteSummary } from "@/lib/burulas";
import type { BusLine } from "@/data/types";
import { safeFileName, slugId } from "../scripts/lib/naming.mjs";
import { stitchWays } from "../scripts/lib/osm.mjs";

describe("slugId — raylı istasyon kararlı kimliği (scripts/fetch-bursaray.mjs)", () => {
  it.each([
    ["metro", "Bursaspor/Acemler", "metro-bursaspor-acemler"],
    ["metro", "152 Evler", "metro-152-evler"],
    ["metro", "Şirinevler / Yiğitler", "metro-sirinevler-yigitler"],
    ["tram", "İncirli Hamamı", "tram-incirli-hamami"],
    ["tram", "Kültürpark/Millet Bahçesi", "tram-kulturpark-millet-bahcesi"],
    ["bus", "IŞIKLAR", "bus-isiklar"],
    ["bus", "Üniversite Aktarma Merkezi – Peron 6", "bus-universite-aktarma-merkezi-peron-6"],
    ["tram", "  (Kent Meydanı)  ", "tram-kent-meydani"],
  ])("slugId(%s, %s) → %s", (prefix, name, expected) => {
    expect(slugId(prefix, name)).toBe(expected);
  });

  it("sadece küçük ASCII harf, rakam ve tek tire içerir; aynı girdiye hep aynı sonucu verir", () => {
    const id = slugId("metro", "Çınarönü — Emir Sultan Mezarlığı/Hacıseyfettin");
    expect(id).toMatch(/^[a-z]+-[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(slugId("metro", "Çınarönü — Emir Sultan Mezarlığı/Hacıseyfettin")).toBe(id);
  });
});

describe("safeFileName — hat dosya adı (scripts/split-shapes.mjs)", () => {
  it.each([
    ["22C", "22C"],
    ["93", "93"],
    ["2GÇ", "2GC"],
    ["3İ", "3I"],
    ["132İ", "132I"],
    ["Bursaray Gece 1", "BURSARAY-GECE-1"],
    ["Armutlu (Ihlas)", "ARMUTLU-IHLAS"],
    ["Armutlu - Istanbul ", "ARMUTLU-ISTANBUL"],
    ["!!!", "HAT"],
  ])("%s → %s", (code, expected) => {
    expect(safeFileName(code)).toBe(expected);
  });

  it("her sonuç URL ve dosya sistemi için güvenli karakterlerden oluşur", () => {
    for (const code of ["2KÇ", "4İ", "Bursaray Gece 2", "T1", "B22K", "Ğ/Ş Ö"]) {
      expect(safeFileName(code)).toMatch(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
    }
  });
});

describe("formatStopName — BURULAŞ ham durak adı", () => {
  it.each([
    ["VAKIFKÖY MERKEZ 1 (D2993)", "Vakıfköy Merkez 1", "D2993"],
    ["T1-HEYKEL (B65)", "T1-Heykel", "B65"],
    ["ORGANİZE SANAYİ İST. 1 (B01)", "Organize Sanayi İst. 1", "B01"],
    ["ORGANİZE SANAYİ İST. 2 (B01-S)", "Organize Sanayi İst. 2", "B01-S"],
    ["IŞIKLAR CD. 3 (D0412)", "Işıklar Cd. 3", "D0412"],
    ["BUSKİ TAHSİLAT", "BUSKİ Tahsilat", null],
    ["ULUDAĞ ÜNİVERSİTESİ  İÇ PERON 2", "Uludağ Üniversitesi İç Peron 2", null],
  ])("%s → %s (%s)", (raw, name, code) => {
    expect(formatStopName(raw)).toEqual({ name, code });
  });

  it("kod olmayan parantezi (açıklamayı) adın parçası olarak bırakır", () => {
    expect(formatStopName("SİTELER (HAREKET MEMURLUĞU)")).toEqual({
      name: "Siteler (Hareket Memurluğu)",
      code: null,
    });
  });
});

describe("BURULAŞ yer kimlikleri ve özetler", () => {
  it("hat ve durak kimlikleri sabit biçimdedir (favoriler bunlara bağlı)", () => {
    expect(busLinePlaceId("22C")).toBe("bus-line-22C");
    expect(busLinePlaceId("B1")).toBe("bus-line-B1"); // otobüs B1, metro B1'den (metro-…) ayrı
    expect(busStopPlaceId(3467)).toBe("bus-stop-3467");
  });

  it("hat özeti ilk yönün başlangıç → bitiş durağını biçimlendirerek verir", () => {
    const line: BusLine = {
      id: 1050,
      code: "1A",
      name: "1A",
      stopCount: { G: 33, D: 32 },
      termini: { G: ["DEREBAHÇE 3", "DOBRUCA CAMİ"], D: ["DOBRUCA CAMİ", "DEREBAHÇE 1"] },
      hasShape: true,
    };
    expect(lineRouteSummary(line)).toBe("Derebahçe 3 → Dobruca Cami");
  });

  it("sadece ring (R) yönü olan hatta ring yönünü kullanır", () => {
    const ring: BusLine = {
      id: 1090,
      code: "22C",
      name: "22C",
      stopCount: { R: 67 },
      termini: { R: ["VAKIFKÖY MERKEZ 1", "SONDURAK (YILDIRIM)"] },
      hasShape: true,
    };
    expect(lineRouteSummary(ring)).toBe("Vakıfköy Merkez 1 → Sondurak (Yıldırım)");
  });
});

describe("stitchWays — OSM yol parçalarını tek çizgiye birleştirme", () => {
  const A = [0, 0];
  const B = [1, 0];
  const C = [2, 0];
  const D = [3, 0];

  it("sıralı parçaları uç uca ekler", () => {
    expect(stitchWays([[A, B], [B, C], [C, D]])).toEqual([[A, B, C, D]]);
  });

  it("ters girilmiş parçayı çevirir", () => {
    expect(stitchWays([[A, B], [C, B], [C, D]])).toEqual([[A, B, C, D]]);
  });

  it("ilk parça ters girilmişse onu da çevirir", () => {
    expect(stitchWays([[B, A], [B, C]])).toEqual([[A, B, C]]);
  });

  it("sırası karışık ama uçları değen parçaları tek çizgide birleştirir", () => {
    const parts = stitchWays([[C, D], [A, B], [B, C]]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toHaveLength(4);
    // Birleşen çizgi A–D arasını kesintisiz kapsar (yönü önemli değil)
    expect([parts[0][0], parts[0].at(-1)]).toEqual(expect.arrayContaining([A, D]));
  });

  it("gerçekten kopuk parçaları ayrı bırakır (MultiLineString olur)", () => {
    const E = [10, 10];
    const F = [11, 10];
    expect(stitchWays([[A, B], [E, F]])).toEqual([[A, B], [E, F]]);
  });
});
