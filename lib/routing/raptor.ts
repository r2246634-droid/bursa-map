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
import { getNetwork, WALK_FACTOR, WALK_SPEED, walkSeconds, type Network } from "./network";
import { haversineMeters } from "./time";
import type { Journey, JourneyLeg, RoutePoint } from "./types";

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

type Label =
  | { type: "access"; meters: number }
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

function accessStops(net: Network, p: RoutePoint) {
  const near = net.nearbyStops(p.lat, p.lon, ACCESS_RADIUS_M);
  const list = near.length ? near : net.nearbyStops(p.lat, p.lon, ACCESS_RADIUS_FALLBACK_M).slice(0, 10);
  // Duraktan hiçbir desen geçmiyorsa erişim noktası olarak işe yaramaz
  return list.filter(({ stop }) => net.stopPatterns[stop].length > 0);
}

export function planJourneys(query: RouteQuery, net: Network = getNetwork()): Journey[] {
  const departuresOf = searchDepartures(net, query);
  const S = net.stops.length;
  const { from, to, time } = query;

  const access = accessStops(net, from);
  const egress = new Map(accessStops(net, to).map((e) => [e.stop, e.meters]));

  // tau[k][s]: en fazla k araçla s'ye en erken varış; best[s]: tüm turlardaki en iyisi
  const tau: Float64Array[] = [new Float64Array(S).fill(Infinity)];
  const labels: (Label | undefined)[][] = [new Array(S)];
  const best = new Float64Array(S).fill(Infinity);
  let marked = new Set<number>();

  for (const { stop, meters } of access) {
    const t = time + walkSeconds(meters);
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
      const arrival = tau[k][stop] + walkSeconds(meters);
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
    const arrival = time + walkSeconds(directMeters);
    journeys.push({
      departure: time,
      arrival,
      durationMin: Math.round((arrival - time) / 60),
      transfers: 0,
      walkMeters: meters,
      legs: [{ type: "walk", from, to, meters, departure: time, arrival }],
      tags: [],
    });
  }

  return rankJourneys(journeys);
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
  const walk = (a: RoutePoint, b: RoutePoint, straight: number): JourneyLeg => ({
    type: "walk",
    from: a,
    to: b,
    meters: Math.round(straight * WALK_FACTOR),
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
      reversed.push(walk(point(label.from), point(stop), label.meters));
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
function withTimes(legs: JourneyLeg[]): Journey {
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
  return {
    departure,
    arrival,
    durationMin: Math.round((arrival - departure) / 60),
    transfers: Math.max(0, rides.length - 1),
    walkMeters: legs.reduce((m, l) => (l.type === "walk" ? m + l.meters : m), 0),
    legs,
    tags: [],
  };
}

/**
 * Seçenekleri sıralar ve etiketler. RAPTOR turları zaten Pareto kümesi verir
 * (daha çok aktarmalı seçenek sadece daha erken varıyorsa vardır). Sıralama
 * "varış + aktarma başına ceza" ile yapılır; en hızlıdan çok geç kalanlar elenir.
 */
function rankJourneys(journeys: Journey[]): Journey[] {
  if (journeys.length === 0) return [];
  const cost = (j: Journey) => j.arrival + j.transfers * TRANSFER_PENALTY_S;
  const fastest = Math.min(...journeys.map((j) => j.arrival));
  const ranked = journeys.filter((j) => j.arrival <= fastest + 45 * 60).sort((a, b) => cost(a) - cost(b));

  const hasRide = (j: Journey) => j.legs.some((l) => l.type === "ride");
  const withRides = ranked.filter(hasRide);
  const minTransfers = Math.min(...withRides.map((j) => j.transfers));

  const fastestJourney = ranked.find((j) => j.arrival === fastest);
  fastestJourney?.tags.push("En erken varış");
  const fewestTransfers = withRides.find((j) => j.transfers === minTransfers);
  if (fewestTransfers && fewestTransfers !== fastestJourney) fewestTransfers.tags.push("En az aktarma");
  for (const j of ranked) if (!hasRide(j)) j.tags.push("Yürüyerek");

  return ranked.slice(0, 4);
}
