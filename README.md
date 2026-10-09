# Bursa Map

Bursa için mobil öncelikli toplu taşıma haritası (PWA): metro, tramvay ve otobüs hatları, durak arama,
hat listesi, favoriler ve otobüs + raylı sistem üzerinde yol tarifi.

**Teknoloji:** Next.js 16 (App Router) · React 19 · TypeScript 6 · Tailwind CSS 4 · MapLibre GL
(OpenFreeMap vektör harita) · Zustand · Vitest

## Kurulum

Gereksinim: Node.js 22.12 veya üstü.

```bash
npm install          # postinstall: MapLibre worker dosyasını public/vendor/ altına kopyalar
cp .env.example .env.local   # isteğe bağlı: adres servisi (bkz. .env.example)
npm run dev          # http://localhost:3000
```

## Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` / `npm start` | Production derleme / çalıştırma |
| `npm test` | Birim testleri (Vitest) — `npm run test:watch` izleme modu |
| `npm run lint` · `npm run typecheck` | ESLint · TypeScript kontrolü |
| `npm run data` | OSM verisini yeniler (öne çıkan noktalar, metro/tramvay, tramvay boşlukları) |
| `npm run data:walk` | Yaya yolu ağını OSM'den yeniden üretir (`data/walk/`, birkaç dakika) |
| `npm run data:shapes` | Hat güzergâhlarını hat başına dosyalara böler (dev/build öncesi otomatik) |

## Proje yapısı

```
app/              sayfa, PWA manifest, API: app/api/route (yol tarifi)
components/       MapShell (uygulama durumu), map/ (MapLibre katmanları), ui/ (paneller, kartlar)
data/             işlenmiş veri: bursaray.json (OSM raylı), pois.json, burulas/ (otobüs veri seti)
lib/              arama, BURULAŞ erişimi, favoriler, harita ayarları, routing/ (RAPTOR, takvim, saat)
scripts/          veri betikleri (OSM, BURULAŞ dönüştürme/bölme)
tests/            Vitest birim testleri
```

## Veri kaynakları

- **OpenStreetMap** (Overpass): metro, tramvay, öne çıkan noktalar — © OpenStreetMap katkıda bulunanlar, ODbL.
- **OpenFreeMap**: altlık harita (anahtar gerektirmez).
- **BURULAŞ / BursaKart**: otobüs hatları, duraklar, güzergâhlar, sefer saatleri (`data/burulas/`).
  ⚠️ Bu veri bursakart.com.tr'nin herkese açık olarak sunulmamış servisinden toplanmıştır;
  **yayına almadan önce BURULAŞ'tan kullanım izni alınmalıdır.**

### BURULAŞ verisini yenileme

Servis yalnızca bursakart.com.tr kaynaklı isteklere cevap verdiğinden toplama tarayıcıda yapılır:

1. Chrome'da <https://www.bursakart.com.tr/wheremybus> açın, F12 → Console.
2. `scripts/burulas-collector.browser.js` içeriğini yapıştırıp çalıştırın (~10 dk); iki dosya indirilir.
3. Dosyaları `data/raw/` altına koyup:
   ```bash
   node scripts/build-bus-dataset.mjs data/raw/burulas-raw.json data/raw/burulas-schedules.json
   npm run data:rail-gaps
   ```

## Yol tarifi

`GET /api/route?from=enlem,boylam&to=enlem,boylam[&at=2026-10-08T08:30:00+03:00]`

RAPTOR algoritması (lib/routing/raptor.ts). Ara durak saatleri ilk duraktan kalkış saatine göre
tahmin edilir (otobüs 20, tramvay 16, metro 35 km/s). Resmi tatillerde Pazar tarifesi uygulanır;
dini bayram tarihleri `lib/routing/calendar.ts` içinde **2027 sonuna kadar** tanımlıdır — her yıl
eklenmelidir.

Yürüme mesafeleri ve çizgileri kendi yaya yolu ağımız üzerinden hesaplanır
(`lib/routing/walk-graph.ts`): OSM'nin yürünebilir yolları (cadde, sokak, kaldırım, patika,
merdiven; otoyollar hariç) `scripts/fetch-walk-graph.mjs` ile sıkıştırılmış bir grafa
(`data/walk/bursa-walk.bin.gz`, ~5 MB) çevrilir; sunucu bunu bellekte tutar ve Dijkstra/A* ile arar
(arama başına birkaç ms, dış servis yok). Ağ, durakların ~%98'ini kapsayan alanı içerir; bunun
dışındaki (uzak ilçe) yürüyüşler kuş uçuşu × 1,25 tahmin edilir ve yanıtta not olarak belirtilir.

## Yayına alma (Vercel)

Yol tarifi sunucuda çalıştığı için statik barındırma yetmez; Node.js destekli bir ortam gerekir.

1. <https://vercel.com> → "Add New Project" → GitHub'daki `bursa-map` deposunu içe aktarın.
2. Framework: Next.js (otomatik). Build komutu `npm run build` (varsayılan).
3. Environment Variables: `NEXT_PUBLIC_REVERSE_GEOCODE_URL` (yayında zorunlu, bkz. `.env.example`).
4. Deploy. Sonraki her `git push` otomatik yayınlanır.

Not: Yol tarifi ağı ilk istekte bellekte kurulur (~0,5 sn); sonraki aramalar milisaniyeler sürer.
