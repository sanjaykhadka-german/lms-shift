ALTER TABLE "app"."invitations" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."members" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invitations_kind_chk' AND conrelid = 'app.invitations'::regclass
  ) THEN
    ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_kind_chk" CHECK ("kind" in ('employee','contractor','visitor'));
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'members_kind_chk' AND conrelid = 'app.members'::regclass
  ) THEN
    ALTER TABLE "app"."members" ADD CONSTRAINT "members_kind_chk" CHECK ("kind" in ('employee','contractor','visitor'));
  END IF;
END $$;
