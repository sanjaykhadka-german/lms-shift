ALTER TABLE "app"."invitations" DROP CONSTRAINT "invitations_role_chk";--> statement-breakpoint
ALTER TABLE "app"."members" DROP CONSTRAINT "members_role_chk";--> statement-breakpoint
ALTER TABLE "app"."invitations" ADD CONSTRAINT "invitations_role_chk" CHECK ("app"."invitations"."role" in ('owner','admin','location_manager','lead','member'));--> statement-breakpoint
ALTER TABLE "app"."members" ADD CONSTRAINT "members_role_chk" CHECK ("app"."members"."role" in ('owner','admin','location_manager','lead','member'));