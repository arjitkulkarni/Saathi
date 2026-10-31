-- Saathi security migration: runtime grants, tenant RLS, narrow SECURITY DEFINER lookups,
-- and append-only protections (build.md §4, Ph15.3; decisions D-005, D-007).
-- Runtime roles saathi_app (web) and saathi_worker (worker) are NOBYPASSRLS non-owners.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saathi_app') THEN CREATE ROLE saathi_app NOLOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saathi_worker') THEN CREATE ROLE saathi_worker NOLOGIN NOBYPASSRLS; END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO saathi_app, saathi_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO saathi_app, saathi_worker;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO saathi_app, saathi_worker;
--> statement-breakpoint
-- Library-managed authentication tables (no tenant scope).
GRANT DELETE ON "user", "session", "account", "verification" TO saathi_app;
--> statement-breakpoint
GRANT DELETE ON device_nonces, grants, dependencies, telegram_links TO saathi_app;
--> statement-breakpoint
GRANT DELETE ON device_nonces, raw_events, signals, event_dispositions, telegram_updates TO saathi_worker;
--> statement-breakpoint
-- Evidence and anchors: the web app reads; only the worker writes signed history.
REVOKE INSERT, UPDATE ON evidence_entries, checkpoints, anchor_batches, anchor_proofs FROM saathi_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE ON anchor_members FROM saathi_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_current_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_current_user() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')
$$;
--> statement-breakpoint
-- Tenant isolation on every org-owned table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'invitations','org_policy','org_policy_versions','policy_guards','staff','integrations','dependencies',
    'app_sessions','grants','restrictions','access_log','demo_records','devices','device_keys','enrollment_codes',
    'device_nonces','device_accounts','device_posture','raw_events','signals','event_dispositions','incidents',
    'incident_findings','incident_history','previews','actions','action_probes','agent_commands','device_changes',
    'recovery_cases','notifications','telegram_links','scam_checks','campaign_reports','evidence_chain_heads',
    'evidence_intents','evidence_entries','checkpoints','anchor_members','reports','report_access_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (org_id = saathi_current_org()) WITH CHECK (org_id = saathi_current_org())', t);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_member_read ON organizations FOR SELECT USING (
  id = saathi_current_org()
  OR id IN (SELECT m.org_id FROM memberships m WHERE m.user_id = saathi_current_user() AND m.status = 'active')
);
--> statement-breakpoint
CREATE POLICY org_write ON organizations FOR INSERT WITH CHECK (id = saathi_current_org());
--> statement-breakpoint
CREATE POLICY org_update ON organizations FOR UPDATE USING (id = saathi_current_org()) WITH CHECK (id = saathi_current_org());
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY membership_read ON memberships FOR SELECT USING (org_id = saathi_current_org() OR user_id = saathi_current_user());
--> statement-breakpoint
CREATE POLICY membership_write ON memberships FOR INSERT WITH CHECK (org_id = saathi_current_org());
--> statement-breakpoint
CREATE POLICY membership_update ON memberships FOR UPDATE USING (org_id = saathi_current_org()) WITH CHECK (org_id = saathi_current_org());
--> statement-breakpoint
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY own_preferences ON user_preferences USING (user_id = saathi_current_user()) WITH CHECK (user_id = saathi_current_user());
--> statement-breakpoint
-- Jobs: tenant jobs require matching context; global scheduler jobs (org_id NULL) are only
-- visible without tenant context. Claiming across tenants uses saathi_claim_jobs().
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY jobs_scope ON jobs USING (org_id IS NOT DISTINCT FROM saathi_current_org()) WITH CHECK (org_id IS NOT DISTINCT FROM saathi_current_org());
--> statement-breakpoint
-- ------------------------------------------------------------------ narrow tenant resolvers
CREATE OR REPLACE FUNCTION saathi_device_auth(p_device_id uuid)
RETURNS TABLE(org_id uuid, status text, simulated boolean, key_version integer, secret_ciphertext text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d.org_id, d.status, d.simulated, k.key_version, k.secret_ciphertext
  FROM devices d JOIN device_keys k ON k.device_id = d.id AND k.status = 'active'
  WHERE d.id = p_device_id
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_enrollment_lookup(p_code_hash text)
RETURNS TABLE(org_id uuid, code_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.org_id, e.id FROM enrollment_codes e WHERE e.code_hash = p_code_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_app_session_lookup(p_token_hash text)
RETURNS TABLE(org_id uuid, session_id uuid, staff_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.org_id, s.id, s.staff_id FROM app_sessions s WHERE s.token_hash = p_token_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_invitation_lookup(p_token_hash text)
RETURNS TABLE(org_id uuid, invitation_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.org_id, i.id FROM invitations i WHERE i.token_hash = p_token_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_telegram_code_lookup(p_code_hash text)
RETURNS TABLE(org_id uuid, link_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.org_id, l.id FROM telegram_links l WHERE l.code_hash = p_code_hash
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_telegram_chat_lookup(p_chat_id text)
RETURNS TABLE(org_id uuid, user_id text, link_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT l.org_id, l.user_id, l.id FROM telegram_links l WHERE l.chat_id = p_chat_id AND l.unlinked_at IS NULL
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_connector_lookup(p_key_hash text)
RETURNS TABLE(org_id uuid, integration_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT i.org_id, i.id FROM integrations i WHERE i.connector_key_hash = p_key_hash AND i.revoked_at IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION saathi_device_auth(uuid), saathi_enrollment_lookup(text), saathi_app_session_lookup(text),
  saathi_invitation_lookup(text), saathi_telegram_code_lookup(text), saathi_telegram_chat_lookup(text), saathi_connector_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION saathi_device_auth(uuid), saathi_enrollment_lookup(text), saathi_app_session_lookup(text),
  saathi_invitation_lookup(text), saathi_telegram_code_lookup(text), saathi_telegram_chat_lookup(text), saathi_connector_lookup(text) TO saathi_app;
--> statement-breakpoint
-- ------------------------------------------------------------------ worker job lifecycle
CREATE OR REPLACE FUNCTION saathi_claim_jobs(p_worker text, p_limit integer, p_lease_seconds integer)
RETURNS TABLE(id uuid, org_id uuid, type text, payload jsonb, attempts integer, max_attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT j.id FROM jobs j
    WHERE (j.status = 'queued' AND j.run_at <= now())
       OR (j.status = 'leased' AND j.lease_expires_at < now())
    ORDER BY j.run_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE jobs j SET status = 'leased', lease_owner = p_worker,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    attempts = j.attempts + 1, updated_at = now()
  FROM due WHERE j.id = due.id
  RETURNING j.id, j.org_id, j.type, j.payload, j.attempts, j.max_attempts;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_job_succeed(p_id uuid, p_worker text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE jobs SET status = 'done', completed_at = now(), updated_at = now(), lease_owner = NULL, lease_expires_at = NULL, last_error = NULL
  WHERE id = p_id AND lease_owner = p_worker AND status = 'leased';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_job_fail(p_id uuid, p_worker text, p_error text, p_retry_at timestamptz, p_dead boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  UPDATE jobs SET status = CASE WHEN p_dead THEN 'failed' ELSE 'queued' END,
    run_at = COALESCE(p_retry_at, now()), last_error = left(p_error, 2000), updated_at = now(), lease_owner = NULL, lease_expires_at = NULL
  WHERE id = p_id AND lease_owner = p_worker AND status = 'leased';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_worker_org_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM organizations
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_queue_stats() RETURNS TABLE(status text, n bigint, oldest_due timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT status, count(*), min(run_at) FROM jobs GROUP BY status
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION saathi_claim_jobs(text, integer, integer), saathi_job_succeed(uuid, text),
  saathi_job_fail(uuid, text, text, timestamptz, boolean), saathi_worker_org_ids(), saathi_queue_stats() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION saathi_claim_jobs(text, integer, integer), saathi_job_succeed(uuid, text),
  saathi_job_fail(uuid, text, text, timestamptz, boolean), saathi_worker_org_ids(), saathi_queue_stats() TO saathi_worker;
--> statement-breakpoint
-- Operations status (counts only, no tenant data) for owners' status page.
GRANT EXECUTE ON FUNCTION saathi_queue_stats() TO saathi_app;
--> statement-breakpoint
-- ------------------------------------------------------------------ append-only protections
CREATE OR REPLACE FUNCTION saathi_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['evidence_entries','incident_history','access_log','org_policy_versions','action_probes'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION saathi_append_only()', t || '_append_only', t);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_checkpoint_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'checkpoints are append-only' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF (NEW.org_id, NEW.seq, NEW.head_hash, NEW.created_at, NEW.key_id, NEW.hash, NEW.signature, NEW.is_sample)
     IS DISTINCT FROM (OLD.org_id, OLD.seq, OLD.head_hash, OLD.created_at, OLD.key_id, OLD.hash, OLD.signature, OLD.is_sample)
     OR OLD.retained_ref IS NOT NULL THEN
    RAISE EXCEPTION 'signed checkpoint fields are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER checkpoints_guard BEFORE UPDATE OR DELETE ON checkpoints FOR EACH ROW EXECUTE FUNCTION saathi_checkpoint_guard();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saathi_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'evidence intents cannot be deleted' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF (NEW.org_id, NEW.seq, NEW.type, NEW.occurred_at, NEW.payload, NEW.incident_id)
     IS DISTINCT FROM (OLD.org_id, OLD.seq, OLD.type, OLD.occurred_at, OLD.payload, OLD.incident_id) THEN
    RAISE EXCEPTION 'evidence intent content is immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'signed' AND NEW.status <> 'signed' THEN
    RAISE EXCEPTION 'signed intents cannot change status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_intents_guard BEFORE UPDATE OR DELETE ON evidence_intents FOR EACH ROW EXECUTE FUNCTION saathi_intent_guard();
--> statement-breakpoint
-- Default privileges for tables created by later migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO saathi_app, saathi_worker;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO saathi_app, saathi_worker;
