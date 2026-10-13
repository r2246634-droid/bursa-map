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

/**
 * Harf hatası toleransı: 4–6 harfli kelimede 1, daha uzunda 2 hata.
 * Kısa kelimelerde hata kabul edilmez; yoksa "kar" "kır"ı, "ak" "ok"u bulur.
 */
export function allowedTypos(term: string): number {
  if (term.length < 4) return 0;
  return term.length < 7 ? 1 : 2;
}

/**
 * Terimin, kelimenin en yakın önekine harf hatası uzaklığı (Damerau-Levenshtein: eksik, fazla,
 * yanlış ya da yer değiştirmiş harf 1 hata). Önek: kullanıcı kelimeyi yazmayı bitirmemiş olabilir,
 * "anatolum" → "anatolium" 1, "medyan" → "meydani" 1. Uzaklık max'ı aşarsa null.
 */
export function prefixTypoDistance(term: string, word: string, max: number): number | null {
  const m = term.length;
  // Kelimenin m + max harfinden sonrası hiçbir zaman daha yakın bir önek vermez
  const n = Math.min(word.length, m + max);
  if (n < m - max) return null;

  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = term[i - 1] === word[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && term[i - 1] === word[j - 2] && term[i - 2] === word[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      row.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return null; // satır minimumu bir daha küçülmez
    prev2 = prev;
    prev = row;
  }
  // Son satır: terimin tamamının kelimenin her önekine uzaklığı; en yakını
  const best = Math.min(...prev);
  return best <= max ? best : null;
}

/** Harf hatalı eşleşmeler kesin eşleşmelerin (0–2) arkasında, hata sayısına göre sıralanır */
const FUZZY_SCORE = 3;

export interface SearchIndex<T> {
  /** tiebreak: aynı puanlı sonuçları sıralar (düşük = önce), ör. haritaya yakınlık; eşitse ada göre */
  search(query: string, limit?: number, filter?: (item: T) => boolean, tiebreak?: (item: T) => number): T[];
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
 *
 * Kesin eşleşme hiç yoksa harf hatası toleranslı aramaya düşülür ("anatolum", "kent medyani"):
 * sorgunun her kelimesi, aynı metindeki bir kelimenin önekine allowedTypos kadar hatayla
 * eşleşmeli. Bunun için tüm benzersiz kelimelerin listesi (birkaç bin) taranır; kesin sonuç
 * varken çalışmadığından doğru yazılmış aramaların sonucu ve hızı değişmez.
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
  /** Benzersiz kelime → içinde geçtiği öğeler (harf hatalı arama için) */
  const byWord = new Map<string, number[]>();
  const add = (map: Map<string, number[]>, key: string, i: number) => {
    const list = map.get(key);
    if (list) list.push(i);
    else map.set(key, [i]);
  };
  entries.forEach((entry, i) => {
    const keys = new Set<string>();
    const words = new Set<string>();
    for (const t of entry.texts) {
      for (const word of t.words) {
        words.add(word);
        keys.add(word.slice(0, 1));
        if (word.length >= PREFIX_LENGTH) keys.add(word.slice(0, PREFIX_LENGTH));
      }
    }
    for (const key of keys) add(byPrefix, key, i);
    for (const word of words) add(byWord, word, i);
  });

  type Scored = { entry: Entry<T>; score: number };

  function strictSearch(q: string, terms: string[], filter?: (item: T) => boolean): Scored[] {
    const results: Scored[] = [];
    for (const i of byPrefix.get(terms[0].slice(0, PREFIX_LENGTH)) ?? []) {
      const entry = entries[i];
      if (filter && !filter(entry.item)) continue;
      let best: number | null = null;
      for (const t of entry.texts) {
        const s = score(q, terms, t);
        if (s !== null && (best === null || s + t.penalty < best)) best = s + t.penalty;
      }
      if (best !== null) results.push({ entry, score: best + entry.boost });
    }
    return results;
  }

  function fuzzySearch(terms: string[], filter?: (item: T) => boolean): Scored[] {
    if (terms.every((term) => allowedTypos(term) === 0)) return []; // kesin aramadan farkı olmaz

    // Her terim için: eşleşen kelime → hata sayısı
    const matches = terms.map((term) => {
      const max = allowedTypos(term);
      const found = new Map<string, number>();
      for (const word of byWord.keys()) {
        const d = word.startsWith(term) ? 0 : max > 0 ? prefixTypoDistance(term, word, max) : null;
        if (d !== null) found.set(word, d);
      }
      return found;
    });
    if (matches.some((m) => m.size === 0)) return [];

    // Adaylar: en az kelimeyle eşleşen terimin kelimelerini içeren öğeler
    const rarest = matches.reduce((a, b) => (b.size < a.size ? b : a));
    const candidates = new Set<number>();
    for (const word of rarest.keys()) for (const i of byWord.get(word)!) candidates.add(i);

    const results: Scored[] = [];
    for (const i of candidates) {
      const entry = entries[i];
      if (filter && !filter(entry.item)) continue;
      let best: number | null = null;
      for (const t of entry.texts) {
        let typos = 0;
        for (const found of matches) {
          let termBest: number | null = null;
          for (const word of t.words) {
            const d = found.get(word);
            if (d !== undefined && (termBest === null || d < termBest)) termBest = d;
          }
          if (termBest === null) {
            typos = -1;
            break;
          }
          typos += termBest;
        }
        if (typos < 0) continue;
        const s = FUZZY_SCORE + typos + t.penalty;
        if (best === null || s < best) best = s;
      }
      if (best !== null) results.push({ entry, score: best + entry.boost });
    }
    return results;
  }

  return {
    size: entries.length,
    search(query, limit = 8, filter, tiebreak) {
      const q = foldTurkish(query);
      if (!q) return [];
      const terms = q.split(" ");
      let results = strictSearch(q, terms, filter);
      if (results.length === 0) results = fuzzySearch(terms, filter);

      return results
        .sort(
          (a, b) =>
            a.score - b.score ||
            (tiebreak ? tiebreak(a.entry.item) - tiebreak(b.entry.item) : 0) ||
            a.entry.item.name.localeCompare(b.entry.item.name, "tr"),
        )
        .slice(0, limit)
        .map((r) => r.entry.item);
    },
  };
}
