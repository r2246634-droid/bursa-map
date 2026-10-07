/**
 * MapLibre GL v6 harita verisini ayrı bir Web Worker dosyasında işler ve bu dosyanın yerini
 * kendi modülünün adresine göre (import.meta.url) bulur. Next.js paketlediğinde bu adres
 * bozulduğu için ("Worker failed to load") dosyayı public/ altına kopyalıyoruz;
 * components/map/MapView.tsx setWorkerUrl ile buraya yönlendiriyor.
 *
 * npm install sonrasında (postinstall) ve dev/build öncesinde otomatik çalışır,
 * böylece kopya her zaman yüklü maplibre-gl sürümüyle aynı kalır.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const distDir = dirname(require.resolve("maplibre-gl/package.json"));
const source = join(distDir, "dist", "maplibre-gl-worker.mjs");
const targetDir = new URL("../public/vendor/", import.meta.url);

await mkdir(targetDir, { recursive: true });
await copyFile(source, new URL("maplibre-gl-worker.mjs", targetDir));
console.log("maplibre-gl-worker.mjs → public/vendor/");
