/**
 * RAPTOR (Round-bAsed Public Transit Optimized Router — Delling, Pajor, Werneck 2012).
 *
 * Dijkstra yerine RAPTOR: veri sefer saatlerinden oluşuyor ve "en az aktarma" ile "en erken
 * varış" birlikte isteniyor. RAPTOR turlar halinde çalışır; k. tur "en fazla k araçla" ulaşılan
 * en erken varışları bulur. Böylece tek aramada 0, 1, 2… aktarmalı en iyi seçenekler (Pareto
 * kümesi) çıkar; kullanıcıya hem "en hızlı" hem "en az aktarma" sunulabilir.
 *
 * Her tur:
 *   1. Önceki turda iyileşen duraklardan geçen desenleri topla (desen başına en erken sıra).
 *   2. Her deseni o sıradan itibaren tara: binilebilecek en erken seferi bul, sonraki
 *      duraklara varışları iyileştir (yerel + hedef budaması).
 *   3. İyileşen duraklardan yürüyerek aktarmaları gevşet.
 * Varış saatleri: sefer kalkışı + desenin durak süre tahmini (time.ts → estimateStopOffsets).
 */
import { journeyFare } from "./fares";
import { getNetwork, WALK_FACTOR, WALK_SPEED, type Network } from "./network";
import { haversineMeters } from "./time";
import type { Journey, JourneyLeg, RoutePoint, WalkLeg } from "./types";

/** En fazla araç sayısı (= aktarma + 1) */
const MAX_RIDES = 5;
/** Başlangıç/varış noktasından durağa en fazla bu kadar yürünür (kuş uçuşu) */
const ACCESS_RADIUS_M = 900;
/** Hiç durak yoksa arama yarıçapı bu kadar genişletilir */
const ACCESS_RADIUS_FALLBACK_M = 1800;
/**
 * Araç değiştirirken binmek için en az bu kadar zaman gerekir (saniye). Ara durak saatleri
 * tahmin olduğundan (hata hattın sonuna doğru büyür) aktarmaya cömert pay bırakılır.
 */
const TRANSFER_SLACK_S = 3 * 60;
/** Bu mesafeye kadar "sadece yürü" seçeneği de sunulur */
const WALK_ONLY_MAX_M = 2500;
/** Seçenekleri sıralarken her aktarma bu kadar dakika "pahalı" sayılır */
const TRANSFER_PENALTY_S = 5 * 60;
/**
 * Alternatif arama: bulunan her seçeneğin hatları tek tek yasaklanıp yeniden aranır
 * (findAlternatives). En fazla bu kadar RAPTOR araması yapılır…
 */
const MAX_SEARCHES = 16;
/** …ve kullanıcıya en fazla bu kadar seçenek gösterilir */
const MAX_OPTIONS = 12;
/** En hızlıdan bu kadar sonra varan seçenek gösterilmez (ör. bir sonraki seferi beklemek) */
const LATE_LIMIT_S = 60 * 60;

/** Seçenek etiketleri: her biri o ölçütte en iyi olan seçeneğe verilir */
export const JOURNEY_TAGS = {
  fastest: "En hızlı",
  shortest: "En kısa mesafe",
  cheapest: "En ucuz",
  fewestTransfers: "En az aktarma",
  leastWalking: "En az yürüme",
  walkOnly: "Yürüyerek",
} as const;

type Label =
  /** meters: yürüme mesafesi (sokak ağı veya tahmin) */
  | { type: "access"; meters: number }
  /** meters: kuş uçuşu (yürüme aktarması tahmini; sokak güzergâhı API'de sonradan eklenir) */
  | { type: "walk"; from: number; meters: number }
  | { type: "ride"; pattern: number; trip: number; board: number; alight: number };

export interface RouteQuery {
  from: RoutePoint;
  to: RoutePoint;
  /** Uygulanacak tarife günü: 1 = Pazartesi … 7 = Pazar (resmi tatilde 7, bkz. calendar.ts) */
  day: number;
  /** Çıkış saati (gece yarısından saniye) */
  time: number;
  /** Önceki/sonraki takvim gününün tarifesi (verilmezse haftanın komşu günü varsayılır) */
  previousDay?: number;
  nextDay?: number;
  /**
   * Başlangıçtan yakın duraklara / yakın duraklardan varışa gerçek yürüme mesafeleri (sokak ağı).
   * Verilmezse kuş uçuşu × WALK_FACTOR tahmini kullanılır (bkz. accessCandidates).
   */
  access?: StopWalk[];
  egress?: StopWalk[];
  /** Bu hatlar kullanılmaz (alternatif seçenek aramak için, bkz. findAlternatives) */
  bannedLines?: ReadonlySet<string>;
}

/** Bir durak ve oraya (veya oradan) yürüme mesafesi (metre) */
export interface StopWalk {
  stop: number;
  walkMeters: number;
}

const DAY = 86_400;
/** Gece yarısından sonra bu saate kadar önceki günün hâlâ yolda olan seferleri de aranır */
const AFTER_MIDNIGHT_WINDOW = 4 * 3600;
/** Bu saatten sonraki aramalarda ertesi günün (sabah) seferleri de aranır */
const EVENING_FROM = 18 * 3600;

/**
 * Bir desenin bu arama için kullanılabilir kalkışları (sıralı, saniye).
 *  - Önceki gün: gece yarısını geçip hâlâ yolda olan seferler, −24 saat kaydırılmış (ör. 23:50 → −600)
 *  - Bugün
 *  - Ertesi gün: akşam aramasında sabah seferleri, +24 saat kaydırılmış (ör. 05:30 → 106200)
 * Üç aralık örtüşmediği için birleşim zaten sıralıdır.
 */
function searchDepartures(net: Network, query: RouteQuery) {
  const { day, time } = query;
  const previousDay = query.previousDay ?? (day === 1 ? 7 : day - 1);
  const nextDay = query.nextDay ?? (day === 7 ? 1 : day + 1);
  const cache = new Map<number, number[]>();
  return (patternIndex: number): number[] => {
    let list = cache.get(patternIndex);
    if (list) return list;
    const pattern = net.patterns[patternIndex];
    const duration = pattern.offsets.at(-1) ?? 0;
    const previous =
      time < AFTER_MIDNIGHT_WINDOW
        ? (pattern.departures[previousDay] ?? []).filter((d) => d + duration > DAY).map((d) => d - DAY)
        : [];
    const next = time >= EVENING_FROM ? (pattern.departures[nextDay] ?? []).map((d) => d + DAY) : [];
    list = [...previous, ...(pattern.departures[day] ?? []), ...next];
    cache.set(patternIndex, list);
    return list;
  };
}

/** sorted[i] >= value olan en küçük i (yoksa length) */
function lowerBound(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Bir noktaya yürüme mesafesindeki, en az bir desenin geçtiği duraklar (kuş uçuşu metre).
 * API bu adayların gerçek yürüme mesafesini sokak ağından sorar.
 */
export function accessCandidates(net: Network, p: RoutePoint) {
  const near = net.nearbyStops(p.lat, p.lon, ACCESS_RADIUS_M);
  const list = near.length ? near : net.nearbyStops(p.lat, p.lon, ACCESS_RADIUS_FALLBACK_M).slice(0, 10);
  // Duraktan hiçbir desen geçmiyorsa erişim noktası olarak işe yaramaz
  return list.filter(({ stop }) => net.stopPatterns[stop].length > 0);
}

/** Sokak ağı yokken: yakın duraklara kuş uçuşu × WALK_FACTOR yürüme tahmini */
export const estimatedWalks = (net: Network, p: RoutePoint): StopWalk[] =>
  accessCandidates(net, p).map(({ stop, meters }) => ({ stop, walkMeters: meters * WALK_FACTOR }));

/**
 * Yol tarifi seçenekleri, sıralı ve etiketli: en hızlı, en ucuz, en az aktarmalı, en az
 * yürümeli… ve aradaki diğer makul seçenekler (bkz. findAlternatives, rankJourneys).
 */
export function planJourneys(query: RouteQuery, net: Network = getNetwork()): Journey[] {
  return rankJourneys(findAlternatives(query, net));
}

/** Seçeneğin kimliği: bindiği hatlar sırasıyla (aynı hatlarla farklı durak = aynı seçenek) */
const journeyKey = (j: Journey) =>
  j.legs.flatMap((l) => (l.type === "ride" ? [l.line] : [])).join(">") || "walk";

/**
 * Farklı hatlardan giden seçenekler. RAPTOR tek aramada her aktarma sayısı için sadece en
 * erken varanı verir; başka hatlarla giden ama biraz geç varan (belki daha ucuz, daha az
 * yürümeli) seçenekler çıkmaz. Bunun için bulunan her seçeneğin hatları birer birer yasaklanıp
 * yeniden aranır (genişlik öncelikli, en fazla MAX_SEARCHES arama). Aynı hat dizisiyle giden
 * seçeneklerden en erken varanı kalır.
 */
export function findAlternatives(query: RouteQuery, net: Network = getNetwork()): Journey[] {
  const found = new Map<string, Journey>();
  const base = query.bannedLines ?? new Set<string>();
  const queue: ReadonlySet<string>[] = [base];
  const tried = new Set<string>([[...base].sort().join("|")]);

  for (let searches = 0; queue.length > 0 && searches < MAX_SEARCHES; searches++) {
    const bannedLines = queue.shift()!;
    for (const journey of searchJourneys({ ...query, bannedLines }, net)) {
      const key = journeyKey(journey);
      const known = found.get(key);
      if (!known || journey.arrival < known.arrival) found.set(key, journey);
      if (known) continue; // bu hatların alternatifleri zaten kuyrukta
      for (const leg of journey.legs) {
        if (leg.type !== "ride") continue;
        const next = new Set(bannedLines).add(leg.line);
        const id = [...next].sort().join("|");
        if (tried.has(id)) continue;
        tried.add(id);
        queue.push(next);
      }
    }
  }
  return [...found.values()];
}

/** Tek RAPTOR araması: 0, 1, 2… aktarmalı en erken seçenekler + kısa mesafede sadece yürüyüş */
export function searchJourneys(query: RouteQuery, net: Network = getNetwork()): Journey[] {
  const departuresOf = searchDepartures(net, query);
  const S = net.stops.length;
  const { from, to, time } = query;

  const access = query.access ?? estimatedWalks(net, from);
  const egress = new Map((query.egress ?? estimatedWalks(net, to)).map((e) => [e.stop, e.walkMeters]));

  // tau[k][s]: en fazla k araçla s'ye en erken varış; best[s]: tüm turlardaki en iyisi
  const tau: Float64Array[] = [new Float64Array(S).fill(Infinity)];
  const labels: (Label | undefined)[][] = [new Array(S)];
  const best = new Float64Array(S).fill(Infinity);
  let marked = new Set<number>();

  for (const { stop, walkMeters: meters } of access) {
    const t = time + meters / WALK_SPEED;
    if (t < tau[0][stop]) {
      tau[0][stop] = best[stop] = t;
      labels[0][stop] = { type: "access", meters };
      marked.add(stop);
    }
  }

  let targetBest = Infinity;
  const roundTarget: { arrival: number; stop: number }[] = [];

  for (let k = 1; k <= MAX_RIDES && marked.size > 0; k++) {
    tau[k] = tau[k - 1].slice();
    labels[k] = labels[k - 1].slice();

    // 1) Taranacak desenler ve her birinde başlanacak en erken sıra
    const queue = new Map<number, number>();
    for (const stop of marked) {
      for (const { pattern, position } of net.stopPatterns[stop]) {
        if (query.bannedLines?.has(net.patterns[pattern].line)) continue;
        const current = queue.get(pattern);
        if (current === undefined || position < current) queue.set(pattern, position);
      }
    }
    marked = new Set();

    // 2) Desenleri tara
    for (const [p, startPosition] of queue) {
      const pattern = net.patterns[p];
      const departures = departuresOf(p);
      if (!departures?.length) continue;

      let trip = -1;
      let board = -1;
      for (let i = startPosition; i < pattern.stops.length; i++) {
        const stop = pattern.stops[i];

        if (trip >= 0) {
          const arrival = departures[trip] + pattern.offsets[i];
          if (arrival < Math.min(best[stop], targetBest)) {
            tau[k][stop] = best[stop] = arrival;
            labels[k][stop] = { type: "ride", pattern: p, trip, board, alight: i };
            marked.add(stop);
          }
        }

        // Bu durakta önceki turdan gelen biri daha erken bir sefere binebilir mi?
        const ready = tau[k - 1][stop];
        if (ready === Infinity) continue;
        const earliestAtStop = ready + (k > 1 ? TRANSFER_SLACK_S : 0) - pattern.offsets[i];
        if (trip >= 0 && departures[trip] <= earliestAtStop) continue;
        const candidate = lowerBound(departures, earliestAtStop);
        if (candidate < departures.length && (trip < 0 || candidate < trip)) {
          trip = candidate;
          board = i;
        }
      }
    }

    // 3) Yürüyerek aktarma (sadece bu turda araçla iyileşen duraklardan)
    for (const stop of [...marked]) {
      const label = labels[k][stop];
      if (label?.type !== "ride") continue;
      for (const fp of net.footpaths[stop]) {
        const arrival = tau[k][stop] + fp.seconds;
        if (arrival < Math.min(best[fp.to], targetBest)) {
          tau[k][fp.to] = best[fp.to] = arrival;
          labels[k][fp.to] = { type: "walk", from: stop, meters: fp.meters };
          marked.add(fp.to);
        }
      }
    }

    // Hedefe varış (son durak + yürüme); hedef budaması için en iyiyi güncelle
    for (const [stop, meters] of egress) {
      if (labels[k][stop]?.type === "access") continue; // hiç araca binmemiş
      const arrival = tau[k][stop] + meters / WALK_SPEED;
      if (arrival < targetBest) {
        targetBest = arrival;
        roundTarget[k] = { arrival, stop };
      }
    }
  }

  const journeys: Journey[] = [];
  roundTarget.forEach((target, k) => {
    if (target) journeys.push(buildJourney(net, labels, k, target.stop, egress.get(target.stop)!, query, departuresOf));
  });

  const directMeters = haversineMeters(from, to);
  if (directMeters <= WALK_ONLY_MAX_M) {
    const meters = Math.round(directMeters * WALK_FACTOR);
    journeys.push(walkOnlyJourney({ type: "walk", from, to, meters, departure: time, arrival: 0 }));
  }

  return journeys;
}

/** Sadece yürüyüş: çıkış sabit, varış mesafeye göre */
export function walkOnlyJourney(walk: WalkLeg): Journey {
  walk.arrival = walk.departure + walk.meters / WALK_SPEED;
  return {
    departure: walk.departure,
    arrival: walk.arrival,
    durationMin: Math.round((walk.arrival - walk.departure) / 60),
    transfers: 0,
    walkMeters: walk.meters,
    distanceMeters: walk.meters,
    fare: 0,
    legs: [walk],
    tags: [],
  };
}

/** Araç bacağının güzergâh uzunluğu (duraklar arası kuş uçuşu toplamı) */
function rideMeters(path: [number, number][]): number {
  let meters = 0;
  for (let i = 1; i < path.length; i++) {
    const [lon1, lat1] = path[i - 1];
    const [lon2, lat2] = path[i];
    meters += haversineMeters({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });
  }
  return meters;
}

/** Etiketleri geriye doğru izleyip yolculuğu bacaklara (yürü / bin) çevirir */
function buildJourney(
  net: Network,
  labels: (Label | undefined)[][],
  rounds: number,
  lastStop: number,
  egressMeters: number,
  { from, to }: RouteQuery,
  departuresOf: (pattern: number) => number[],
): Journey {
  const point = (stop: number): RoutePoint => {
    const s = net.stops[stop];
    return { name: s.name, lat: s.lat, lon: s.lon, stopId: s.id };
  };

  const reversed: JourneyLeg[] = [];
  let k = rounds;
  let stop = lastStop;
  // Yürüme mesafeleri kuş uçuşu × sokak katsayısı; saatleri withTimes doldurur
  const walk = (a: RoutePoint, b: RoutePoint, walkMeters: number): JourneyLeg => ({
    type: "walk",
    from: a,
    to: b,
    meters: Math.round(walkMeters),
    departure: 0,
    arrival: 0,
  });

  reversed.push(walk(point(stop), to, egressMeters));

  for (let guard = 0; guard < 4 * MAX_RIDES; guard++) {
    const label = labels[k][stop];
    if (!label) throw new Error("Yolculuk izlenemedi: etiket yok");
    if (label.type === "access") {
      reversed.push(walk(from, point(stop), label.meters));
      break;
    }
    if (label.type === "walk") {
      reversed.push(walk(point(label.from), point(stop), label.meters * WALK_FACTOR));
      stop = label.from;
      continue;
    }
    const pattern = net.patterns[label.pattern];
    const tripStart = departuresOf(label.pattern)[label.trip];
    const stopsOnRide = pattern.stops.slice(label.board, label.alight + 1);
    reversed.push({
      type: "ride",
      line: pattern.line,
      kind: pattern.kind,
      direction: pattern.direction,
      headsign: pattern.headsign,
      from: point(pattern.stops[label.board]),
      to: point(pattern.stops[label.alight]),
      departure: tripStart + pattern.offsets[label.board],
      arrival: tripStart + pattern.offsets[label.alight],
      stopCount: label.alight - label.board,
      path: stopsOnRide.map((s) => [net.stops[s].lon, net.stops[s].lat]),
      estimated: true,
    });
    stop = pattern.stops[label.board];
    k -= 1;
  }

  const legs = reversed.reverse().filter((leg) => leg.type === "ride" || leg.meters >= 20);
  return withTimes(legs);
}

/**
 * Yürüme bacaklarının saatlerini araç saatlerine göre doldurur:
 *  - ilk araçtan önceki yürüyüş (başlangıç → durak) binişe tam yetişecek şekilde geriye,
 *  - diğerleri (aktarma, son durak → varış) önceki bacağın bitişinden ileriye hesaplanır.
 * Böylece "çıkış saati" = kullanıcının evden çıkması gereken en geç saat olur.
 */
export function withTimes(legs: JourneyLeg[]): Journey {
  const firstRide = legs.findIndex((l) => l.type === "ride");
  for (let i = firstRide - 1; i >= 0; i--) {
    const leg = legs[i];
    if (leg.type !== "walk") continue;
    leg.arrival = legs[i + 1].departure;
    leg.departure = leg.arrival - leg.meters / WALK_SPEED;
  }
  for (let i = firstRide + 1; i < legs.length; i++) {
    const leg = legs[i];
    if (leg.type !== "walk") continue;
    leg.departure = legs[i - 1].arrival;
    leg.arrival = leg.departure + leg.meters / WALK_SPEED;
  }
  const rides = legs.filter((l) => l.type === "ride");
  const departure = legs[0].departure;
  const arrival = legs.at(-1)!.arrival;
  const walkMeters = legs.reduce((m, l) => (l.type === "walk" ? m + l.meters : m), 0);
  return {
    departure,
    arrival,
    durationMin: Math.round((arrival - departure) / 60),
    transfers: Math.max(0, rides.length - 1),
    walkMeters,
    distanceMeters: Math.round(walkMeters + rides.reduce((m, r) => m + rideMeters(r.path), 0)),
    fare: journeyFare(legs),
    legs,
    tags: [],
  };
}

/**
 * Seçenekleri sıralar ve etiketler. Herkes için "en iyi" farklı: kimi için süre, kimi için
 * ücret, aktarma sayısı ya da yürüme. Bu yüzden tek bir en iyi değil, makul seçeneklerin hepsi
 * (en fazla MAX_OPTIONS) döner ve her ölçütün en iyisi etiketlenir (JOURNEY_TAGS). Sıralama
 * "varış + aktarma başına ceza" ile yapılır; en hızlıdan bir saatten fazla geç kalanlar elenir.
 */
export function rankJourneys(journeys: Journey[]): Journey[] {
  if (journeys.length === 0) return [];
  const cost = (j: Journey) => j.arrival + j.transfers * TRANSFER_PENALTY_S;
  const fastest = Math.min(...journeys.map((j) => j.arrival));
  const ranked = journeys
    .filter((j) => j.arrival <= fastest + LATE_LIMIT_S)
    .sort((a, b) => cost(a) - cost(b))
    .slice(0, MAX_OPTIONS);
  for (const j of ranked) j.tags = [];

  const hasRide = (j: Journey) => j.legs.some((l) => l.type === "ride");
  const withRides = ranked.filter(hasRide);

  /**
   * Ölçütte en iyi olana etiket ver (eşitlikte sıralamada önce geleni). Birden çok aday
   * varken hepsi eşitse etiket bir şey anlatmaz: verilmez.
   */
  const award = (candidates: Journey[], value: (j: Journey) => number, tag: string) => {
    if (candidates.length === 0) return;
    const values = candidates.map(value);
    const min = Math.min(...values);
    if (candidates.length > 1 && values.every((v) => v === min)) return;
    candidates[values.indexOf(min)].tags.push(tag);
  };
  award(ranked, (j) => j.arrival, JOURNEY_TAGS.fastest);
  award(ranked, (j) => j.distanceMeters, JOURNEY_TAGS.shortest);
  // Sadece yürüyüş zaten ücretsiz ve aktarmasız: bu ölçütler araçlı seçenekler arasında
  award(withRides, (j) => j.fare, JOURNEY_TAGS.cheapest);
  award(withRides, (j) => j.transfers, JOURNEY_TAGS.fewestTransfers);
  award(withRides, (j) => j.walkMeters, JOURNEY_TAGS.leastWalking);
  for (const j of ranked) if (!hasRide(j)) j.tags.push(JOURNEY_TAGS.walkOnly);

  return ranked;
}
