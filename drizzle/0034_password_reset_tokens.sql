-- Self-service "forgot your password" for operators. A request stores only
-- the SHA-256 of a random 32-byte token (the raw token lives solely in the
-- emailed link), expires 30 minutes later and is one-shot (used_at set on
-- success). Requesting a new link consumes any earlier unused ones.
--
-- Rollback: DROP TABLE "password_reset_tokens";

CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "password_reset_tokens_operator_id_idx" ON "password_reset_tokens" USING btree ("operator_id");
