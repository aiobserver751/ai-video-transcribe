CREATE TYPE "public"."content_idea_job_type" AS ENUM('normal', 'comments');--> statement-breakpoint
CREATE TABLE "content_idea_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_type" "content_idea_job_type" NOT NULL,
	"user_id" text NOT NULL,
	"transcription_id" text NOT NULL,
	"video_url" text NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"status_message" text,
	"credits_charged" integer NOT NULL,
	"result_txt" text,
	"result_json" jsonb
);
--> statement-breakpoint
ALTER TABLE "content_idea_jobs" ADD CONSTRAINT "content_idea_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_idea_jobs" ADD CONSTRAINT "content_idea_jobs_transcription_id_transcription_jobs_id_fk" FOREIGN KEY ("transcription_id") REFERENCES "public"."transcription_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_idea_user_id_idx" ON "content_idea_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "content_idea_transcription_id_idx" ON "content_idea_jobs" USING btree ("transcription_id");--> statement-breakpoint
CREATE INDEX "content_idea_status_idx" ON "content_idea_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "content_idea_user_created_at_idx" ON "content_idea_jobs" USING btree ("user_id","created_at");