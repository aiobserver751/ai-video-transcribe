CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."quality" AS ENUM('standard', 'premium');--> statement-breakpoint
CREATE TABLE "transcription_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer,
	"video_url" text NOT NULL,
	"quality" "quality" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"transcription_file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "transcription_jobs" ADD CONSTRAINT "transcription_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "transcription_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "status_idx" ON "transcription_jobs" USING btree ("status");