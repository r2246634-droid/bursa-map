import type { LayerDefinition, LayerId } from "./types";

export const LAYERS: LayerDefinition[] = [
  { id: "metro", label: "Metro (BursaRay)", color: "#e11d48", defaultVisible: true },
  { id: "tram", label: "Tramvay (T1–T3)", color: "#16a34a", defaultVisible: true },
  { id: "bus", label: "Otobüs Durakları", color: "#7c3aed", defaultVisible: true },
  { id: "transfer", label: "Aktarma Merkezleri", color: "#7c3aed", defaultVisible: true },
  { id: "campus", label: "Üniversite Kampüsleri", color: "#059669", defaultVisible: true },
  { id: "mall", label: "AVM'ler", color: "#ea580c", defaultVisible: true },
  { id: "hospital", label: "Hastaneler", color: "#2563eb", defaultVisible: true },
  { id: "landmark", label: "Önemli Yerler", color: "#a16207", defaultVisible: true },
  { id: "terminal", label: "Otogar", color: "#0f172a", defaultVisible: true },

  // Çevredeki yerler (nearby): harita merkezinin ~1 km çevresinde, yakınlaştırınca tüm ekranda
  { id: "market", label: "Marketler", color: "#dc2626", defaultVisible: true, nearby: true },
  { id: "school", label: "Okullar", color: "#0891b2", defaultVisible: true, nearby: true },
  { id: "kindergarten", label: "Anaokulları", color: "#db2777", defaultVisible: true, nearby: true },
  { id: "pharmacy", label: "Eczaneler", color: "#9f1239", defaultVisible: true, nearby: true },
  { id: "mosque", label: "Camiler", color: "#0d9488", defaultVisible: true, nearby: true },
  { id: "park", label: "Parklar", color: "#16a34a", defaultVisible: true, nearby: true },
  { id: "bank", label: "Banka ve ATM", color: "#4f46e5", defaultVisible: true, nearby: true },
  { id: "post", label: "PTT", color: "#ca8a04", defaultVisible: true, nearby: true },
];

export const LAYER_BY_ID = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<
  LayerId,
  LayerDefinition
>;

export const DEFAULT_VISIBLE_LAYERS = new Set<LayerId>(
  LAYERS.filter((l) => l.defaultVisible).map((l) => l.id),
);
