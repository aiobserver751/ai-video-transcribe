CREATE TYPE "public"."user_type" AS ENUM('normal', 'google');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "type" "user_type";