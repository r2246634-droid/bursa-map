import { describe, expect, it } from "vitest";

import { approxDistanceM, buildAmenityData } from "@/lib/amenities";
import { createSearchIndex } from "@/lib/search";

// Heykel civarı; 0,009° enlem ≈ 1 km
const HEYKEL: [number, number] = [40.1833, 29.0633];

const data = buildAmenityData({
  categories: ["market", "school", "kindergarten", "pharmacy", "mosque", "park", "bank", "atm", "post"],
  areas: ["Heykel", "Görükle"],
  items: [
    ["n1", 0, 40.1835, 29.0635, "A101", 0], // ~30 m
    ["n2", 7, 40.1883, 29.0633, "Ziraat Bankası ATM", 0], // ~550 m
    ["w3", 5, 40.1833, 29.0633 + 0.0105, "", -1], // ~890 m, adsız park
    ["n4", 0, 40.1933, 29.0633, "A101", 0], // ~1,1 km
    ["n5", 0, 40.2271, 28.8711, "A101", 1], // Görükle, ~17 km
    ["n6", 99, 40.1833, 29.0633, "Bilinmeyen", 0], // tanımsız kategori: atlanır
  ],
});

const ids = (places: { id: string }[]) => places.map((p) => p.id).sort();

describe("buildAmenityData", () => {
  it("satırları yere çevirir: kategori → katman ve görünen tür, semt, kararlı kimlik", () => {
    const atm = data.places.find((p) => p.id === "amenity-n2")!;
    expect(atm).toMatchObject({ kind: "amenity", layer: "bank", category: "ATM", area: "Heykel" });
    expect(data.places).toHaveLength(5);
  });

  it("adsız yere tür adını verir ama aramaya almaz", () => {
    const park = data.places.find((p) => p.id === "amenity-w3")!;
    expect(park.name).toBe("Park");
    expect(park.area).toBeUndefined();
    expect(data.searchable.some((p) => p.id === "amenity-w3")).toBe(false);
  });

  it("near: sadece yarıçap içindekileri döndürür", () => {
    expect(ids(data.near(HEYKEL, 1000))).toEqual(["amenity-n1", "amenity-n2", "amenity-w3"]);
    expect(ids(data.near(HEYKEL, 100))).toEqual(["amenity-n1"]);
  });

  it("inBounds: hücre sınırlarını aşan kutuda da doğru yerleri bulur", () => {
    expect(ids(data.inBounds([28.8, 40.15, 29.0, 40.25]))).toEqual(["amenity-n5"]);
    expect(ids(data.inBounds([28.8, 40.15, 29.1, 40.25]))).toHaveLength(5);
  });

  it("approxDistanceM kısa mesafede yeterince doğru", () => {
    expect(approxDistanceM(HEYKEL, [40.1923, 29.0633])).toBeCloseTo(1002, -1);
  });
});

describe("arama: aynı adlı şubeler", () => {
  const index = createSearchIndex(data.searchable);

  it("tiebreak verilince haritanın baktığı yere yakın olan önce gelir", () => {
    const fromGorukle = index.search("a101", 8, undefined, (p) => approxDistanceM([40.227, 28.871], p.position));
    expect(fromGorukle.map((p) => p.id)).toEqual(["amenity-n5", "amenity-n4", "amenity-n1"]);
    const fromHeykel = index.search("a101", 8, undefined, (p) => approxDistanceM(HEYKEL, p.position));
    expect(fromHeykel[0].id).toBe("amenity-n1");
  });

  it("ad + semt birlikte aranabilir", () => {
    expect(index.search("a101 gorukle").map((p) => p.id)).toEqual(["amenity-n5"]);
  });
});
