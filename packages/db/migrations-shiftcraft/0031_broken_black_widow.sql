ALTER TABLE "sc_employees" DROP CONSTRAINT IF EXISTS "sc_employees_employment_type_chk";--> statement-breakpoint
ALTER TABLE "sc_employees" ALTER COLUMN "employment_type" SET DEFAULT 'full_time';--> statement-breakpoint
ALTER TABLE "sc_employees" ADD CONSTRAINT "sc_employees_employment_type_chk" CHECK ("sc_employees"."employment_type" in ('full_time','part_time','casual','contractor'));