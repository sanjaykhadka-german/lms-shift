ALTER TABLE "sc_employees" ADD COLUMN "preferred_name" text;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "address_line" text;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "sc_employees" ADD CONSTRAINT "sc_employees_gender_chk" CHECK ("sc_employees"."gender" is null or "sc_employees"."gender" in ('female','male','non_binary','prefer_not_to_say'));