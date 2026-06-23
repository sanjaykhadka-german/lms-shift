ALTER TABLE "sc_visitor_signins" ADD COLUMN "brought_tools" boolean;--> statement-breakpoint
ALTER TABLE "sc_visitor_signins" ADD COLUMN "tools_description" text;--> statement-breakpoint
ALTER TABLE "sc_visitor_signins" ADD COLUMN "recent_illness" boolean;--> statement-breakpoint
ALTER TABLE "sc_visitor_signins" ADD COLUMN "illness_description" text;--> statement-breakpoint
ALTER TABLE "sc_visitor_signins" ADD COLUMN "policy_agreed" boolean;--> statement-breakpoint
ALTER TABLE "sc_visitor_signins" ADD COLUMN "policy_version" text;