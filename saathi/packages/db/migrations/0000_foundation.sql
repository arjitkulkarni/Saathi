CREATE TABLE "access_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"record_id" uuid,
	"capability" text NOT NULL,
	"decision" text NOT NULL,
	"admitted" boolean NOT NULL,
	"reason" text NOT NULL,
	"policy_version" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_probes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" jsonb NOT NULL,
	"expected" text NOT NULL,
	"observed" text NOT NULL,
	"result" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"preview_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"incident_id" uuid,
	"actor_user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" text DEFAULT 'requested' NOT NULL,
	"expected_postconditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result" jsonb,
	"boundaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_id" uuid,
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"type" text NOT NULL,
	"params" jsonb NOT NULL,
	"expected_state_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"status" text DEFAULT 'pending_signature' NOT NULL,
	"envelope" jsonb,
	"key_id" text,
	"issued_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_count" integer DEFAULT 0 NOT NULL,
	"result" jsonb,
	"result_received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "anchor_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merkle_version" integer NOT NULL,
	"root_hex" text NOT NULL,
	"root_file" "bytea" NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anchor_batches_root_hex_unique" UNIQUE("root_hex")
);
--> statement-breakpoint
CREATE TABLE "anchor_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"checkpoint_id" uuid NOT NULL,
	"batch_id" uuid,
	"nonce_hex" text NOT NULL,
	"commitment_hex" text NOT NULL,
	"leaf_index" integer,
	"path" jsonb,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anchor_members_commitment_hex_unique" UNIQUE("commitment_hex")
);
--> statement-breakpoint
CREATE TABLE "anchor_proofs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"backend" text NOT NULL,
	"ots_bytes" "bytea",
	"status" text DEFAULT 'pending' NOT NULL,
	"calendars" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"bitcoin_height" integer,
	"block_hash" text,
	"merkle_root_hex" text,
	"verification_method" text,
	"verified_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "anchor_proofs_batch_id_unique" UNIQUE("batch_id")
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"familiar" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_reason" text,
	"created_via" text DEFAULT 'records_login' NOT NULL,
	CONSTRAINT "app_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reporter_count" integer DEFAULT 0 NOT NULL,
	"verdict" text NOT NULL,
	"summary" jsonb NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"incident_id" uuid,
	"warned_at" timestamp with time zone,
	"warned_by" text,
	"recipients" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"head_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"key_id" text NOT NULL,
	"hash" text NOT NULL,
	"signature" text NOT NULL,
	"retained_ref" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "demo_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"body" text NOT NULL,
	"is_decoy" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"confidence" text DEFAULT 'unknown' NOT NULL,
	"subject_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"device_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"integration_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"declared_by" text NOT NULL,
	"declared_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'owner_declared' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"sid" text NOT NULL,
	"username" text NOT NULL,
	"is_admin" boolean NOT NULL,
	"enabled" boolean NOT NULL,
	"staff_id" uuid,
	"is_recovery_identity" boolean DEFAULT false NOT NULL,
	"is_agent_identity" boolean DEFAULT false NOT NULL,
	"observed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"prior_state" jsonb,
	"applied_state" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"undone_by_action_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"key_version" integer NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "device_nonces" (
	"device_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"org_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_nonces_device_id_nonce_pk" PRIMARY KEY("device_id","nonce")
);
--> statement-breakpoint
CREATE TABLE "device_posture" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"checks" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"hostname" text,
	"os_version" text,
	"agent_version" text,
	"simulated" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prerequisites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capability_version" integer DEFAULT 0 NOT NULL,
	"interactive_session" jsonb,
	"spool_depth" integer DEFAULT 0 NOT NULL,
	"dropped_events" integer DEFAULT 0 NOT NULL,
	"retired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "enrollment_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"device_name" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"device_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "enrollment_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "event_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"disposition" text NOT NULL,
	"reason" text NOT NULL,
	"signal_id" uuid,
	"incident_id" uuid,
	"is_replay" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_chain_heads" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"next_intent_seq" bigint DEFAULT 1 NOT NULL,
	"last_signed_seq" bigint DEFAULT 0 NOT NULL,
	"last_hash" text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"last_checkpoint_seq" bigint DEFAULT 0 NOT NULL,
	"last_checkpoint_at" timestamp with time zone,
	"blocked_seq" bigint,
	"blocked_reason" text
);
--> statement-breakpoint
CREATE TABLE "evidence_entries" (
	"org_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"intent_id" uuid NOT NULL,
	"schema_version" integer NOT NULL,
	"type" text NOT NULL,
	"occurred_at" text NOT NULL,
	"recorded_at" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"signature" text NOT NULL,
	"key_id" text NOT NULL,
	CONSTRAINT "evidence_entries_org_id_seq_pk" PRIMARY KEY("org_id","seq")
);
--> statement-breakpoint
CREATE TABLE "evidence_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"incident_id" uuid,
	"status" text DEFAULT 'pending_signature' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"capability" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"harmful_capability" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"boundaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"text" jsonb NOT NULL,
	"actor_user_id" text,
	"action_id" uuid,
	"evidence_intent_id" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"family" text NOT NULL,
	"correlation_key" text NOT NULL,
	"title" jsonb NOT NULL,
	"urgency" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"uncertain" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"boundaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scope" jsonb NOT NULL,
	"containment" jsonb NOT NULL,
	"subject_staff_id" uuid,
	"subject_session_id" uuid,
	"subject_device_id" uuid,
	"dismissed_reason" text,
	"is_replay" boolean DEFAULT false NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"can_observe" boolean DEFAULT false NOT NULL,
	"can_enforce" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'unconnected' NOT NULL,
	"last_event_at" timestamp with time zone,
	"last_test_at" timestamp with time zone,
	"last_test_result" jsonb,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credential_ciphertext" text,
	"connector_key_hash" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integrations_connector_key_hash_unique" UNIQUE("connector_key_hash")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" text,
	"invited_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"channel" text NOT NULL,
	"kind" text NOT NULL,
	"incident_id" uuid,
	"text" jsonb NOT NULL,
	"link_path" text,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_policy" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"auto_throttle_enabled" boolean DEFAULT false NOT NULL,
	"throttle_rate_per_minute" integer DEFAULT 1 NOT NULL,
	"throttle_duration_minutes" integer DEFAULT 30 NOT NULL,
	"burst_threshold" integer DEFAULT 20 NOT NULL,
	"burst_window_seconds" integer DEFAULT 120 NOT NULL,
	"daily_limit" integer DEFAULT 100 NOT NULL,
	"consent_version" integer,
	"consented_by" text,
	"consented_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "org_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"org_type" text NOT NULL,
	"vocabulary" text DEFAULT 'generic' NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"work_start" text DEFAULT '09:00' NOT NULL,
	"work_end" text DEFAULT '18:00' NOT NULL,
	"work_days" jsonb DEFAULT '[1,2,3,4,5,6]'::jsonb NOT NULL,
	"setup_step" text DEFAULT 'organization' NOT NULL,
	"setup_complete" boolean DEFAULT false NOT NULL,
	"recovery_contact" text,
	"recovery_user_id" text,
	"notification_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retention" jsonb DEFAULT '{"telemetryDays":7,"messageImageHours":24,"reportDays":30}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_guards" (
	"org_id" uuid NOT NULL,
	"guard_key" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_guards_org_id_guard_key_pk" PRIMARY KEY("org_id","guard_key")
);
--> statement-breakpoint
CREATE TABLE "previews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid,
	"actor_user_id" text NOT NULL,
	"action_type" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state_hash" text NOT NULL,
	"policy_version" integer NOT NULL,
	"guard_keys" jsonb NOT NULL,
	"content" jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"device_id" uuid,
	"integration_id" uuid,
	"log_epoch" text,
	"channel" text,
	"native_event_id" text,
	"dedupe_key" text NOT NULL,
	"type" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_replay" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "recovery_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"steps" jsonb NOT NULL,
	"new_session_id" uuid,
	"old_session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_reason" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "report_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"artifact" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"incident_id" uuid,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"manifest_version" integer DEFAULT 1 NOT NULL,
	"manifest" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"artifact_ref" text,
	"artifact_sha256" text,
	"bundle_ref" text,
	"checkpoint_id" uuid,
	"created_by" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"rate_per_minute" integer,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"lifted_reason" text,
	"source" text NOT NULL,
	"action_id" uuid,
	"incident_id" uuid,
	"policy_version" integer,
	"warned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scam_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"reporter_user_id" text NOT NULL,
	"input_kind" text NOT NULL,
	"channel" text DEFAULT 'web' NOT NULL,
	"reviewed_text" text,
	"fingerprint" text NOT NULL,
	"campaign_key" text,
	"domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"findings" jsonb NOT NULL,
	"verdict" text NOT NULL,
	"ai_status" text DEFAULT 'not_requested' NOT NULL,
	"ai_explanation" text,
	"external_processing_consent" boolean DEFAULT false NOT NULL,
	"attachment_ref" text,
	"attachment_expires_at" timestamp with time zone,
	"reported" boolean DEFAULT false NOT NULL,
	"campaign_id" uuid,
	"text_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"family" text NOT NULL,
	"subject_key" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	"raw_event_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_replay" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"employee_code" text,
	"records_pin_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"shared_account" boolean DEFAULT false NOT NULL,
	"user_id" text,
	"offboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"chat_id" text,
	"linked_at" timestamp with time zone,
	"unlinked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_links_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "telegram_updates" (
	"update_id" bigint PRIMARY KEY NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"locale" text,
	"active_org_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_probes" ADD CONSTRAINT "action_probes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_probes" ADD CONSTRAINT "action_probes_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "actions" ADD CONSTRAINT "actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commands" ADD CONSTRAINT "agent_commands_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commands" ADD CONSTRAINT "agent_commands_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_commands" ADD CONSTRAINT "agent_commands_action_id_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_members" ADD CONSTRAINT "anchor_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_members" ADD CONSTRAINT "anchor_members_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_members" ADD CONSTRAINT "anchor_members_batch_id_anchor_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."anchor_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anchor_proofs" ADD CONSTRAINT "anchor_proofs_batch_id_anchor_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."anchor_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_reports" ADD CONSTRAINT "campaign_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_records" ADD CONSTRAINT "demo_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "demo_records" ADD CONSTRAINT "demo_records_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_accounts" ADD CONSTRAINT "device_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_accounts" ADD CONSTRAINT "device_accounts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_changes" ADD CONSTRAINT "device_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_keys" ADD CONSTRAINT "device_keys_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_nonces" ADD CONSTRAINT "device_nonces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_posture" ADD CONSTRAINT "device_posture_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_posture" ADD CONSTRAINT "device_posture_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_dispositions" ADD CONSTRAINT "event_dispositions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_dispositions" ADD CONSTRAINT "event_dispositions_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_chain_heads" ADD CONSTRAINT "evidence_chain_heads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_entries" ADD CONSTRAINT "evidence_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_intents" ADD CONSTRAINT "evidence_intents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_findings" ADD CONSTRAINT "incident_findings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_findings" ADD CONSTRAINT "incident_findings_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_history" ADD CONSTRAINT "incident_history_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_history" ADD CONSTRAINT "incident_history_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policy" ADD CONSTRAINT "org_policy_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policy_versions" ADD CONSTRAINT "org_policy_versions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_guards" ADD CONSTRAINT "policy_guards_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "previews" ADD CONSTRAINT "previews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_access_log" ADD CONSTRAINT "report_access_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restrictions" ADD CONSTRAINT "restrictions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scam_checks" ADD CONSTRAINT "scam_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_links" ADD CONSTRAINT "telegram_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_session_at_idx" ON "access_log" USING btree ("session_id","at");--> statement-breakpoint
CREATE INDEX "access_log_org_at_idx" ON "access_log" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "action_probes_action_idx" ON "action_probes" USING btree ("action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actions_org_preview_uq" ON "actions" USING btree ("org_id","preview_id");--> statement-breakpoint
CREATE UNIQUE INDEX "actions_org_idem_uq" ON "actions" USING btree ("org_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "actions_org_state_idx" ON "actions" USING btree ("org_id","state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_commands_device_nonce_uq" ON "agent_commands" USING btree ("device_id","nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_commands_action_uq" ON "agent_commands" USING btree ("action_id");--> statement-breakpoint
CREATE INDEX "agent_commands_device_status_idx" ON "agent_commands" USING btree ("device_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "anchor_members_checkpoint_uq" ON "anchor_members" USING btree ("checkpoint_id");--> statement-breakpoint
CREATE INDEX "app_sessions_org_staff_idx" ON "app_sessions" USING btree ("org_id","staff_id","status");--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_reports_open_uq" ON "campaign_reports" USING btree ("org_id","campaign_key") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "checkpoints_org_seq_uq" ON "checkpoints" USING btree ("org_id","seq");--> statement-breakpoint
CREATE INDEX "demo_records_org_idx" ON "demo_records" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "dependencies_org_idx" ON "dependencies" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_accounts_uq" ON "device_accounts" USING btree ("device_id","sid");--> statement-breakpoint
CREATE INDEX "device_changes_device_idx" ON "device_changes" USING btree ("device_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "device_keys_uq" ON "device_keys" USING btree ("device_id","key_version");--> statement-breakpoint
CREATE UNIQUE INDEX "device_posture_uq" ON "device_posture" USING btree ("device_id","revision");--> statement-breakpoint
CREATE INDEX "devices_org_idx" ON "devices" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "enrollment_codes_org_idx" ON "enrollment_codes" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_dispositions_event_uq" ON "event_dispositions" USING btree ("raw_event_id");--> statement-breakpoint
CREATE INDEX "event_dispositions_org_idx" ON "event_dispositions" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_intents_org_seq_uq" ON "evidence_intents" USING btree ("org_id","seq");--> statement-breakpoint
CREATE INDEX "evidence_intents_org_status_idx" ON "evidence_intents" USING btree ("org_id","status","seq");--> statement-breakpoint
CREATE INDEX "evidence_intents_incident_idx" ON "evidence_intents" USING btree ("org_id","incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grants_uq" ON "grants" USING btree ("org_id","staff_id","integration_id","capability");--> statement-breakpoint
CREATE INDEX "incident_findings_incident_idx" ON "incident_findings" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_findings_rule_target_uq" ON "incident_findings" USING btree ("incident_id","rule_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "incident_history_incident_idx" ON "incident_history" USING btree ("incident_id","at");--> statement-breakpoint
CREATE INDEX "incidents_org_state_idx" ON "incidents" USING btree ("org_id","state","updated_at");--> statement-breakpoint
CREATE INDEX "incidents_org_corr_idx" ON "incidents" USING btree ("org_id","family","correlation_key");--> statement-breakpoint
CREATE INDEX "integrations_org_idx" ON "integrations" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "jobs_org_idx" ON "jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_org_dedupe_uq" ON "notifications" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_org_status_idx" ON "notifications" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "org_policy_versions_uq" ON "org_policy_versions" USING btree ("org_id","version");--> statement-breakpoint
CREATE INDEX "previews_org_incident_idx" ON "previews" USING btree ("org_id","incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_org_dedupe_uq" ON "raw_events" USING btree ("org_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_device_native_uq" ON "raw_events" USING btree ("device_id","log_epoch","channel","native_event_id") WHERE device_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "raw_events_org_obs_idx" ON "raw_events" USING btree ("org_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recovery_cases_incident_open_uq" ON "recovery_cases" USING btree ("incident_id") WHERE status <> 'cancelled';--> statement-breakpoint
CREATE INDEX "report_access_log_report_idx" ON "report_access_log" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "reports_org_idx" ON "reports" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "restrictions_org_target_idx" ON "restrictions" USING btree ("org_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "restrictions_org_active_idx" ON "restrictions" USING btree ("org_id","lifted_at","expires_at");--> statement-breakpoint
CREATE INDEX "scam_checks_org_reporter_idx" ON "scam_checks" USING btree ("org_id","reporter_user_id","created_at");--> statement-breakpoint
CREATE INDEX "scam_checks_org_campaign_idx" ON "scam_checks" USING btree ("org_id","campaign_key","created_at");--> statement-breakpoint
CREATE INDEX "signals_org_subject_idx" ON "signals" USING btree ("org_id","subject_key","last_at");--> statement-breakpoint
CREATE INDEX "staff_org_idx" ON "staff" USING btree ("org_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_org_code_uq" ON "staff" USING btree ("org_id","employee_code");--> statement-breakpoint
CREATE INDEX "telegram_links_user_idx" ON "telegram_links" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_chat_active_uq" ON "telegram_links" USING btree ("chat_id") WHERE chat_id IS NOT NULL AND unlinked_at IS NULL;