/**
 * Yol tarifini sokak ağıyla iyileştirme — SADECE SUNUCUDA (app/api/route).
 *
 *  1. Aramadan önce: başlangıç/varış noktasına yakın durakların GERÇEK yürüme mesafeleri
 *     (OSRM table, nokta başına tek istek). RAPTOR durak seçimini bunlarla yapar; kuş uçuşu
 *     yakın ama arada otoyol/dere olan durak öne çıkmaz.
 *  2. Aramadan sonra: bulunan seçeneklerin her yürüme bacağına sokak güzergâhı (OSRM route)
 *     eklenir, mesafe ve saatler yeniden hesaplanır. Gerçek yürüyüşle aktarmaya yetişilemeyen
 *     seçenekler elenir.
 * Servis yanıt vermezse kuş uçuşu tahmin kullanılır (çağıran tarafa bildirilir).
 */
import { WALK_FACTOR, WALK_SPEED, type Network } from "./network";
import { accessCandidates, rankJourneys, withTimes, type StopWalk } from "./raptor";
import type { Journey, RoutePoint, WalkLeg } from "./types";
import { walkDistances, walkPath } from "./walking";

/** Sokaktan bu kadar uzun yürüme gerektiren durak başlangıç/varış için kullanılmaz */
const MAX_ACCESS_WALK_M = 1500;
/** Bu kısa yürüyüşler için güzergâh sorulmaz (aynı durak çevresi) */
const MIN_ROUTED_WALK_M = 25;
/** Yürüyüş biraz uzasa da aktarma bu kadar saniye geç kalınmasına tolerans gösterir */
const CONNECTION_TOLERANCE_S = 30;

/**
 * Bir noktanın yakınındaki duraklara (reverse: duraklardan noktaya) sokak üzerinden yürüme
 * mesafeleri. Servis yanıt vermezse null → RAPTOR kuş uçuşu tahmini kullanır.
 */
export async function streetAccess(net: Network, point: RoutePoint, { reverse = false } = {}): Promise<StopWalk[] | null> {
  const candidates = accessCandidates(net, point);
  if (candidates.length === 0) return null;
  const distances = await walkDistances(
    point,
    candidates.map(({ stop }) => net.stops[stop]),
    { reverse },
  );
  if (!distances) return null;

  const walks = candidates
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
export async function refineWalkLegs(journeys: Journey[], queryTime: number): Promise<RefineResult> {
  const walks = journeys.flatMap((j) => j.legs.filter((l): l is WalkLeg => l.type === "walk" && l.meters >= MIN_ROUTED_WALK_M));
  const paths = await Promise.all(walks.map((leg) => walkPath(leg.from, leg.to)));

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
