/**
 * OSM / Overpass yardımcıları: veri betiklerinin (fetch-bursaray, fetch-bus) ortak kısmı.
 */

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/** lib/map-config.ts içindeki BURSA_BOUNDS ile aynı tutulmalı: [[güney, batı], [kuzey, doğu]] */
export const BURSA_BOUNDS = [
  [39.95, 28.6],
  [40.5, 29.6],
];

export const round = (n) => Math.round(n * 1e6) / 1e6;

/** GeoJSON sırasıyla [boylam, enlem] alır */
export function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

export function isInsideBursa([lng, lat]) {
  const [[south, west], [north, east]] = BURSA_BOUNDS;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}

export async function fetchOverpass(query) {
  // Overpass yoğunken 429/504 döndürebiliyor ya da bağlantı zaman aşımına uğrayabiliyor;
  // artan beklemeyle birkaç kez dene
  const MAX_ATTEMPTS = 5;
  for (let attempt = 1; ; attempt++) {
    let problem;
    try {
      const res = await fetch(OVERPASS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          // Overpass, User-Agent olmayan istekleri 406 ile reddediyor
          "User-Agent": "bursa-map-dev/0.1",
        },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) return res.json();
      if (![429, 502, 503, 504].includes(res.status)) {
        throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      problem = `HTTP ${res.status}`;
    } catch (error) {
      // fetch'in ağ hataları TypeError olarak gelir; diğerleri (ör. 400 sorgu hatası) tekrar denenmez
      if (!(error instanceof TypeError)) throw error;
      problem = error.cause?.code ?? error.message;
    }
    if (attempt >= MAX_ATTEMPTS) throw new Error(`Overpass ${MAX_ATTEMPTS} denemede yanıt vermedi (${problem})`);
    console.warn(`Overpass: ${problem}, ${attempt * 10} sn sonra tekrar denenecek…`);
    await new Promise((r) => setTimeout(r, attempt * 10_000));
  }
}

/** Overpass cevabını node/way/relation haritalarına ayırır ve sık kullanılan sorguları sunar. */
export function indexOsm(osm) {
  const nodes = new Map();
  const ways = new Map();
  const relations = new Map();
  for (const el of osm.elements) {
    if (el.type === "node") nodes.set(el.id, el);
    else if (el.type === "way") ways.set(el.id, el);
    else relations.set(el.id, el);
  }

  const nodeCoord = (id) => {
    const n = nodes.get(id);
    return [round(n.lon), round(n.lat)];
  };

  /** Güzergâhın yol parçaları (rolsüz way üyeleri), relation sırasıyla */
  const routeWays = (rel) =>
    rel.members
      .filter((m) => m.type === "way" && m.role === "" && ways.has(m.ref))
      .map((m) => ways.get(m.ref).nodes.map(nodeCoord));

  const isStopTagged = (tags) =>
    tags?.railway === "tram_stop" ||
    tags?.highway === "bus_stop" ||
    tags?.public_transport === "stop_position" ||
    tags?.public_transport === "platform";

  /**
   * Hattın durak node'ları, güzergâh sırasıyla. OSM'de durak girişi tutarsız olduğundan sırayla:
   *  1) "stop" (yoksa "platform") rollü node üyeleri (PTv2 standardı)
   *  2) rolsüz ama durak etiketli node üyeleri (T3, Burulaş otobüs hatları)
   *  3) ray/yol üzerindeki durak etiketli node'lar (T2: hiç durak üyesi yok)
   */
  const stopNodeIds = (rel) => {
    const nodeMembers = rel.members.filter((m) => m.type === "node" && nodes.has(m.ref));

    // Durak noktası (stop) tercih edilir; yoksa peron (platform)
    for (const role of ["stop", "platform"]) {
      const byRole = nodeMembers.filter((m) => m.role.startsWith(role)).map((m) => m.ref);
      if (byRole.length) return byRole;
    }

    const trackNodes = rel.members
      .filter((m) => m.type === "way" && m.role === "" && ways.has(m.ref))
      .flatMap((m) => ways.get(m.ref).nodes);
    const trackIndex = new Map(trackNodes.map((id, i) => [id, i]).reverse()); // ilk görülme sırası

    const byTag = nodeMembers.filter((m) => isStopTagged(nodes.get(m.ref).tags)).map((m) => m.ref);
    if (byTag.length) {
      // Üye sırası güvenilmez (T3); duraklar rayın üzerindeyse güzergâh sırasına diz.
      // Otobüs durakları yol kenarında (yolun node'u değil), onlarda üye sırası kalır.
      const allOnTrack = byTag.every((id) => trackIndex.has(id));
      return allOnTrack ? byTag.sort((a, b) => trackIndex.get(a) - trackIndex.get(b)) : byTag;
    }

    return [...trackIndex.keys()]
      .sort((a, b) => trackIndex.get(a) - trackIndex.get(b))
      .filter((id) => isStopTagged(nodes.get(id)?.tags));
  };

  return { nodes, ways, relations, nodeCoord, routeWays, stopNodeIds };
}

const sameCoord = (a, b) => a[0] === b[0] && a[1] === b[1];

/**
 * Relation'daki yol parçalarını sırasıyla uç uca ekler, ters duranları çevirir.
 * Bağlanamayan parça olursa yeni bir parça başlatır (sonuç MultiLineString olur).
 */
export function stitchWays(wayCoords) {
  const parts = [];
  let current = null;
  let waysInCurrent = 0;

  for (const way of wayCoords) {
    if (current && waysInCurrent === 1 && !sameCoord(current.at(-1), way[0]) && !sameCoord(current.at(-1), way.at(-1))) {
      // Parçanın ilk yolu ters yönde girilmiş olabilir: çevirip bir daha dene
      current.reverse();
    }

    if (current && sameCoord(current.at(-1), way[0])) {
      current.push(...way.slice(1));
    } else if (current && sameCoord(current.at(-1), way.at(-1))) {
      current.push(...way.slice(0, -1).reverse());
    } else {
      if (current) parts.push(current);
      current = [...way];
      waysInCurrent = 0;
    }
    waysInCurrent++;
  }
  if (current) parts.push(current);
  return mergeTouchingParts(parts);
}

/** Relation'da sırası karışık girilmiş parçaları, uçları çakışıyorsa birleştirir. */
function mergeTouchingParts(parts) {
  const result = parts.map((p) => [...p]);
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < result.length; i++) {
      for (let j = 0; j < result.length; j++) {
        if (i === j) continue;
        const a = result[i];
        const b = result[j];
        let joined = null;
        if (sameCoord(a.at(-1), b[0])) joined = [...a, ...b.slice(1)];
        else if (sameCoord(a.at(-1), b.at(-1))) joined = [...a, ...b.slice(0, -1).reverse()];
        if (joined) {
          result[i] = joined;
          result.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return result;
}

export const toLineGeometry = (parts) =>
  parts.length === 1
    ? { type: "LineString", coordinates: parts[0] }
    : { type: "MultiLineString", coordinates: parts };

/**
 * İsimden kararlı kimlik: "metro", "Bursaspor/Acemler" → "metro-bursaspor-acemler".
 * Sıra numarası yerine isim kullanıyoruz ki veri yenilenince id'ler (ör. kayıtlı yerler) bozulmasın.
 */
export function slugId(prefix, name) {
  const TR = { ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" };
  const slug = name
    .toLocaleLowerCase("tr-TR")
    .replace(/[ışğüöç]/g, (ch) => TR[ch])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-${slug}`;
}

export const ATTRIBUTION ="© OpenStreetMap katkıda bulunanlar (ODbL)";
