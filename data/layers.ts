import type { LayerDefinition, LayerId } from "./types";

export const LAYERS: LayerDefinition[] = [
  { id: "metro", label: "Metro (BursaRay)", color: "#e11d48", defaultVisible: true },
  { id: "tram", label: "Tramvay (T1–T3)", color: "#16a34a", defaultVisible: true },
  { id: "bus", label: "Otobüs (seçili hatlar)", color: "#2563eb", defaultVisible: false },
  { id: "transfer", label: "Aktarma Merkezleri", color: "#7c3aed", defaultVisible: true },
  { id: "campus", label: "Üniversite Kampüsleri", color: "#059669", defaultVisible: true },
  { id: "mall", label: "AVM'ler", color: "#ea580c", defaultVisible: true },
  { id: "terminal", label: "Otogar", color: "#0f172a", defaultVisible: true },
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<
  LayerId,
  LayerDefinition
>;

export const DEFAULT_VISIBLE_LAYERS = new Set<LayerId>(
  LAYERS.filter((l) => l.defaultVisible).map((l) => l.id),
);
