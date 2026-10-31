ALTER TABLE "incidents" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "decided_version" integer;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "decided_finding_ids" jsonb;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "decided_response" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "decided_by_user_id" text;