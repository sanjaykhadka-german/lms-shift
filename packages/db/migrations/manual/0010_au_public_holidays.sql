-- Shared AU public-holiday reference table (AUDIT.md Phase 2 #3a).
--
-- This is *not* per-tenant data. Every tenant in a given region
-- (national / NSW / VIC / QLD / WA / SA / TAS / ACT / NT) observes the
-- same days; duplicating these rows into 6+ tenant schemas would buy
-- nothing and make a state's mid-year holiday revision require touching
-- every schema.
--
-- Lives in `public` (not `app`) so the standard search_path inside
-- forTenant().run(...) reaches it without an explicit schema qualifier.
-- No RLS — read-only public reference data.
--
-- Operator-managed: invisible to drizzle.config.shiftcraft.ts (which
-- filters to `sc_*`). The seeder at packages/db/src/cli/seed-au-holidays.ts
-- is the source of truth for content; this DDL is the source of truth
-- for shape.
--
-- Idempotent: IF NOT EXISTS so re-runs are safe.

CREATE TABLE IF NOT EXISTS public.au_public_holidays (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  region        text NOT NULL,
  observed_on   date NOT NULL,
  name          text NOT NULL,
  is_national   boolean NOT NULL,
  source        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT au_public_holidays_region_chk
    CHECK (region IN ('national','NSW','VIC','QLD','WA','SA','TAS','ACT','NT'))
);

-- UNIQUE on the natural key so the seeder's ON CONFLICT clause has a
-- target. (Two different national holidays can fall on the same date in
-- rare years — Easter / ANZAC clashes — so name is part of the key.)
CREATE UNIQUE INDEX IF NOT EXISTS au_public_holidays_natural_uq
  ON public.au_public_holidays (region, observed_on, name);

-- Query path index: helpers do `where region in ('national', $tenant)
-- and observed_on between $from and $to`.
CREATE INDEX IF NOT EXISTS au_public_holidays_region_date_idx
  ON public.au_public_holidays (region, observed_on);
