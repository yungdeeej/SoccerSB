/**
 * Geographic utilities — travel-burden inputs for the Tactician and Quant.
 */

const EARTH_RADIUS_KM = 6371;
const KM_TO_MILES = 0.621371;

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Haversine distance in kilometers between two coordinates. */
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Haversine distance in miles. */
export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineDistance(lat1, lng1, lat2, lng2) * KM_TO_MILES;
}
