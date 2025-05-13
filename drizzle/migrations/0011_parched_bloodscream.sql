CREATE TYPE "public"."credit_transaction_type" AS ENUM('initial_allocation', 'free_tier_refresh', 'paid_tier_renewal', 'job_failure_refund', 'manual_adjustment_add', 'caption_download', 'standard_transcription', 'premium_transcription', 'basic_summary', 'extended_summary', 'manual_adjustment_deduct');--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'failed_insufficient_credits';--> statement-breakpoint
ALTER TYPE "public"."job_status" ADD VALUE 'pending_credit_deduction';--> statement-breakpoint
ALTER TYPE "public"."quality" ADD VALUE 'caption_first' BEFORE 'standard';--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"job_id" text,
	"amount" integer NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"description" text,
	"video_length_minutes_charged" integer,
	"user_credits_before" integer NOT NULL,
	"user_credits_after" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transcription_jobs" DROP CONSTRAINT "transcription_jobs_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "transcription_jobs" ADD COLUMN "video_length_minutes_actual" integer;--> statement-breakpoint
ALTER TABLE "transcription_jobs" ADD COLUMN "credits_charged" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credits_refreshed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_job_id_transcription_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."transcription_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_transactions_user_id_idx" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_job_id_idx" ON "credit_transactions" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_type_idx" ON "credit_transactions" USING btree ("type");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "credits";