import withPWAInit, { runtimeCaching as defaultRuntimeCaching } from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  // Service worker geliştirme sırasında önbellek karmaşası yaratmasın
  disable: process.env.NODE_ENV === "development",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  workboxOptions: {
    disableDevLogs: true,
    runtimeCaching: [
      {
        // Vektör harita karoları, yazı tipleri ve ikonlar (OpenFreeMap): daha önce gezilen
        // bölgeler çevrimdışı da görünür. Stil dosyası ayrı: güncellemeleri kaçırmamak için ağ öncelikli.
        urlPattern: /^https:\/\/tiles\.openfreemap\.org\/(planet|natural_earth|fonts|sprites)\/.*/i,
        handler: "CacheFirst",
        options: {
          cacheName: "map-tiles",
          expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 30 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        urlPattern: /^https:\/\/tiles\.openfreemap\.org\/styles\/.*/i,
        handler: "NetworkFirst",
        options: { cacheName: "map-style", networkTimeoutSeconds: 3 },
      },
      ...defaultRuntimeCaching,
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// PWA eklentisi webpack tabanlı; geliştirmede Turbopack'i engellemesin diye sadece production'da sarmala
export default process.env.NODE_ENV === "development" ? nextConfig : withPWA(nextConfig);
