-- AUDIT.md Phase 2 #12 — web push subscriptions.
--
-- Public template only. Per-tenant copies created by
-- migrations/per-tenant/0039_shiftcraft_push_subscriptions.sql.

CREATE TABLE IF NOT EXISTS "sc_push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"app_user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"last_success_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_push_subscriptions'
      AND constraint_name = 'sc_push_subscriptions_app_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_push_subscriptions"
      ADD CONSTRAINT "sc_push_subscriptions_app_user_id_users_id_fk"
      FOREIGN KEY ("app_user_id") REFERENCES "app"."users"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sc_push_subs_tenant_user_endpoint_uq" ON "sc_push_subscriptions" USING btree ("tracey_tenant_id","app_user_id","endpoint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_push_subs_user_idx" ON "sc_push_subscriptions" USING btree ("tracey_tenant_id","app_user_id");
