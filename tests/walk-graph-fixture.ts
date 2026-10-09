import { haversineMeters } from "@/lib/routing/time";
import { WalkGraph } from "@/lib/routing/walk-graph";

/** Testler için küçük yaya ağı: düğümler [boylam, enlem], kenarlar yönsüz düğüm çiftleri */
export function graphOf(nodes: [number, number][], edges: [number, number][]): WalkGraph {
  const adjacency = nodes.map(() => [] as number[]);
  for (const [u, v] of edges) {
    adjacency[u].push(v);
    adjacency[v].push(u);
  }
  const offsets = new Uint32Array(nodes.length + 1);
  adjacency.forEach((list, i) => (offsets[i + 1] = offsets[i] + list.length));
  const targets = Uint32Array.from(adjacency.flat());
  const point = (i: number) => ({ lat: nodes[i][1], lon: nodes[i][0] });
  const lengths = Float32Array.from(adjacency.flatMap((list, u) => list.map((v) => haversineMeters(point(u), point(v)))));
  return new WalkGraph(
    Int32Array.from(nodes.map(([, lat]) => Math.round(lat * 1e6))),
    Int32Array.from(nodes.map(([lon]) => Math.round(lon * 1e6))),
    offsets,
    targets,
    lengths,
  );
}
