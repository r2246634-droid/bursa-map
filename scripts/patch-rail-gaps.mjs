/**
 * OSM'deki raylı hat çizgilerinde boşluk varsa (MultiLineString: relation'da eksik ray parçaları),
 * o hattın çizgisini BURULAŞ güzergâhıyla (data/burulas/line-shapes.json) değiştirir.
 * İstasyonlar, adlar ve renkler OSM'den kalır; sadece geometri değişir.
 *
 *   npm run data:rail-gaps   (npm run data zincirinde fetch-bursaray'den sonra çalışır)
 *
 * Metro (M1/M2) çizgileri OSM'de kesintisiz ve yan yana çizim (offset) için batı → doğu
 * yazıldığından dokunulmaz; bu betik sadece boşluklu hatları düzeltir (2026-10: T2, T3).
 */
import { readFile, writeFile } from "node:fs/promises";

/** OSM hat kodu → BURULAŞ hat kodu (tramvaylar aynı adla geçiyor) */
const BURULAS_CODE = { T1: "T1", T2: "T2", T3: "T3" };

const railUrl = new URL("../data/bursaray.json", import.meta.url);
const rail = JSON.parse(await readFile(railUrl, "utf8"));
const shapes = JSON.parse(await readFile(new URL("../data/burulas/line-shapes.json", import.meta.url), "utf8"));

const patched = [];
for (const feature of rail.features) {
  const { type, id } = feature.properties;
  if (type !== "line" || feature.geometry.type !== "MultiLineString") continue;
  const directions = shapes[BURULAS_CODE[id]];
  if (!directions) continue;
  // Tek yön yeterli (tramvayda yan yana kaydırma yok): en çok noktalı yön
  const best = Object.values(directions).sort((a, b) => b.length - a.length)[0];
  if (!best || best.length < 2) continue;
  feature.geometry = { type: "LineString", coordinates: best };
  feature.properties.geometrySource = "burulas";
  patched.push(id);
}

await writeFile(railUrl, JSON.stringify(rail) + "\n");
console.log(`rail-gaps: ${patched.length ? patched.join(", ") + " çizgisi BURULAŞ güzergâhıyla dolduruldu" : "boşluklu hat yok"}`);
