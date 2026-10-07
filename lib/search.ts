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
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Sorgunun her kelimesi metinde bir kelimenin başında geçmeli.
 * Puan (düşük = daha iyi): 0 tam eşleşme, 1 metin sorguyla başlıyor,
 * 2 bir kelime sorguyla başlıyor. Eşleşme yoksa null.
 */
function score(foldedQuery: string, foldedText: string): number | null {
  if (foldedText === foldedQuery) return 0;
  if (foldedText.startsWith(foldedQuery)) return 1;

  const words = foldedText.split(" ");
  const terms = foldedQuery.split(" ");
  const allTermsMatch = terms.every((term) => words.some((w) => w.startsWith(term)));
  return allTermsMatch ? 2 : null;
}

interface Searchable {
  name: string;
  /** İsim dışında eşleşebilecek adlar ("otogar" → Şehirlerarası Otobüs Terminali) */
  aliases?: string[];
}

/** İsim ve takma adlardan en iyi puan; takma ad eşleşmesi isimden bir derece düşük sayılır */
function bestScore(foldedQuery: string, item: Searchable): number | null {
  const scores = [
    score(foldedQuery, foldTurkish(item.name)),
    ...(item.aliases ?? []).map((alias) => {
      const s = score(foldedQuery, foldTurkish(alias));
      return s === null ? null : s + 0.5;
    }),
  ].filter((s): s is number => s !== null);
  return scores.length ? Math.min(...scores) : null;
}

/** Eşleşenleri puana, sonra ada göre sıralı döndürür. Boş sorguda boş liste. */
export function searchByName<T extends Searchable>(items: T[], query: string, limit = 8): T[] {
  const q = foldTurkish(query);
  if (!q) return [];

  return items
    .map((item) => ({ item, score: bestScore(q, item) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name, "tr"))
    .slice(0, limit)
    .map((r) => r.item);
}
