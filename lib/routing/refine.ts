/**
 * Yol tarifini sokak ağıyla iyileştirme — SADECE SUNUCUDA (app/api/route).
 *
 *  1. Aramadan önce: başlangıç/varış noktasına yakın durakların GERÇEK yürüme mesafeleri
 *     (yaya ağında tek Dijkstra). RAPTOR durak seçimini bunlarla yapar; kuş uçuşu yakın ama
 *     arada otoyol/dere olan durak öne çıkmaz.
 *  2. Aramadan sonra: bulunan seçeneklerin her yürüme bacağına sokak güzergâhı eklenir, mesafe
 *     ve saatler yeniden hesaplanır. Gerçek yürüyüşle aktarmaya yetişilemeyen seçenekler elenir.
 * Yaya ağı yoksa ya da nokta ağın dışındaysa kuş uçuşu tahmin kullanılır (çağırana bildirilir).
 */
import { WALK_FACTOR, WALK_SPEED, type Network } from "./network";
import { accessCandidates, planJourneys, rankJourneys, withTimes, type RouteQuery, type StopWalk } from "./raptor";
import type { Journey, RoutePoint, WalkLeg } from "./types";
import { walkDistances, walkPath } from "./walking";

/** Sokaktan bu kadar uzun yürüme gerektiren durak başlangıç/varış için kullanılmaz */
const MAX_ACCESS_WALK_M = 1500;
/** Bu kısa yürüyüşler için güzergâh sorulmaz (aynı durak çevresi) */
const MIN_ROUTED_WALK_M = 25;
/** Yürüyüş biraz uzasa da aktarma bu kadar saniye geç kalınmasına tolerans gösterir */
const CONNECTION_TOLERANCE_S = 30;

/**
 * Bir noktanın yakınındaki duraklara sokak üzerinden yürüme mesafeleri (yaya ağı yönsüz:
 * varış yürüyüşü için de aynı). Ağ yoksa null → RAPTOR kuş uçuşu tahmini kullanır.
 */
export function streetAccess(net: Network, point: RoutePoint): StopWalk[] | null {
  const candidates = accessCandidates(net, point);
  if (candidates.length === 0) return null;
  const distances = walkDistances(
    point,
    candidates.map(({ stop }) => net.stops[stop]),
  );
  if (!distances) return null;

  const walks = candidates
    // null: durak yaya ağının dışında → tahmin; Infinity: sokaktan ulaşılamıyor → elenir
    .map(({ stop, meters }, i) => ({ stop, walkMeters: distances[i] ?? meters * WALK_FACTOR }))
    .filter((w) => w.walkMeters <= MAX_ACCESS_WALK_M);
  return walks.length ? walks : null;
}

/** Saatleri yeniden hesaplanmış yolculuk hâlâ yapılabilir mi? */
function isFeasible(journey: Journey, queryTime: number): boolean {
  if (journey.departure < queryTime - CONNECTION_TOLERANCE_S) return false; // şimdiden önce çıkmak gerekirdi
  return journey.legs.every((leg, i) => {
    const next = journey.legs[i + 1];
    return !(leg.type === "walk" && next?.type === "ride" && leg.arrival > next.departure + CONNECTION_TOLERANCE_S);
  });
}

export interface RefineResult {
  journeys: Journey[];
  /** Tüm yürüme bacakları sokak ağından hesaplanabildi mi */
  allStreetRouted: boolean;
}

/** Seçeneklerin yürüme bacaklarına sokak güzergâhı ekler, saatleri yeniden hesaplar ve sıralar */
export function refineWalkLegs(journeys: Journey[], queryTime: number): RefineResult {
  const walks = journeys.flatMap((j) => j.legs.filter((l): l is WalkLeg => l.type === "walk" && l.meters >= MIN_ROUTED_WALK_M));
  // Aynı yürüyüş (ör. iki seçenekte aynı son durak → varış) bir kez aranır
  const known = new Map<string, ReturnType<typeof walkPath>>();
  const keyOf = (leg: WalkLeg) => `${leg.from.lat},${leg.from.lon};${leg.to.lat},${leg.to.lon}`;
  const paths = walks.map((leg) => {
    const key = keyOf(leg);
    if (!known.has(key)) known.set(key, walkPath(leg.from, leg.to));
    return known.get(key)!;
  });

  let allStreetRouted = true;
  walks.forEach((leg, i) => {
    const routed = paths[i];
    if (!routed) {
      allStreetRouted = false;
      return;
    }
    leg.meters = Math.round(routed.meters);
    leg.path = routed.path;
    leg.streetRouted = true;
  });

  const refined = journeys
    .map((journey) => {
      const hasRide = journey.legs.some((l) => l.type === "ride");
      if (hasRide) return withTimes(journey.legs);
      // Sadece yürüyüş: çıkış sabit, varış yeni mesafeye göre
      const [walk] = journey.legs as WalkLeg[];
      walk.arrival = walk.departure + walk.meters / WALK_SPEED;
      return { ...journey, arrival: walk.arrival, durationMin: Math.round((walk.arrival - walk.departure) / 60), walkMeters: walk.meters, tags: [] };
    })
    .filter((j) => isFeasible(j, queryTime));

  // Etiketler (en erken varış / en az aktarma) yeni saatlere göre yeniden verilir
  for (const j of refined) j.tags = [];
  return { journeys: rankJourneys(refined), allStreetRouted };
}

export interface StreetPlan extends RefineResult {
  /** Başlangıç/varış durak mesafeleri yaya ağından alınabildi mi */
  streetAccess: boolean;
}

/**
 * Sokak ağıyla tam akış:
 *  1. yakın duraklara gerçek yürüme mesafeleri (nokta ağın dışındaysa tahmin),
 *  2. RAPTOR,
 *  3. yürüme bacaklarına sokak güzergâhı ve yeni saatler.
 */
export function planWithStreetWalking(net: Network, query: RouteQuery): StreetPlan {
  const access = streetAccess(net, query.from);
  const egress = streetAccess(net, query.to);
  const journeys = planJourneys(
    { ...query, access: access ?? estimatedWalks(net, query.from), egress: egress ?? estimatedWalks(net, query.to) },
    net,
  );
  return { ...refineWalkLegs(journeys, query.time), streetAccess: access !== null && egress !== null };
}

const estimatedWalks = (net: Network, p: RoutePoint): StopWalk[] =>
  accessCandidates(net, p).map(({ stop, meters }) => ({ stop, walkMeters: meters * WALK_FACTOR }));
