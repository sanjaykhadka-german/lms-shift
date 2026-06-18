ALTER TABLE "sc_employees" ADD COLUMN "emergency_contact_relationship" text;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "bank_account_name" text;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "tfn_declaration" jsonb;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "work_eligibility" jsonb;