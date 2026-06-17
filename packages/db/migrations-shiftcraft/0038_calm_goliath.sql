ALTER TABLE "sc_shift_templates" ADD COLUMN "default_breaks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_shift_templates" ADD COLUMN "required_skill_id" uuid;