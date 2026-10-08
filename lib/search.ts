/**
 * Türkçe duyarlı, aksan affedici arama.
 *
 * 1) `tr-TR` yerel ayarıyla küçük harfe çevrilir: "I" → "ı", "İ" → "i".
 *    (Varsayılan toLowerCase "I"yı "i" yapar, "İ"yi "i̇" (i + birleşik nokta) yapar.)
 * 2) Türkçe harfler ASCII karşılığına katlanır: ı→i, ş→s, ğ→g, ü→u, ö→o, ç→c.
 *    Böylece Türkçe klavyesi olmayan kullanıcı "sehrekustu" yazarak "Şehreküstü"yü,
 *    "uni" yazarak "Üniversite"yi bulur; "ÜNİ", "üni", "Uni" hepsi aynı sonucu verir.
 * 3) Kalan aksanlar (NFD + birleşik işaretler) silinir, noktalama boşluğa çevrilir.
 */
const TR_FOLD: Record<string, string> = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };

export function foldTurkish(text: string): string {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[ışğüöç]/g, (ch) => TR_FOLD[ch])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface Searchable {
  name: string;
  /** İsim dışında eşleşebilecek adlar ("otogar" → Şehirlerarası Otobüs Terminali, durak kodu…) */
  aliases?: string[];
}

/** İndekste her öğe için bir kez hesaplanan katlanmış metinler */
interface IndexedText {
  text: string;
  words: string[];
  /** Takma ad eşleşmesi isim eşleşmesinden biraz geride sıralanır */
  penalty: number;
}

interface Entry<T> {
  item: T;
  texts: IndexedText[];
  /** Puana eklenir: düşük = önce (ör. raylı istasyonlar otobüs duraklarının önüne geçsin) */
  boost: number;
}

/**
 * Sorgunun her kelimesi metinde bir kelimenin başında geçmeli.
 * Puan (düşük = daha iyi): 0 tam eşleşme, 1 metin sorguyla başlıyor,
 * 2 bir kelime sorguyla başlıyor. Eşleşme yoksa null.
 */
function score(query: string, terms: string[], { text, words }: IndexedText): number | null {
  if (text === query) return 0;
  if (text.startsWith(query)) return 1;
  return terms.every((term) => words.some((w) => w.startsWith(term))) ? 2 : null;
}

/** İndeks anahtarı: kelimenin ilk iki harfi (tek harfli kelime/sorgu için ilk harf) */
const PREFIX_LENGTH = 2;

export interface SearchIndex<T> {
  search(query: string, limit?: number, filter?: (item: T) => boolean): T[];
  readonly size: number;
}

/**
 * Arama indeksi. Binlerce öğede (7.700+ otobüs durağı) her tuş vuruşunda tüm listeyi katlayıp
 * taramak yerine:
 *  - isimler indeks kurulurken bir kez katlanır (foldTurkish) ve kelimelere bölünür,
 *  - her kelimenin ilk 1 ve 2 harfi → öğe numaraları şeklinde bir Map tutulur.
 * Arama sırasında sadece sorgunun ilk kelimesinin önekiyle eşleşen adaylar puanlanır.
 * Puanlama kuralı "her sorgu kelimesi bir kelimenin başında geçmeli" olduğundan aday kümesi
 * sonuçların tamamını kapsar; indeks sonucu değiştirmez, sadece hızlandırır.
 */
export function createSearchIndex<T extends Searchable>(
  items: T[],
  boostOf: (item: T) => number = () => 0,
): SearchIndex<T> {
  const entries: Entry<T>[] = items.map((item) => ({
    item,
    boost: boostOf(item),
    texts: [
      { text: foldTurkish(item.name), penalty: 0 },
      ...(item.aliases ?? []).map((alias) => ({ text: foldTurkish(alias), penalty: 0.5 })),
    ]
      .filter((t) => t.text)
      .map((t) => ({ ...t, words: t.text.split(" ") })),
  }));

  const byPrefix = new Map<string, number[]>();
  entries.forEach((entry, i) => {
    const keys = new Set<string>();
    for (const { words } of entry.texts) {
      for (const word of words) {
        keys.add(word.slice(0, 1));
        if (word.length >= PREFIX_LENGTH) keys.add(word.slice(0, PREFIX_LENGTH));
      }
    }
    for (const key of keys) {
      const list = byPrefix.get(key);
      if (list) list.push(i);
      else byPrefix.set(key, [i]);
    }
  });

  return {
    size: entries.length,
    search(query, limit = 8, filter) {
      const q = foldTurkish(query);
      if (!q) return [];
      const terms = q.split(" ");
      const candidates = byPrefix.get(terms[0].slice(0, PREFIX_LENGTH)) ?? [];

      const results: { entry: Entry<T>; score: number }[] = [];
      for (const i of candidates) {
        const entry = entries[i];
        if (filter && !filter(entry.item)) continue;
        let best: number | null = null;
        for (const t of entry.texts) {
          const s = score(q, terms, t);
          if (s !== null && (best === null || s + t.penalty < best)) best = s + t.penalty;
        }
        if (best !== null) results.push({ entry, score: best + entry.boost });
      }

      return results
        .sort((a, b) => a.score - b.score || a.entry.item.name.localeCompare(b.entry.item.name, "tr"))
        .slice(0, limit)
        .map((r) => r.entry.item);
    },
  };
}
