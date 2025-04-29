CREATE TYPE "public"."api_key_type" AS ENUM('system', 'user');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"user_id" integer NOT NULL,
	"type" "api_key_type" NOT NULL,
	"name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_unique" UNIQUE("key")
);
--> statement-breakpoint
DROP INDEX "user_id_idx";--> statement-breakpoint
DROP INDEX "status_idx";--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "key_idx" ON "api_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "api_key_user_id_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_user_id_idx" ON "transcription_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "job_status_idx" ON "transcription_jobs" USING btree ("status");