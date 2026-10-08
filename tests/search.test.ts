import { describe, expect, it } from "vitest";

import { createSearchIndex, foldTurkish, type Searchable } from "@/lib/search";

const names = (items: Searchable[]) => items.map((i) => i.name);

describe("foldTurkish — Türkçe karakter katlama", () => {
  it("noktalı büyük İ'yi i yapar (toLowerCase'in bıraktığı birleşik nokta işareti de temizlenir)", () => {
    expect(foldTurkish("İSTANBUL")).toBe("istanbul");
    expect(foldTurkish("İzmir")).toBe("izmir");
  });

  it("noktasız I/ı'yı i'ye katlar", () => {
    expect(foldTurkish("IĞDIR")).toBe("igdir");
    expect(foldTurkish("ışık")).toBe("isik");
    expect(foldTurkish("IŞIK")).toBe("isik");
  });

  it("ş, ğ, ü, ö, ç harflerini ASCII karşılığına çevirir", () => {
    expect(foldTurkish("Şehreküstü")).toBe("sehrekustu");
    expect(foldTurkish("ÇİĞDEM Öğretmen")).toBe("cigdem ogretmen");
  });

  it("noktalama ve fazla boşlukları tek boşluğa indirir, kenarları kırpar", () => {
    expect(foldTurkish("Bursaspor/Acemler")).toBe("bursaspor acemler");
    expect(foldTurkish("  Kent   Meydanı  ")).toBe("kent meydani");
    expect(foldTurkish("T1-HEYKEL (B65)")).toBe("t1 heykel b65");
  });

  it("Türkçe dışı aksanları da siler", () => {
    expect(foldTurkish("Café Crème")).toBe("cafe creme");
  });

  it("yazılış farkı olan aynı kelimeler aynı sonucu verir", () => {
    const variants = ["ÜNİVERSİTE", "üniversite", "Universite", "UNIVERSITE", "Ünİversİte"];
    expect(new Set(variants.map(foldTurkish))).toEqual(new Set(["universite"]));
  });
});

describe("createSearchIndex — Türkçe arama", () => {
  const places: Searchable[] = [
    { name: "Şehreküstü" },
    { name: "Bursaspor/Acemler" },
    { name: "Acemler Aktarma Merkezi Peron 1" },
    { name: "Üniversite" },
    { name: "Vakıfköy Merkez 1" },
    { name: "Işıklar Cd. 3" },
    { name: "Bursa Şehirlerarası Otobüs Terminali", aliases: ["otogar"] },
    { name: "Kent" },
    { name: "Kent Meydanı" },
    { name: "Alt Kent" },
  ];
  const index = createSearchIndex(places);

  it('"sehrekustu" araması "Şehreküstü"yü bulur', () => {
    expect(names(index.search("sehrekustu"))).toEqual(["Şehreküstü"]);
  });

  it("büyük/küçük harf ve Türkçe karakter farkı sonucu değiştirmez", () => {
    for (const query of ["ÜNİ", "üni", "Uni", "UNI", "uni"]) {
      expect(names(index.search(query)), query).toEqual(["Üniversite"]);
    }
    expect(names(index.search("IŞIK"))).toEqual(["Işıklar Cd. 3"]);
    expect(names(index.search("isik"))).toEqual(["Işıklar Cd. 3"]);
  });

  it("kelime başından eşleşir: 'acemler' ikinci kelimedeki Acemler'i de bulur", () => {
    expect(names(index.search("acemler"))).toEqual(["Acemler Aktarma Merkezi Peron 1", "Bursaspor/Acemler"]);
  });

  it("kelimenin ortasından eşleşmez", () => {
    expect(index.search("kustu")).toEqual([]);
    expect(index.search("ersite")).toEqual([]);
  });

  it("çok kelimeli sorguda kelime sırası önemli değil, hepsi eşleşmeli", () => {
    expect(names(index.search("merkez vakıfköy"))).toEqual(["Vakıfköy Merkez 1"]);
    expect(index.search("vakıfköy terminal")).toEqual([]);
  });

  it("puanlama: tam eşleşme > baştan eşleşme > kelime başı eşleşme", () => {
    // Alfabetik sıra "Alt Kent"i öne alırdı; puanlama "Kent Meydanı"nı (baştan eşleşme) öne geçirmeli
    expect(names(index.search("kent"))).toEqual(["Kent", "Kent Meydanı", "Alt Kent"]);
  });

  it("takma adla bulur ama aynı puandaki isim eşleşmesinin arkasında sıralar", () => {
    expect(names(index.search("otogar"))).toEqual(["Bursa Şehirlerarası Otobüs Terminali"]);

    // Alfabetik sıra "Bursa Terminali"ni öne alırdı; takma ad cezası isim eşleşmesini öne geçirmeli
    const withName = createSearchIndex<Searchable>([
      { name: "Bursa Terminali", aliases: ["otogar"] },
      { name: "Otogar" },
    ]);
    expect(names(withName.search("otogar"))).toEqual(["Otogar", "Bursa Terminali"]);
  });

  it("boş, boşluk ya da sadece noktalama içeren sorgu sonuç döndürmez", () => {
    expect(index.search("")).toEqual([]);
    expect(index.search("   ")).toEqual([]);
    expect(index.search("/-.")).toEqual([]);
  });

  it("limit ve filtre uygulanır", () => {
    expect(index.search("a", 2)).toHaveLength(2);
    const onlyShort = index.search("kent", 10, (p) => p.name.length <= 4);
    expect(names(onlyShort)).toEqual(["Kent"]);
  });

  it("eşit puanda öncelik (boost) verilen öğe öne geçer", () => {
    type Item = Searchable & { rail?: boolean };
    const items: Item[] = [{ name: "Acemler 1" }, { name: "Acemler İstasyonu", rail: true }];
    const boosted = createSearchIndex(items, (i) => (i.rail ? -0.3 : 0));
    expect(names(boosted.search("acemler"))).toEqual(["Acemler İstasyonu", "Acemler 1"]);
  });

  it("eşit puanlı sonuçlar Türkçe alfabeye göre sıralanır (C < Ç, O < Ö)", () => {
    const abc = createSearchIndex<Searchable>([{ name: "Çarşı" }, { name: "Cami" }, { name: "Ören" }, { name: "Orhan" }]);
    expect(names(abc.search("c"))).toEqual(["Cami", "Çarşı"]);
    expect(names(abc.search("o"))).toEqual(["Orhan", "Ören"]);
  });
});

describe("createSearchIndex — önek indeksi sonucu değiştirmez", () => {
  // İndeks sadece hızlandırma içindir: tüm listeyi tek tek tarayan basit yöntemle aynı kümeyi vermeli
  const words = ["Acemler", "Şehreküstü", "Üniversite", "Işıklar", "Kent", "Meydanı", "Peron", "152", "Evler", "Çınarönü", "İncirli", "Hamamı"];
  const items: Searchable[] = [];
  for (let i = 0; i < words.length; i++) {
    for (let j = 0; j < words.length; j++) {
      if (i !== j) items.push({ name: `${words[i]} ${words[j]} ${(i * 7 + j) % 5}` });
    }
  }
  const index = createSearchIndex(items);

  const naive = (query: string) => {
    const q = foldTurkish(query);
    if (!q) return [];
    const terms = q.split(" ");
    return items.filter(({ name }) => {
      const text = foldTurkish(name);
      const ws = text.split(" ");
      return text.startsWith(q) || terms.every((t) => ws.some((w) => w.startsWith(t)));
    });
  };

  it.each(["a", "ac", "acemler", "ş", "seh", "ünİ", "ISIK", "152 ev", "peron 3", "ç", "inc ham", "x"])(
    "%s",
    (query) => {
      const fromIndex = new Set(names(index.search(query, items.length)));
      expect(fromIndex).toEqual(new Set(names(naive(query))));
    },
  );
});
