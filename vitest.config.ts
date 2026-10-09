import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Birim testleri (Vitest). Test edilen kod saf iş mantığı (arama, veri dönüştürme, saat
 * hesapları) olduğundan tarayıcı ortamı (jsdom) gerekmez; testler Node'da çalışır.
 *
 *   npm test            → bir kez çalıştır (CI)
 *   npm run test:watch  → dosya değiştikçe yeniden çalıştır
 */
export default defineConfig({
  resolve: {
    // tsconfig.json'daki "@/*" yolunu Vite'a da tanıt
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Türkçe sıralama/büyük-küçük harf (Intl, toLocaleLowerCase("tr-TR")) ve saat dilimi
    // testleri her makinede aynı sonucu versin
    env: {
      TZ: "UTC",
      // Testler dış yürüme yönlendirme servisini (OSRM) çağırmasın; o modül ayrıca taklitle test edilir
      WALK_ROUTER_URL: "off",
    },
  },
});
