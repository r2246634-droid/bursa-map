/**
 * BURULAŞ otobüs veri seti toplayıcı — TARAYICIDA çalışır, Node'da değil.
 *
 * Servis (bursakartapi.abys-web.com) yalnızca bursakart.com.tr sayfasından gelen isteklere
 * cevap veriyor ("invalid origin"). Bu yüzden toplama, sitenin kendi sayfasında yapılır:
 *
 *   1. Chrome'da https://www.bursakart.com.tr/wheremybus adresini açın
 *   2. F12 → Console sekmesine bu dosyanın tamamını yapıştırıp Enter'a basın
 *   3. İlerleme konsola yazılır (~10 dk). Bitince iki dosya indirilir:
 *        burulas-raw.json        (hatlar, duraklar, durak sıraları, güzergâhlar)
 *        burulas-schedules.json  (yön başı kalkış saatleri, 1=Pzt … 7=Paz)
 *   4. Proje klasöründe:
 *        node scripts/build-bus-dataset.mjs <indirilenler>/burulas-raw.json <indirilenler>/burulas-schedules.json
 *
 * İstekler sırayla (paralel değil) atılır; hata olursa artan beklemeyle 3 kez daha denenir.
 * Canlı araç verisi (realtimedata) şoför adı içerdiği için bilerek toplanmaz.
 */
(async () => {
  const BASE = "https://bursakartapi.abys-web.com/api/static/";
  const SYSTEM_LINE_MIN_ID = 65535; // "Hat Seçilmemiş", "GÖREVLİ" gibi sistem kayıtları
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const num = (v) => Math.round(parseFloat(v) * 1e6) / 1e6;
  const errors = [];

  async function api(path, body) {
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const r = await fetch(BASE + path, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body),
        });
        if (r.ok) return (await r.json()).result ?? [];
        if (attempt === 4) throw new Error("HTTP " + r.status);
      } catch (e) {
        if (attempt === 4) throw e;
      }
      await sleep(attempt * 3000);
    }
  }

  function download(name, data) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // 1) Keşif: arama servisi alt dize eşleştiriyor; her rakam/harf için arayıp birleştiriyoruz
  const keywords = [..."0123456789abcçdefgğhıijklmnoöprsştuüvyzqwx"];
  const lines = new Map();
  const stations = new Map();
  for (const [i, k] of keywords.entries()) {
    try {
      for (const x of await api("routeandstation", { keyword: k })) {
        if (x.type === "R") {
          if (x.hatNo < SYSTEM_LINE_MIN_ID) lines.set(x.hatNo, { id: x.hatNo, code: x.kod, name: x.aciklama });
        } else if (x.stationId != null) {
          stations.set(x.stationId, { id: x.stationId, name: x.stationName, lat: num(x.latitude), lon: num(x.longitude) });
        }
      }
    } catch (e) {
      errors.push({ step: "search", key: k, error: String(e) });
    }
    console.log(`[keşif] ${i + 1}/${keywords.length} — ${lines.size} hat, ${stations.size} durak`);
  }

  // 2) Her hat: yönlere göre durak sırası + güzergâh
  const lineList = [...lines.values()].sort((a, b) => a.code.localeCompare(b.code, "tr", { numeric: true }));
  const lineStops = {};
  const lineShapes = {};
  for (const [i, line] of lineList.entries()) {
    try {
      const stops = await api("routestat", { routeCode: line.id });
      lineStops[line.id] = stops.map((s) => ({
        direction: s.direction,
        sequence: s.sequence,
        stopId: s.stopId,
        stopName: s.stopName,
        lat: num(s.latitude),
        lon: num(s.longitude),
      }));
      for (const s of lineStops[line.id]) {
        if (!stations.has(s.stopId)) stations.set(s.stopId, { id: s.stopId, name: s.stopName, lat: s.lat, lon: s.lon });
      }
    } catch (e) {
      errors.push({ step: "routestat", line: line.code, id: line.id, error: String(e) });
    }
    try {
      const pts = await api("routecoordinate", { keyword: String(line.id) });
      const byDir = {};
      // Not: servis boylam alanını "logitude" diye yazıyor
      for (const p of pts.sort((a, b) => a.sequence - b.sequence)) {
        (byDir[p.routeDirection] ??= []).push([num(p.logitude), num(p.latitude)]);
      }
      lineShapes[line.id] = byDir;
    } catch (e) {
      errors.push({ step: "routecoordinate", line: line.code, id: line.id, error: String(e) });
    }
    if ((i + 1) % 25 === 0 || i + 1 === lineList.length) console.log(`[hat detayları] ${i + 1}/${lineList.length}`);
  }

  download("burulas-raw.json", {
    meta: {
      source: "bursakart.com.tr (BURULAŞ) — Otobüsüm Nerede ekranının kullandığı servis",
      collectedAt: new Date().toISOString(),
      lineCount: lineList.length,
      stationCount: stations.size,
      errors,
    },
    lines: lineList,
    stations: [...stations.values()].sort((a, b) => a.id - b.id),
    lineStops,
    lineShapes,
  });

  // 3) Sefer saatleri: her hat + yön için tek istek, 7 günün tamamını döndürüyor
  const scheduleErrors = [];
  const schedules = {};
  const tasks = lineList.flatMap((line) =>
    [...new Set((lineStops[line.id] ?? []).map((s) => s.direction))].sort().map((dir) => ({ line, dir })),
  );
  for (const [i, { line, dir }] of tasks.entries()) {
    try {
      const rows = await api("schedulebystop", { direction: dir, routeId: line.id, stopSequenceNo: 0, weekday: 0 });
      const byDay = {};
      for (const row of rows) (byDay[row.routeDay] ??= []).push(String(row.stopTime).slice(0, 5));
      for (const k of Object.keys(byDay)) byDay[k].sort();
      (schedules[line.id] ??= {})[dir] = byDay;
    } catch (e) {
      scheduleErrors.push({ line: line.code, id: line.id, dir, error: String(e) });
    }
    if ((i + 1) % 50 === 0 || i + 1 === tasks.length) console.log(`[sefer saatleri] ${i + 1}/${tasks.length}`);
  }

  download("burulas-schedules.json", {
    meta: {
      source: "bursakart.com.tr — schedulebystop (hattın yön başındaki kalkış durağı)",
      collectedAt: new Date().toISOString(),
      dayCodes: "1=Pazartesi … 7=Pazar",
      errors: scheduleErrors,
    },
    schedules,
  });

  console.log(`Bitti: ${lineList.length} hat, ${stations.size} durak, ${errors.length + scheduleErrors.length} hata`);
})();
