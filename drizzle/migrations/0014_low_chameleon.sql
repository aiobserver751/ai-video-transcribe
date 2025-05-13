ALTER TABLE "users" RENAME COLUMN "pending_subscription_tier" TO "createdAt";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "subscription_cancelled_at_period_end" SET NOT NULL;