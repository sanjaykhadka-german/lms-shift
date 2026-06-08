CREATE TABLE "app"."tenant_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"app" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"seats_purchased" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_subscriptions_app_chk" CHECK ("app"."tenant_subscriptions"."app" in ('lms','shiftcraft')),
	CONSTRAINT "tenant_subscriptions_plan_chk" CHECK ("app"."tenant_subscriptions"."plan" in ('free','starter','pro','enterprise')),
	CONSTRAINT "tenant_subscriptions_status_chk" CHECK ("app"."tenant_subscriptions"."status" in ('trialing','active','past_due','canceled'))
);
--> statement-breakpoint
ALTER TABLE "app"."tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "app"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_subscriptions_tenant_app_uq" ON "app"."tenant_subscriptions" USING btree ("tenant_id","app");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_subscriptions_stripe_subscription_id_uq" ON "app"."tenant_subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE INDEX "tenant_subscriptions_stripe_customer_id_ix" ON "app"."tenant_subscriptions" USING btree ("stripe_customer_id");