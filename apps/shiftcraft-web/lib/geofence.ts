// AUDIT.md Phase 2 #7a — geofence distance + nearest-match helpers.
//
// Pure functions, no DB. Server actions and (potentially) client code
// both import these; keeping them framework-free means the same logic
// can power a future offline-mobile clock surface without changes.

const EARTH_RADIUS_M = 6_371_000;

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

// Great-circle distance between two lat/lng points in metres. Uses the
// Haversine formula — accurate to better than 0.5% for distances under
// a few thousand km, which is way more headroom than a clock-in
// geofence ever needs. Returns Infinity when either point has a
// non-finite coordinate (defensive).
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  if (
    !Number.isFinite(lat1) ||
    !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) ||
    !Number.isFinite(lng2)
  ) {
    return Infinity;
  }
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// A geofence candidate — one of the tenant's sc_locations rows with
// lat/lng/radius set. Rows missing any of the three are filtered out
// at the call site before being passed in.
export interface GeofenceCandidate {
  locationId: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface GeofenceMatch {
  locationId: string;
  name: string;
  distanceM: number;
  radiusM: number;
}

// Picks the candidate the GPS point is INSIDE whose centre is closest
// to that point. Returns null when no candidate's radius contains the
// point — the caller falls back to manual location selection.
//
// Pure function — same inputs → same output. Useful in unit tests
// without a fake DB.
export function findNearestWithinRadius(
  lat: number,
  lng: number,
  candidates: ReadonlyArray<GeofenceCandidate>,
): GeofenceMatch | null {
  let best: GeofenceMatch | null = null;
  for (const c of candidates) {
    const distanceM = haversineMeters(lat, lng, c.lat, c.lng);
    if (distanceM > c.radiusM) continue;
    if (best === null || distanceM < best.distanceM) {
      best = {
        locationId: c.locationId,
        name: c.name,
        distanceM,
        radiusM: c.radiusM,
      };
    }
  }
  return best;
}
