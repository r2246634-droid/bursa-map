/**
 * data/burulas/line-shapes.json (~7 MB, tüm hatların güzergâhı) dosyasını hat başına
 * ayrı GeoJSON dosyalarına böler; uygulama sadece haritada gösterilen hattı indirir.
 *
 *   npm run data:shapes
 *   node scripts/split-shapes.mjs [--in data/burulas/line-shapes.json] [--out public/data/burulas/shapes]
 *
 * Çıktı public/ altında: Next.js sadece public/ klasörünü tarayıcıya statik dosya olarak sunar,
 * data/ altındaki bir dosya çalışma anında fetch ile istenemez.
 *
 *   <out>/index.json   — hat kodu → { dosya, yönler, nokta sayısı, sınır kutusu }
 *   <out>/<dosya>.json — o hattın GeoJSON FeatureCollection'ı: her yön bir LineString
 *                        (kind: "route") + hattın durakları (kind: "stop", line-stops.json'dan)
 *
 * Bellek: Kaynak dosya JSON.parse ile tek seferde açılmaz. Akış (stream) olarak okunur, en üst
 * seviyedeki her "hat": {...} çifti ayrıştırıcı tarafından ayrı ayrı yakalanır, yazılır ve
 * bırakılır. Bellekte aynı anda sadece tek bir hattın verisi (+ okuma tamponu) bulunur.
 * (Durak eşlemesi için küçük line-stops.json ~0,7 MB ve stations.json ~0,8 MB doğrudan okunur.)
 */
import fs from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { safeFileName } from "./lib/naming.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const args = {
    in: "data/burulas/line-shapes.json",
    stops: "data/burulas/line-stops.json",
    stations: "data/burulas/stations.json",
    out: "public/data/burulas/shapes",
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in") args.in = argv[++i];
    else if (argv[i] === "--out") args.out = argv[++i];
  }
  return {
    input: path.resolve(ROOT, args.in),
    output: path.resolve(ROOT, args.out),
    stopsFile: path.resolve(ROOT, args.stops),
    stationsFile: path.resolve(ROOT, args.stations),
  };
}

/**
 * En üst seviyesi { "anahtar": değer, ... } olan bir JSON dosyasını akış halinde okuyup
 * her anahtar/değer çiftini sırayla verir. Değer metni tamamlanınca JSON.parse edilir;
 * böylece dosyanın tamamı hiçbir zaman tek bir string/nesne olarak bellekte tutulmaz.
 *
 * Sadece string içindeki kaçış karakterleri ve iç içe { } / [ ] derinliği izlenir;
 * en üst seviye nesne dışında bir yapı beklenmez.
 */
async function* streamTopLevelEntries(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: 64 * 1024 });

  let depth = 0; // 0: en üst nesnenin dışı, 1: en üst nesnenin içi
  let inString = false;
  let escaped = false;
  let state = "key"; // key → colon → value
  let keyBuf = "";
  let valueBuf = "";
  let valueDepth = 0;

  for await (const chunk of stream) {
    // Önceki parçada yarım kalan bir anahtar ya da değer varsa bu parçanın başından devam eder
    const continuing = (state === "value" && valueDepth > 0) || (state === "key" && inString);
    let valueStart = continuing ? 0 : -1;

    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') {
          inString = false;
          if (state === "key") {
            keyBuf += chunk.slice(valueStart, i + 1);
            valueStart = -1;
            state = "colon";
          }
        }
        continue;
      }

      if (depth === 0) {
        if (ch === "{") depth = 1;
        continue;
      }

      if (state === "key") {
        if (ch === '"') {
          inString = true;
          keyBuf = "";
          valueStart = i;
        } else if (ch === "}") {
          return; // en üst nesne bitti
        }
        continue;
      }

      if (state === "colon") {
        if (ch === ":") state = "value";
        continue;
      }

      // state === "value": değer bir nesne veya dizi olmalı ({ "G": [...], "R": [...] })
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        if (valueDepth === 0) {
          valueStart = i;
          valueBuf = "";
        }
        valueDepth++;
      } else if (ch === "}" || ch === "]") {
        valueDepth--;
        if (valueDepth === 0) {
          valueBuf += chunk.slice(valueStart, i + 1);
          yield [JSON.parse(keyBuf), JSON.parse(valueBuf)];
          keyBuf = valueBuf = "";
          valueStart = -1;
          state = "key";
        }
      }
    }

    // Parça sonunda yarım kalan anahtar/değer metnini bir sonraki parçaya taşı
    if (valueStart !== -1) {
      if (state === "key") keyBuf += chunk.slice(valueStart);
      else valueBuf += chunk.slice(valueStart);
    }
  }
  throw new Error(`${filePath}: dosya beklenmedik şekilde bitti (eksik "}")`);
}

function boundingBox(lines) {
  let [minLon, minLat, maxLon, maxLat] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of lines) {
    for (const [lon, lat] of line) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** Yazma akışına backpressure'a uyarak yazar: tampon dolarsa "drain" bekler */
async function writeFileStreamed(filePath, text) {
  const out = fs.createWriteStream(filePath, { encoding: "utf8" });
  if (!out.write(text)) await once(out, "drain");
  out.end();
  await once(out, "finish");
}

async function main() {
  const { input, output, stopsFile, stationsFile } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(input)) throw new Error(`Kaynak dosya yok: ${input}`);

  // Hat → yön → sıralı durak kimlikleri ve durak kimliği → konum/ad
  const lineStops = JSON.parse(fs.readFileSync(stopsFile, "utf8"));
  const stationsById = new Map(JSON.parse(fs.readFileSync(stationsFile, "utf8")).map((st) => [st.id, st]));

  /** Bir hattın duraklarını nokta olarak verir; iki yönde de geçilen durak bir kez yazılır */
  const stopFeatures = (code) => {
    const seen = new Map();
    for (const [direction, stops] of Object.entries(lineStops[code] ?? {})) {
      for (const { seq, stopId } of stops) {
        const station = stationsById.get(stopId);
        if (!station) continue; // koordinatı bozuk olduğu için veri setinden çıkarılmış durak
        const existing = seen.get(stopId);
        if (existing) {
          existing.properties.directions.push(direction);
          continue;
        }
        seen.set(stopId, {
          type: "Feature",
          properties: { kind: "stop", id: `bus-stop-${stopId}`, name: station.name, directions: [direction], seq },
          geometry: { type: "Point", coordinates: [station.lon, station.lat] },
        });
      }
    }
    return [...seen.values()];
  };

  // Klasör yoksa oluştur; varsa eski parçaları temizle (kaldırılan hatlar ortada kalmasın)
  fs.mkdirSync(output, { recursive: true });
  for (const name of fs.readdirSync(output)) {
    if (name.endsWith(".json")) fs.unlinkSync(path.join(output, name));
  }

  const index = {};
  const usedNames = new Set();
  let written = 0;
  let skipped = 0;
  let bytes = 0;

  for await (const [code, directions] of streamTopLevelEntries(input)) {
    const dirs = Object.keys(directions).filter((d) => directions[d]?.length >= 2).sort();
    if (dirs.length === 0) {
      skipped++;
      continue;
    }

    // Aynı güvenli ada düşen iki hat olursa sonuna sayı ekle
    const base = safeFileName(code);
    let name = base;
    for (let n = 2; usedNames.has(name.toLowerCase()); n++) name = `${base}-${n}`;
    usedNames.add(name.toLowerCase());

    const geojson = {
      type: "FeatureCollection",
      features: [
        ...dirs.map((dir) => ({
          type: "Feature",
          properties: { kind: "route", code, direction: dir },
          geometry: { type: "LineString", coordinates: directions[dir] },
        })),
        ...stopFeatures(code),
      ],
    };
    const text = JSON.stringify(geojson);
    await writeFileStreamed(path.join(output, `${name}.json`), text);

    index[code] = {
      file: `${name}.json`,
      directions: dirs,
      points: dirs.reduce((n, d) => n + directions[d].length, 0),
      stops: geojson.features.length - dirs.length,
      bbox: boundingBox(dirs.map((d) => directions[d])),
    };
    written++;
    bytes += Buffer.byteLength(text);
  }

  fs.writeFileSync(path.join(output, "index.json"), JSON.stringify(index) + "\n");

  const rel = path.relative(ROOT, output).replaceAll("\\", "/");
  console.log(
    `shapes: ${written} hat dosyası → ${rel}/ (${(bytes / 1048576).toFixed(1)} MB, ` +
      `ortalama ${(bytes / written / 1024).toFixed(0)} KB), ${skipped} güzergâhsız hat atlandı`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
