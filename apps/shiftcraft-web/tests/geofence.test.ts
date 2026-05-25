import { describe, expect, it } from "vitest";
import {
  findNearestWithinRadius,
  haversineMeters,
  type GeofenceCandidate,
} from "~/lib/geofence";

// Reference coordinates used across cases. Two real Melbourne points
// chosen so the expected distances are stable + easy to eyeball:
//   - MCG centre:           -37.8200, 144.9834
//   - Federation Square:    -37.8180, 144.9690
// Driving directions show ~1.3 km between them; the great-circle
// distance is closer to 1.27 km.
const MCG = { lat: -37.82, lng: 144.9834 };
const FED = { lat: -37.818, lng: 144.969 };

describe("haversineMeters", () => {
  it("returns 0 for the same point", () => {
    expect(haversineMeters(MCG.lat, MCG.lng, MCG.lat, MCG.lng)).toBe(0);
  });

  it("matches the known ~1.27 km MCG → Fed Square distance (within 50m tolerance)", () => {
    const d = haversineMeters(MCG.lat, MCG.lng, FED.lat, FED.lng);
    expect(d).toBeGreaterThan(1220);
    expect(d).toBeLessThan(1320);
  });

  it("is symmetric (A→B == B→A)", () => {
    const ab = haversineMeters(MCG.lat, MCG.lng, FED.lat, FED.lng);
    const ba = haversineMeters(FED.lat, FED.lng, MCG.lat, MCG.lng);
    expect(Math.abs(ab - ba)).toBeLessThan(0.0001);
  });

  it("returns Infinity when any coordinate is NaN or Infinity", () => {
    expect(haversineMeters(NaN, MCG.lng, FED.lat, FED.lng)).toBe(Infinity);
    expect(haversineMeters(MCG.lat, Infinity, FED.lat, FED.lng)).toBe(Infinity);
  });

  it("handles small distances (1 metre) accurately", () => {
    // ~1 degree of latitude ≈ 111_000 m, so 0.0000090° ≈ 1 m.
    const d = haversineMeters(MCG.lat, MCG.lng, MCG.lat + 0.000009, MCG.lng);
    expect(d).toBeGreaterThan(0.5);
    expect(d).toBeLessThan(1.5);
  });
});

describe("findNearestWithinRadius", () => {
  const candidates: GeofenceCandidate[] = [
    { locationId: "mcg", name: "MCG", lat: MCG.lat, lng: MCG.lng, radiusM: 200 },
    { locationId: "fed", name: "Federation Square", lat: FED.lat, lng: FED.lng, radiusM: 500 },
  ];

  it("returns null when the point is outside every candidate's radius", () => {
    // Way outside Melbourne — Sydney CBD coordinates.
    const out = findNearestWithinRadius(-33.8688, 151.2093, candidates);
    expect(out).toBeNull();
  });

  it("returns the only matching candidate when inside one radius only", () => {
    // A point 50m north of MCG centre — well inside MCG's 200m radius
    // but ~1.3km from Fed Square (outside its 500m radius).
    const out = findNearestWithinRadius(
      MCG.lat + 0.00045,
      MCG.lng,
      candidates,
    );
    expect(out).not.toBeNull();
    expect(out!.locationId).toBe("mcg");
    expect(out!.distanceM).toBeGreaterThan(0);
    expect(out!.distanceM).toBeLessThan(200);
  });

  it("returns the nearest when the point sits in multiple radii", () => {
    // Halve the distance between MCG and Fed Square = midpoint at
    // -37.819, 144.9762. Both radii would have to cover ~650m for this
    // case to actually hit both; rather than enlarge them, place the
    // point much closer to Fed Square inside a 1km candidate radius.
    const wide: GeofenceCandidate[] = [
      { locationId: "mcg", name: "MCG", lat: MCG.lat, lng: MCG.lng, radiusM: 2000 },
      { locationId: "fed", name: "Federation Square", lat: FED.lat, lng: FED.lng, radiusM: 2000 },
    ];
    // 30m east of Fed Square centre.
    const out = findNearestWithinRadius(
      FED.lat,
      FED.lng + 0.00034,
      wide,
    );
    expect(out).not.toBeNull();
    expect(out!.locationId).toBe("fed");
  });

  it("returns null for an empty candidate list", () => {
    expect(findNearestWithinRadius(MCG.lat, MCG.lng, [])).toBeNull();
  });
});
