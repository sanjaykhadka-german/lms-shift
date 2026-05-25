-- AUDIT.md Phase 2 #10 — outbound webhooks.
--
-- Public template only. Per-tenant copies created by
-- migrations/per-tenant/0037_shiftcraft_webhooks.sql.

CREATE TABLE IF NOT EXISTS "sc_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"subscription_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"request_sent_at" timestamp with time zone,
	"response_status" integer,
	"response_body_excerpt" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_webhook_deliveries_status_chk" CHECK ("sc_webhook_deliveries"."status" in ('pending','succeeded','failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sc_webhook_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"event" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_webhook_subs_url_chk" CHECK ("sc_webhook_subscriptions"."url" ~* '^https?://'),
	CONSTRAINT "sc_webhook_subs_event_chk" CHECK (length("sc_webhook_subscriptions"."event") between 1 and 80),
	CONSTRAINT "sc_webhook_subs_secret_chk" CHECK (length("sc_webhook_subscriptions"."secret") >= 16)
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'sc_webhook_subscriptions'
      AND constraint_name = 'sc_webhook_subscriptions_created_by_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "sc_webhook_subscriptions"
      ADD CONSTRAINT "sc_webhook_subscriptions_created_by_user_id_users_id_fk"
      FOREIGN KEY ("created_by_user_id") REFERENCES "app"."users"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_webhook_deliveries_tenant_idx" ON "sc_webhook_deliveries" USING btree ("tracey_tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_webhook_deliveries_sub_idx" ON "sc_webhook_deliveries" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_webhook_deliveries_status_idx" ON "sc_webhook_deliveries" USING btree ("tracey_tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sc_webhook_subs_tenant_event_idx" ON "sc_webhook_subscriptions" USING btree ("tracey_tenant_id","event","is_active");
