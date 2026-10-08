/**
 * Kararlı kimlik ve dosya adı üretimi — yan etkisiz saf fonksiyonlar (birim testli:
 * tests/data-ids.test.ts). Veri betikleri ve uygulama bu kimliklere güvenir: kayıtlı
 * favoriler (localStorage) ve hat dosya adları veri yenilense de değişmemeli.
 */

const TR_ASCII = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };

/** Türkçe harfleri ASCII'ye çevirip diğer aksanları atar: "Şehreküstü" → "sehrekustu" */
function asciiFold(text) {
  return text
    .toLocaleLowerCase("tr-TR")
    .replace(/[ışğüöç]/g, (ch) => TR_ASCII[ch])
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * İsimden kararlı kimlik: slugId("metro", "Bursaspor/Acemler") → "metro-bursaspor-acemler".
 * Sıra numarası yerine isim kullanılır ki veri yenilenince id'ler (ör. kayıtlı yerler) bozulmasın.
 */
export function slugId(prefix, name) {
  const slug = asciiFold(name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${slug}`;
}

/**
 * Hat kodundan URL ve her dosya sisteminde güvenli dosya adı (uzantısız):
 * "2GÇ" → "2GC", "3İ" → "3I", "Bursaray Gece 1" → "BURSARAY-GECE-1".
 * Büyük harfe çevrilir; Windows/macOS büyük-küçük harf duyarsız olduğundan çakışma
 * kontrolü çağıran tarafta küçük harfle yapılır (split-shapes.mjs).
 */
export function safeFileName(code) {
  return (
    asciiFold(code)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "HAT"
  );
}
