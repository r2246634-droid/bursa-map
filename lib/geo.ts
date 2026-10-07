/** Leaflet sırasıyla [enlem, boylam] iki nokta arası kuş uçuşu mesafe (metre). */
export function haversineMeters([lat1, lng1]: [number, number], [lat2, lng2]: [number, number]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(a));
}

const kmFormat = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 });

/** 850 → "850 m", 4230 → "4,2 km" */
export function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${kmFormat.format(meters / 1000)} km`;
}
