CREATE TABLE "sc_document_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tracey_tenant_id" text NOT NULL,
	"document_id" uuid NOT NULL,
	"signer_app_user_id" uuid,
	"signer_email" text NOT NULL,
	"signer_full_name" text NOT NULL,
	"signature_text" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signer_ip" text,
	"signer_user_agent" text,
	"source_document_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_document_signatures_text_chk" CHECK (length("sc_document_signatures"."signature_text") between 2 and 200),
	CONSTRAINT "sc_document_signatures_hash_chk" CHECK (length("sc_document_signatures"."source_document_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "sc_documents" ADD COLUMN "requires_signature" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sc_document_signatures" ADD CONSTRAINT "sc_document_signatures_document_id_sc_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sc_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sc_document_signatures" ADD CONSTRAINT "sc_document_signatures_signer_app_user_id_users_id_fk" FOREIGN KEY ("signer_app_user_id") REFERENCES "app"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sc_document_signatures_document_idx" ON "sc_document_signatures" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "sc_document_signatures_tenant_signed_idx" ON "sc_document_signatures" USING btree ("tracey_tenant_id","signed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sc_document_signatures_document_signer_uq" ON "sc_document_signatures" USING btree ("document_id","signer_app_user_id") WHERE "sc_document_signatures"."signer_app_user_id" is not null;