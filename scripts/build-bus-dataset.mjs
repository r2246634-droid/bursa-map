/**
 * BursaKart "Otobüsüm Nerede" servisinden tarayıcıda toplanan ham veriyi
 * (burulas-raw.json) proje veri setine dönüştürür:
 *
 *   node scripts/build-bus-dataset.mjs <ham-dosya.json> [sefer-saatleri.json]
 *
 * Çıktılar (data/burulas/):
 *   lines.json        — hatlar (id, kod, durak sayıları)
 *   stations.json     — tüm duraklar (id, ad, enlem, boylam)
 *   line-stops.json   — her hattın yönlere göre sıralı durakları
 *   line-shapes.json  — her hattın yönlere göre güzergâh çizgisi ([boylam, enlem] dizileri)
 *   schedules.json    — (verildiyse) her hattın yön başı kalkış saatleri, gün gün (1=Pzt … 7=Paz)
 *   bursa-otobus-veriseti.xlsx — Hatlar / Duraklar / Hat-Durak Sırası / Sefer Saatleri sayfaları
 *
 * Yön kodları: G = gidiş, D = dönüş (iki yönlü hatlar), R = ring (tek yönlü dairesel hat).
 * 238 hat G+D, 167 hat yalnızca R kullanıyor (ör. T1, 22C).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import ExcelJS from "exceljs";

const [inputPath, schedulesPath] = process.argv.slice(2);
if (!inputPath) {
  console.error("Kullanım: node scripts/build-bus-dataset.mjs <burulas-raw.json> [burulas-schedules.json]");
  process.exit(1);
}

const raw = JSON.parse(await readFile(inputPath, "utf8"));
const rawSchedules = schedulesPath ? JSON.parse(await readFile(schedulesPath, "utf8")) : null;

// Servisin arama sonuçlarında gerçek hat olmayan sistem kayıtları da geliyor
// ("Hat Seçilmemiş" #65535, "GÖREVLİ" #65536)
const SYSTEM_LINE_MIN_ID = 65535;
raw.lines = raw.lines.filter((l) => l.id < SYSTEM_LINE_MIN_ID);
const outDir = new URL("../data/burulas/", import.meta.url);
await mkdir(outDir, { recursive: true });

const DIRECTION_TR = { G: "Gidiş", D: "Dönüş", R: "Ring" };
const DIRECTION_ORDER = ["G", "D", "R"];
const byDirection = (a, b) => DIRECTION_ORDER.indexOf(a.direction) - DIRECTION_ORDER.indexOf(b.direction);

// ---- Koordinat onarımı ----
// Arama servisi (routeandstation) bazı duraklarda boylam yerine enlemi tekrar yazıyor
// (ör. 40.24526, 40.24526). Hat durak listesi (routestat) aynı durak için doğru koordinatı
// verdiğinden önce oradan onarıyoruz; onarılamayanlar veri setinden çıkarılıyor.
const inProvince = ({ lat, lon }) => lat >= 39.5 && lat <= 40.8 && lon >= 28 && lon <= 30;
const routestatCoord = new Map();
for (const stops of Object.values(raw.lineStops)) {
  for (const s of stops) if (inProvince(s)) routestatCoord.set(s.stopId, { lat: s.lat, lon: s.lon });
}
const repairedStations = [];
const droppedStations = [];
raw.stations = raw.stations.flatMap((s) => {
  if (inProvince(s)) return [s];
  const fix = routestatCoord.get(s.id);
  if (fix) {
    repairedStations.push(s.id);
    return [{ ...s, ...fix }];
  }
  droppedStations.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon });
  return [];
});

const stationsById = new Map(raw.stations.map((s) => [s.id, s]));

const lines = raw.lines.map((line) => {
  const stops = raw.lineStops[line.id] ?? [];
  const shape = raw.lineShapes[line.id] ?? {};
  const directions = [...new Set(stops.map((s) => s.direction))].sort();
  const stopsOf = (dir) =>
    stops.filter((s) => s.direction === dir).sort((a, b) => a.sequence - b.sequence);
  return {
    id: line.id,
    code: line.code,
    name: line.name,
    stopCount: Object.fromEntries(directions.map((d) => [d, stopsOf(d).length])),
    // Her yönün ilk ve son durak adı: "Vakıfköy Merkez 1 → Heykel" gibi güzergâh özeti için
    termini: Object.fromEntries(
      directions.map((d) => {
        const list = stopsOf(d);
        return [d, [list[0]?.stopName ?? "", list.at(-1)?.stopName ?? ""]];
      }),
    ),
    hasShape: Object.keys(shape).length > 0,
  };
});

const lineStops = Object.fromEntries(
  raw.lines.map((line) => {
    const stops = [...(raw.lineStops[line.id] ?? [])].sort(
      (a, b) => byDirection(a, b) || a.sequence - b.sequence,
    );
    const byDir = {};
    for (const s of stops) (byDir[s.direction] ??= []).push({ seq: s.sequence, stopId: s.stopId });
    return [line.code, byDir];
  }),
);

const lineShapes = Object.fromEntries(raw.lines.map((line) => [line.code, raw.lineShapes[line.id] ?? {}]));

// Hangi durağın hangi hatlardan geçtiği (Excel'de ve uygulamada işe yarar)
const linesByStation = new Map();
for (const line of raw.lines) {
  for (const s of raw.lineStops[line.id] ?? []) {
    const set = linesByStation.get(s.stopId) ?? new Set();
    set.add(line.code);
    linesByStation.set(s.stopId, set);
  }
}

const collator = new Intl.Collator("tr", { numeric: true });
const stations = raw.stations.map((s) => ({
  ...s,
  lines: [...(linesByStation.get(s.id) ?? [])].sort(collator.compare),
}));

const meta = {
  source: raw.meta.source,
  collectedAt: raw.meta.collectedAt,
  lineCount: lines.length,
  stationCount: stations.length,
  servedStationCount: stations.filter((s) => s.lines.length).length,
  directions: DIRECTION_TR,
  collectionErrors: raw.meta.errors,
  repairedStationCount: repairedStations.length,
  droppedStations,
};

const write = (name, data) => writeFile(new URL(name, outDir), JSON.stringify(data) + "\n");
await Promise.all([
  writeFile(new URL("meta.json", outDir), JSON.stringify(meta, null, 2) + "\n"),
  write("lines.json", lines),
  write("stations.json", stations),
  write("line-stops.json", lineStops),
  write("line-shapes.json", lineShapes),
]);

// ---- Excel ----
const wb = new ExcelJS.Workbook();
wb.creator = "Bursa Map";
wb.created = new Date();

const addSheet = (name, columns, rows) => {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns;
  ws.addRows(rows);
  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws;
};

addSheet(
  "Hatlar",
  [
    { header: "Hat Kodu", key: "code", width: 12 },
    { header: "Hat No (servis)", key: "id", width: 15 },
    { header: "Gidiş Durak Sayısı", key: "g", width: 18 },
    { header: "Dönüş Durak Sayısı", key: "d", width: 18 },
    { header: "Ring Durak Sayısı", key: "r", width: 17 },
    { header: "Güzergâh", key: "route", width: 60 },
    { header: "Güzergâh Çizgisi Var", key: "shape", width: 20 },
  ],
  lines.map((l) => {
    const dir = ["G", "D", "R"].find((d) => l.termini[d]);
    return {
      code: l.code,
      id: l.id,
      g: l.stopCount.G ?? 0,
      r: l.stopCount.R ?? 0,
      d: l.stopCount.D ?? 0,
      route: dir ? l.termini[dir].join(" → ") : "",
      shape: l.hasShape ? "Evet" : "Hayır",
    };
  }),
);

addSheet(
  "Duraklar",
  [
    { header: "Durak ID", key: "id", width: 10 },
    { header: "Durak Adı", key: "name", width: 40 },
    { header: "Enlem", key: "lat", width: 12 },
    { header: "Boylam", key: "lon", width: 12 },
    { header: "Geçen Hat Sayısı", key: "n", width: 16 },
    { header: "Geçen Hatlar", key: "lines", width: 60 },
  ],
  stations.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, n: s.lines.length, lines: s.lines.join(", ") })),
);

const stopRows = [];
for (const line of raw.lines) {
  const stops = [...(raw.lineStops[line.id] ?? [])].sort(
    (a, b) => byDirection(a, b) || a.sequence - b.sequence,
  );
  for (const s of stops) {
    stopRows.push({
      code: line.code,
      dir: DIRECTION_TR[s.direction] ?? s.direction,
      seq: s.sequence,
      stopId: s.stopId,
      name: s.stopName ?? stationsById.get(s.stopId)?.name,
      lat: s.lat,
      lon: s.lon,
    });
  }
}
addSheet(
  "Hat-Durak Sırası",
  [
    { header: "Hat Kodu", key: "code", width: 12 },
    { header: "Yön", key: "dir", width: 10 },
    { header: "Sıra", key: "seq", width: 8 },
    { header: "Durak ID", key: "stopId", width: 10 },
    { header: "Durak Adı", key: "name", width: 40 },
    { header: "Enlem", key: "lat", width: 12 },
    { header: "Boylam", key: "lon", width: 12 },
  ],
  stopRows,
);

// ---- Sefer saatleri ----
const DAY_TR = { 1: "Pazartesi", 2: "Salı", 3: "Çarşamba", 4: "Perşembe", 5: "Cuma", 6: "Cumartesi", 7: "Pazar" };
let departureCount = 0;
if (rawSchedules) {
  const firstStopName = (lineId, dir) =>
    (raw.lineStops[lineId] ?? [])
      .filter((s) => s.direction === dir)
      .sort((a, b) => a.sequence - b.sequence)[0]?.stopName ?? "";

  const schedules = {};
  const scheduleRows = [];
  for (const line of raw.lines) {
    const byDir = rawSchedules.schedules[line.id];
    if (!byDir) continue;
    for (const dir of DIRECTION_ORDER.filter((d) => byDir[d])) {
      const from = firstStopName(line.id, dir);
      (schedules[line.code] ??= {})[dir] = { from, days: byDir[dir] };
      for (const day of Object.keys(byDir[dir]).sort()) {
        const times = byDir[dir][day];
        departureCount += times.length;
        scheduleRows.push({
          code: line.code,
          dir: DIRECTION_TR[dir] ?? dir,
          from,
          day: DAY_TR[day] ?? day,
          count: times.length,
          first: times[0],
          last: times.at(-1),
          times: times.join(" "),
        });
      }
    }
  }
  await writeFile(new URL("schedules.json", outDir), JSON.stringify(schedules) + "\n");
  meta.scheduleCollectedAt = rawSchedules.meta.collectedAt;
  meta.departureCount = departureCount;
  meta.scheduleErrors = rawSchedules.meta.errors;
  await writeFile(new URL("meta.json", outDir), JSON.stringify(meta, null, 2) + "\n");

  const ws = addSheet(
    "Sefer Saatleri",
    [
      { header: "Hat Kodu", key: "code", width: 12 },
      { header: "Yön", key: "dir", width: 10 },
      { header: "Kalkış Durağı", key: "from", width: 34 },
      { header: "Gün", key: "day", width: 12 },
      { header: "Sefer Sayısı", key: "count", width: 12 },
      { header: "İlk Sefer", key: "first", width: 10 },
      { header: "Son Sefer", key: "last", width: 10 },
      { header: "Kalkış Saatleri", key: "times", width: 120 },
    ],
    scheduleRows,
  );
  ws.getColumn("times").alignment = { wrapText: true, vertical: "top" };
}

const info = wb.addWorksheet("Bilgi");
info.columns = [{ width: 28 }, { width: 80 }];
info.addRows([
  ["Kaynak", meta.source],
  ["Toplanma zamanı", meta.collectedAt],
  ["Hat sayısı", meta.lineCount],
  ["Durak sayısı", meta.stationCount],
  ["En az bir hattın geçtiği durak", meta.servedStationCount],
  ["Yön kodları", "G = Gidiş, D = Dönüş, R = Ring (tek yönlü dairesel hat)"],
  ["Toplama hataları", meta.collectionErrors.length],
  ["Onarılan durak koordinatı", meta.repairedStationCount],
  ["Koordinatı bozuk olduğu için çıkarılan durak", meta.droppedStations.length],
  ...(rawSchedules
    ? [
        ["Sefer saatleri toplanma zamanı", meta.scheduleCollectedAt],
        ["Toplam kalkış (haftalık)", meta.departureCount],
        ["Gün kodları", "1 = Pazartesi … 7 = Pazar"],
        ["Not", "Saatler hattın o yöndeki ilk durağından kalkış saatleridir. Resmi tatillerde Pazar tarifesi uygulanır."],
      ]
    : []),
]);
info.getColumn(1).font = { bold: true };

await wb.xlsx.writeFile(fileURLToPath(new URL("bursa-otobus-veriseti.xlsx", outDir)));

console.log(
  `burulas: ${meta.lineCount} hat, ${meta.stationCount} durak (${meta.servedStationCount} tanesinden hat geçiyor), ` +
    `${stopRows.length} hat-durak satırı, ${meta.collectionErrors.length} toplama hatası`,
);
