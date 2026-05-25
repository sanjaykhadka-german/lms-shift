-- ShiftCraft per-tenant — sc_locations geofence columns (Phase 2 #7a).
--
-- Adds the three geofence config fields used by the mobile clock-in
-- flow: latitude, longitude, and radius in metres. All nullable so
-- existing rows back-fill cleanly; a location only participates in
-- geofence resolution when ALL THREE are set.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-runs are safe.

ALTER TABLE sc_locations
  ADD COLUMN IF NOT EXISTS lat double precision;

ALTER TABLE sc_locations
  ADD COLUMN IF NOT EXISTS lng double precision;

ALTER TABLE sc_locations
  ADD COLUMN IF NOT EXISTS geofence_radius_m integer;
