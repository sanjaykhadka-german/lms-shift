ALTER TABLE "sc_locations" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "sc_locations" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "sc_locations" ADD COLUMN "geofence_radius_m" integer;