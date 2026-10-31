# Saathi implementation matrix

Sources: [build.md](../../build.md) (B), [flow.md](../../flow.md) (F), [frontend.md](../../frontend.md) (FE), [idea.pdf](../../idea.pdf) (P, page numbers), [skills.md](../../skills.md) (S).

Status vocabulary: **Not started** / **In progress** / **Implemented, unverified** / **Verified** / **Blocked**. "Verified" requires the evidence named in the Verification column to exist in [verification.md](verification.md).

Abbreviations: O owner, A approver, St staff, Au auditor, Ag device agent. "gw" = records gateway. Every API row implies: Zod validation, `requireActor` + membership/role check, `withOrgTransaction` (RLS tenant context), `{data,requestId}` / `{error}` envelope, `Cache-Control: private, no-store`.

## 1. Foundation, identity and tenancy

| ID | Requirement | Sources | User / route | UI and non-success states | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| FND-01 | Isolated `saathi/` pnpm workspace with apps/web, apps/worker, apps/agent and shared packages | B§2, S§3 | — | N/A | packages/* | N/A | N/A | `pnpm typecheck` | Verified |
| FND-02 | Env validation; `.env.example` with names only; fail clearly when required settings missing; no secrets in client bundle | B Ph01 | — | Startup error text | `packages/contracts/env` | N/A | N/A | Unit test + bundle grep | Verified (bundle scan) |
| FND-03 | Real PostgreSQL with separate migrator/app/worker roles; app roles without BYPASSRLS | B§4 | — | N/A | `packages/db` | roles, migrations | Neon (blocked: no credentials → local PG 18) | Integration test of role attributes | Verified |
| FND-04 | RLS on every tenant table using transaction-local `app.org_id` set from authenticated membership | B§4, P11 | — | N/A | `withOrgTransaction` | RLS policies | — | Integration: cross-tenant read with forged context returns 0 rows | Verified |
| FND-05 | Scripts `dev:web`, `dev:worker`, `dev:agent`, `db:migrate`, `db:seed`, `test`, `test:integration`, `test:e2e`, `typecheck`, `build` | B Ph01 | — | N/A | package.json | N/A | N/A | Each script runs | Verified |
| ID-01 | Better Auth email/password with database sessions; fresh server-side session validation on sensitive operations (no cookie cache) | B Ph02 | All / `/login` | Form errors, expired session preserves destination | `/api/auth/[...all]`, `requireActor` | user/session/account/verification | — | Integration: revoked session rejected | Verified |
| ID-02 | Organization creation transactionally creates org + owner membership + policy + guards | B Ph02, F§4.1 | O / `/onboarding` | Step errors, resumable step | `POST /api/v1/organizations` | organizations, memberships, org_policy, policy_guards | — | Integration | Implemented, unverified |
| ID-03 | Onboarding collects type, name, language, timezone, working hours, notification preferences, recovery identity; auto-guard consent separate | B Ph02, F§4.1–4.6, FE§7 | O / `/onboarding` → `/app/overview` | Progress, resumable, validation | organizations PATCH, policy service | organizations.setup_step | Telegram (optional) | E2E | Implemented, unverified |
| ID-04 | Organization switcher; every deep link checked against current membership | F§2, FE§5 | All / shell | Authorization state with safe return | `listMemberships`, active-org cookie | memberships | — | E2E cross-org deep link | Verified |
| ID-05 | Invitations: expiring, one-use, role-scoped; accept creates membership | B§6 | O / settings members | Expired/used invite messages | `POST /api/v1/invitations`, accept | invitations | Email not configured → link shown once to owner | Integration | Implemented, unverified |
| ID-06 | Member role/status change; authority rechecked on every request (role revoked mid-flow → denied) | B§6, B§7 | O / settings | "You no longer have permission" | `GET/PATCH /api/v1/members/:id` | memberships.version | — | Integration: approver revoked between preview and approval | Verified |
| ID-07 | Role destinations: O/A → overview, St → ask, Au → evidence/reports; incomplete setup → onboarding | F§2, FE§5 | All | — | landing resolver | — | — | E2E | Verified |
| ID-08 | Staff cannot invoke approver endpoints; auditor read-only | B Ph02, B§7 | St, Au | 403 FORBIDDEN | role policy table | — | — | Integration | Verified |
| ID-09 | Dependency declarations (workstation runs billing, shared accounts, app connected/read-only/unconnected) tagged owner-declared with date/confidence | B Ph02, F§4.2 | O / onboarding, people | Unknown confidence allowed | dependencies service | dependencies | — | Integration | Implemented, unverified |
| ID-10 | New organization shows zero coverage, "No sources connected yet", never "all safe" | B Ph02, F§4.1, FE§6.1 | O / overview | Empty state | overview service | — | — | E2E | Implemented, unverified |
| ID-11 | Same-origin/CSRF check on browser mutations; client-supplied org ID treated as selector only | B§3 | All | 403 | `assertSameOrigin` | — | — | Integration | Verified |
| ID-12 | Recovery identity kept so containment cannot lock out all administrators | B§1 | O | — | organizations.recovery_contact; agent protects recovery account | — | Agent | Unit (agent guard) | Verified (agent unit) |

## 2. Durable work, evidence intent and jobs

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| JOB-01 | State change + evidence intent + outbox job inserted atomically; critical mutation fails if intent write fails | B Ph03 | — | — | `recordIntent`, `enqueue` in same tx | evidence_intents, jobs | — | Integration: forced intent failure rolls back action | Implemented, unverified (forced intent failure not tested) |
| JOB-02 | Worker claims due jobs with `FOR UPDATE SKIP LOCKED`, writes lease, commits, does I/O outside tx | B Ph03 | — | — | `claim_jobs()` | jobs | — | Integration: two workers never claim same job | Verified (lease reclaim); two-worker race not separately tested |
| JOB-03 | Bounded exponential backoff + jitter, lease expiry returns work, idempotent handlers, visible failed-job queue | B Ph03 | O / settings → operations | Failed jobs listed | worker runtime | jobs | — | Integration: crash mid-job → reclaimed after lease | Verified |
| JOB-04 | Scheduler: reminders, stale-agent assessment, throttle expiry, digest, anchor upgrades; no `after()` as queue | B Ph03 | — | — | worker scheduler | jobs (dedupe keys) | — | Integration | Verified (throttle expiry); other schedules unverified |
| JOB-05 | Kill/restart worker during notification and evidence task: no lost event, no double command | B Ph03 gate | — | — | — | — | — | Manual + integration | Verified (lease reclaim, integration); manual kill not run |

## 3. Protected records application and policy

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| REC-01 | `/workspace/records` reference app, clearly labelled synthetic, separate from console, own sessions | B Ph04, F§3, FE§7 | Records staff / `/workspace/records` | Signed-out, denied, throttled, unavailable | records session API | app_sessions, demo_records | — | E2E | Verified |
| REC-02 | Pure `authorize(snapshot, request)` → allow/deny/throttle with reason + version | B Ph04, P12 | — | — | `packages/domain/authorize` | — | — | Unit + property tests | Verified |
| REC-03 | Every protected download passes the gateway; no permanent object URLs | B Ph04 | Records session / `GET /api/v1/records/:id/download` | 403/429/503 messages | gateway service | access_log | — | Integration | Verified |
| REC-04 | Guard-row protocol: org guard (share/update) → subject guards (sorted) → preview; used by session create/revoke, grant change, approval, protected requests | B Ph04, B Ph08, P12 | — | — | `lockGuards` | policy_guards | — | Integration race tests | Verified |
| REC-05 | Atomic rate budget reserved before serving; concurrent burst cannot over-admit | B Ph04, B§7 | — | 429 | gateway | access_log under subject guard | — | Integration: 50 concurrent requests | Verified |
| REC-06 | Burst rule (20/120s or 100/day per session) applies consented throttle (1/min, 30 min) in same tx and enqueues incident processing; without consent raises review event only | B Ph04, B Ph06, F§6A | — | "Downloads temporarily limited until …" | gateway + policy | restrictions, raw_events, jobs | — | Integration | Verified |
| REC-07 | Database unavailable → protected request returns 503 (fail closed), never bypass | B Ph04 gate, F§13 | — | "Service temporarily unavailable" | gateway | — | — | Integration with unreachable DB URL | Verified |
| REC-08 | Paused/revoked sessions denied; legitimate session keeps working; old tokens fail | B Ph04 gate, B§7 | — | — | gateway | — | — | Integration + E2E | Verified |
| REC-09 | Former staff (offboarded subject) request denied and recorded | B Ph06, F§8 | — | — | authorize + event | raw_events | — | Integration | Verified |
| REC-10 | Decoy record access raises review signal (never proof of intent) | B Ph06 | — | — | rule | signals | — | Integration | Implemented, unverified |

## 4. Devices, ingestion, correlation

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| DEV-01 | Owner generates short-lived one-use enrollment code; hash stored, shown once | B Ph05, F§4.3 | O / `/app/devices` Add device | Code expiry countdown (display only) | `POST /api/v1/enrollment-codes` | enrollment_codes | — | Integration | Verified |
| DEV-02 | Agent enrolls; code consumed atomically; reuse rejected; device secret stored encrypted (server) and protected on device | B Ph05 | Ag / `POST /api/v1/agent/enroll` | Device card "Waiting for agent" → "Connected" | enroll service | devices, device_keys | Windows agent | Integration + live agent | Verified |
| DEV-03 | HMAC request signing over method, path, timestamp, nonce, body hash; time window, key version, nonce uniqueness, size, status | B Ph05 | Ag | — | `verifyDeviceRequest` | device_nonces | Agent | Integration: spoofed/replayed request rejected | Verified |
| DEV-04 | Bounded batch ingest, dedupe, processing jobs in same tx, accepted cursors acknowledged | B Ph05 | Ag / `POST /api/v1/agent/events` | — | ingest service | raw_events, jobs | Agent | Integration: duplicate batch safe | Verified |
| DEV-05 | Agent spool with size cap + dropped counter; bookmarks incl. log epoch; observed vs received time | B Ph05 | Ag | Delay shown on device | agent spool | agent state files | Agent | Agent unit test | Verified |
| DEV-06 | Heartbeat separate from events; UI distinguishes silent-healthy vs disconnected | B Ph05, F§4.3 | O / devices | Fresh / stale / offline labels | `POST /api/v1/agent/heartbeat` | devices.last_seen_at | Agent | Integration | Verified |
| DEV-07 | Device list & detail: last seen, posture, accounts, observations, supported actions with reasons for unsupported, action history, retirement | F§3, FE§7 | O,A / `/app/devices`, `/app/devices/[id]` | Loading/empty/stale/unauthorized | `GET /api/v1/devices`, `/:id` | devices, device_posture, device_accounts | — | E2E | Verified |
| COR-01 | Normalize to versioned types (auth.failed … message.reported) | B Ph06 | — | — | `normalize` | signals | — | Unit | Verified |
| COR-02 | Exact dedupe; repeated failures aggregated with counts retained | B Ph06 | — | — | `correlate` | signals.count | — | Unit | Verified |
| COR-03 | Disposition for every event (correlated/aggregated/digest/informational/rejected) with reason; funnel inspectable | B Ph06, F§5 | O / overview funnel | Expandable funnel | dispositions | event_dispositions | — | Integration replay | Verified |
| COR-04 | Working-hours/known-device baseline lowers priority only; never suppresses malware, offboarded access, threshold breaches | B Ph06 | — | — | rules | — | — | Unit | Verified |
| COR-05 | Device-security family groups failed logins + nearby storage; findings keep own boundaries | B Ph06, F§7 | — | Multiple findings on one incident | correlate | incidents, incident_findings | — | Unit | Implemented, unverified |
| COR-06 | Narrow suppression of expected effects of a specific Saathi command within a bounded window | B Ph06 | — | — | correlate | — | — | Unit | Verified |
| COR-07 | Nine rule presets (password guessing, possible compromise, removable media, bulk records, former staff, decoy, unresolved malware, protection disabled, repeated scam) with versions and urgency tiers | B Ph06 table | — | Urgency tiers | rules | incidents.rule_version | — | Unit per rule + replay | Verified for 7/9 rules; decoy and protection_disabled unverified |
| COR-08 | Labelled replay explains every count; normal-day replay measures false alerts; slow extraction miss recorded | B Ph06 gate, B§7 | O / `/demo` | REPLAY badge | `POST /api/v1/demo/replays` | raw_events.is_replay | — | Evaluation run in verification.md | Verified (A16/A17 measured) |

## 5. Preview, approval, actions, probes

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| PRV-01 | Snapshot of subjects, sessions, grants, devices, restrictions, declared dependencies with freshness and coverage gaps | B Ph07 | — | Snapshot timestamp | `loadSnapshot` | — | — | Integration | Verified |
| PRV-02 | Pure `applyActionToSnapshot`; consequences partitioned stops/limits/keepsWorking/unknown/cannotControl/undo | B Ph07, P6 | — | — | `packages/domain/preview` | — | — | Property tests | Verified |
| PRV-03 | Least-disruptive supported recommendation; say so when none meets objective | B Ph07 | A / incident | "No supported action meets this goal" | `recommend` | — | — | Unit | Verified |
| PRV-04 | Preview stored with actor, params, state hash, policy version, guard revisions, expiry | B Ph07 | A / `POST /api/v1/incidents/:id/previews`, `/access/previews`, `/devices/:id/previews` | — | preview service | previews | — | Integration | Verified |
| PRV-05 | Missing dependencies → "Impact on unconnected applications is unknown" | B Ph07, F§6D | A / preview | Unknown panel always visible | preview | — | — | Unit | Verified |
| APR-01 | Browser submits only previewId + idempotency key | B Ph08 | A / `POST /api/v1/actions` | — | actions service | actions unique(org,preview), unique(org,key) | — | Integration | Verified |
| APR-02 | Transactional recheck: role, preview lock, guards, expiry, relevant state; 409 STALE_PREVIEW when relevant state changed; unrelated changes don't invalidate | B Ph08, F§6E | A / preview page | "The situation changed. Review the updated effects." | actions service | — | — | Integration races (new session vs approval; unrelated session) | Verified |
| APR-03 | Duplicate taps return the same action | B Ph08 | A | — | idempotency | — | — | Integration concurrency | Verified |
| APR-04 | Revoked approver fails; expired preview rejected | B Ph08 | A | Permission state | — | — | — | Integration | Verified |
| APR-05 | Side-effect-free probe of committed authorization: target denied, other session still permitted | B Ph08, F§6F | A / `/app/actions/[id]` | Selected session stopped / other session permitted / Not checked | probe service | action_probes | gw | Integration + E2E | Verified |
| APR-06 | Containment recomputed from all findings; partial fix keeps incident open/investigating; injected failure cannot yield contained | B Ph08, B§7 | A / incident | Contained vs action confirmed shown separately | `assessContainment` | incidents.containment | — | Integration | Verified |
| APR-07 | Action states requested→queued→executing→confirmed/partial/failed/unknown; expired/cancelled; unknown reconciled, never blind rerun | B§3 | A / action page | All states with equal care | contracts enum | actions | — | Unit (transition table) | Verified |
| APR-08 | Records actions: pause session, disable connected-app account (connector semantics), offboard subject | B§7, F§6D, F§8 | A / preview | Connector semantics shown | actions | restrictions, staff, app_sessions | gw | Integration | Verified (pause, disable); offboard unverified |
| APR-09 | Standalone preview route `/app/previews/[previewId]` for people/device/health actions | F§3 | A | Same component | preview service | — | — | E2E | Verified |

## 6. Windows agent and device commands

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| WIN-01 | Adapters expose supports/preview/executeDesiredState/probe/recover/boundaries; no arbitrary script/path/command | B Ph09 | Ag | — | agent adapters | — | Windows | Agent unit tests | Verified (unit) |
| WIN-02 | Command envelope signed (Ed25519, dedicated command key) over canonical bytes; agent checks target, signature, allow-list, params, expiry, expected state, persistent replay ledger | B Ph09 | Ag / `GET /api/v1/agent/commands` | — | contracts `CommandEnvelope` | agent_commands | Agent | Agent unit tests: tamper/expired/wrong device/replay | Verified |
| WIN-03 | Worker signs commands; short expiry (60 s); offline device → "Cannot apply now"; expiry needs fresh approval | B Ph09, F§7 | A / action page | Device offline. Last seen … | command.sign job | agent_commands | — | Integration | Verified |
| WIN-04 | Receipt persisted before execution; redelivery returns existing result; crash → reconcile or unknown | B Ph09 | Ag | Outcome unknown | agent ledger | agent state | Agent | Agent unit test | Verified |
| WIN-05 | Server accepts results idempotently; contradictory late result rejected and recorded | B Ph09 | Ag / `POST /api/v1/agent/commands/:id/result` | — | result service | agent_commands, actions | — | Integration | Verified |
| WIN-06 | Session-aware lock helper (C#) observes WTS lock notification; lock is not termination | B§2, B Ph09, F§7 | Ag | Lock boundary text | helper IPC | — | Windows helper | Live test on disposable Windows (Blocked: no authorized disposable device) | Blocked (no authorized disposable Windows VM) |
| WIN-07 | Disable local account by SID; protect last admin, recovery identity, agent identity | B Ph09 | Ag | Existing sessions assessed separately | adapter | — | Windows | Unit guard tests; live Blocked | Verified (unit guards); live Blocked |
| WIN-08 | Restrict removable storage with saved prior state; already-mounted boundary | B Ph09, F§7 | Ag | Boundary visible; never contained for mounted path | adapter | — | Windows | Live Blocked | Verified (unit); live Blocked |
| WIN-09 | Enable firewall, lockout policy, block source IP, enable AV, request scan, undo (only if Saathi still owns change) | B Ph09 | Ag | Scan status separate from infection | adapters | — | Windows | Live Blocked; read-only posture probes run | Blocked live; read-only posture probes verified |
| WIN-10 | Real event collection (Security 4625/4624/4720/4732, storage, Defender) and posture reads on supported Windows | B Ph00, Ph05 | Ag | Missing logging permission → setup task | collector | — | Windows | Live read-only run on this machine | Verified (non-elevated read-only run); Security log Blocked (needs elevation) |

## 7. Incident UI, localization, recovery, notifications

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| UI-01 | Navigation: overview, incidents, ask, devices, people, health, evidence, reports, integrations, settings; mobile Overview/Incidents/Ask/More | B Ph10, F§3, FE§5 | All | Role-filtered | shell | — | — | E2E at 320/768/1440 | Verified |
| UI-02 | Overview: needs attention, review today, recently handled, connected sources, protection checks, temporary limits, funnel sentence | F§5, FE§6.1 | O,A / `/app/overview` | Empty/no sources/stale | `GET /api/v1/overview` | — | — | E2E | Verified |
| UI-03 | Incident list with tabs/filters preserved in URL and restored on Back | FE§6.2 | A,Au / `/app/incidents` | Empty, error | `GET /api/v1/incidents` | — | — | E2E | Implemented, unverified |
| UI-04 | Incident detail reading order: title/status, scope/freshness, what happened, uncertain, already limited, recommendation, review CTA, alternatives/history | FE§6.3, F§6C | A,Au / `/app/incidents/[id]` | Loading/stale/partial/forbidden | `GET /api/v1/incidents/:id` | — | — | E2E | Verified |
| UI-05 | Consequence preview page: two equal panels, limits/unknown/cannot-control/recovery visible before approval; action-named CTA; alternatives via radio → server preview | FE§6.4 | A / preview routes | Updating consequences (approval disabled), stale | preview + actions | — | — | E2E | Verified |
| UI-06 | Action result: progress rail mapped to real states; session cards; Not checked; action confirmed vs incident contained; timeout → status lookup | FE§6.5 | A / `/app/actions/[id]` | Partial/failed/unknown parity | `GET /api/v1/actions/:id` | — | — | E2E | Verified |
| UI-07 | SWR polling with backoff, pause when hidden; no optimistic security success | B Ph10, FE§12 | — | Last updated time | hooks | — | — | Code review + E2E | Implemented, unverified (code review) |
| UI-08 | EN/KN/HI message keys, vocabulary packs (generic, clinic, shop, school, NGO); fonts; locale dates; language switch preserves route | B Ph10, FE§3.2, FE§11 | All | Long strings wrap | `packages/i18n` | users preference | — | E2E screenshots in 3 languages | Verified; KN/HI need native review |
| UI-09 | Read-aloud only with matching installed voice; else explain unavailability | B Ph10 | All / incident | Play/Stop; unavailable notice | Web Speech | — | Browser | Manual | Implemented, unverified |
| UI-10 | Accessibility: skip link, landmarks, focus visible, dialogs trap/return focus, 44px targets, contrast, no overflow at 320px, reduced motion | FE§10–11 | All | — | components | — | — | Playwright + axe-like checks, manual | Verified (automated); screen reader not run |
| UI-11 | Landing page `/` per FE§4 (header, hero, illustration stage, three feature stages with selectors, who it helps, trust, FAQ, CTA, footer) | FE§4 | Public / `/` | Works without JS | static | — | — | Screenshot review | Verified (screenshots) |
| AUTO-01 | Versioned consent: named actions, thresholds, scope, max duration, expiry behavior; broad interventions default off | B Ph11, F§4.5 | O / onboarding, settings | Saving/saved version/failure | policy service | org_policy versions | — | Integration | Implemented, unverified |
| AUTO-02 | Throttle expires after 30 min with countdown, audit, pre-expiry warning, notify if continuing; never converts to pause | B Ph11 | O,A / incident | "Temporary limit ends at / has expired" | worker expiry job | restrictions | — | Integration with controlled clock | Verified (expiry); pre-expiry warning unverified |
| AUTO-03 | Human pause/revocation independent; expiry of throttle cannot undo pause or resurrect revoked sessions | B Ph11 gate | — | — | — | — | — | Integration | Verified |
| RCV-01 | Recovery case: verify person (attested) → address credentials/findings → revoke old session → fresh session → verify old token rejected (machine-verified) → finish | B Ph11, F§6G, FE§6.6 | O / `/app/incidents/[id]/recovery` | Blocked with reason; attested vs verified labels | `POST /incidents/:id/recovery`, `POST /recovery/:id/steps` | recovery_cases | gw | Integration + E2E | Verified (integration); recovery page smoke only |
| RCV-02 | Device recovery previews restore, verifies ownership of change, checks result | B Ph11 | O | — | device preview (undo) | — | Agent | Integration (simulated agent, labelled) | Verified (agent unit, simulated) |
| RCV-03 | New relevant evidence reopens investigation; dismiss requires reason and preserves history | B§3 | A / incident | Reason dialog | `POST /incidents/:id/dismiss` | incidents | — | Integration | Implemented, unverified |
| TG-01 | Telegram link via one-use code; private chat binding; unlink stops delivery | B Ph12, F§4.6 | O,A,St / settings | Linked/unlinked; unavailable when no bot token | `POST /api/v1/telegram/link`, webhook | telegram_links | Telegram (Blocked: no bot token) | Integration with signed webhook payloads | Verified (synthetic webhook payloads); live Blocked (no bot token) |
| TG-02 | Generic notification text + link to login → authorized incident; link is not a bearer token | B Ph12 | — | Delivery failure visible in console | notification job | notifications | Telegram | Integration | Implemented, unverified; live Blocked |
| TG-03 | Webhook secret validation, update dedupe; staff reports via linked chat | B Ph12 | St | — | webhook | telegram_updates | Telegram | Integration | Verified (synthetic) |
| TG-04 | Campaign warning requires authorized review, scoped recipients, delivery history | B Ph12, F§9 | A / ask/[id] | Recipients list | `POST /api/v1/campaigns/:id/warn` | campaign_reports, notifications | Telegram | Integration | Implemented, unverified |

## 8. Ask Saathi, AI, health, digest

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| ASK-01 | Paste text / bounded image upload (MIME sniff, size, dimensions); private storage with short retention | B Ph13, F§9 | St,A / `/app/ask` | What will be processed; upload errors | `POST /api/v1/scam-checks` | scam_checks | Object storage | Integration | Implemented, unverified (image upload) |
| ASK-02 | Extracted text preview/redaction before optional external AI; distinct OCR consent before the image is sent; xAI reads PNG/JPEG only (WebP stored, not sent) | B Ph13 | St | Redaction editor; OCR consent checkbox; unsupported-format note | `POST /api/v1/scam-checks/extract` → `extractTextFromImage` (xAI vision via `AI_VISION_MODEL`) | — | xAI Grok vision | Unit (mocked) + E2E | Implemented; adapter unit-tested; live OCR opt-in (`tools/xai-smoke.mjs`) |
| ASK-03 | URL/domain normalization incl. Unicode/punycode; deterministic checks; no fetching submitted URLs | B Ph13 | — | — | `packages/domain/scam` | — | — | Unit | Verified |
| ASK-04 | Verdicts exactly known_malicious / suspicious / no_known_indicators / insufficient_information with reasons and next steps; never "safe" | B Ph13, F§9 | St / `/app/ask/[id]` | Neutral styling for no-indicators | contracts | scam_checks.verdict | — | Unit + confusion matrix | Verified |
| ASK-05 | Prompt-injection content has no effect on controls | B Ph13 gate | — | — | AI adapter has no tools | — | — | Unit | Verified |
| ASK-06 | Campaign grouping: 3 distinct staff reports of matching normalized campaign in 24h; tenant-keyed fingerprint | B Ph06, Ph13 | A | Minimized summary | campaign service | campaign_reports | — | Integration | Verified |
| ASK-07 | History permissions: staff see own; approvers see minimized; raw restricted; attachments expire | F§9 | St,A | — | DAL | — | — | Integration | Implemented, unverified |
| AI-01 | Optional "Explain more" via provider adapter with strict schema, minimized facts, circuit breaker, deterministic fallback; model from `AI_MODEL` | B Ph13, F§6C | A / incident | "Showing the standard explanation" | `POST /api/v1/incidents/:id/explain` | — | Anthropic (Blocked: no key) | Unit with failing provider | Implemented, unverified; live Blocked (no Anthropic key) |
| HLT-01 | Posture checks AV/firewall/updates/lockout/admin/remote access as pass/fail/unknown with timestamp/source | B Ph14 | O,A / `/app/health` | Unknown points visible | `GET /api/v1/health` | device_posture | Agent | Unit | Verified |
| HLT-02 | Weights 25/25/20/10/10/10; unknown points separate; stale device cannot raise score; failed fix cannot improve score | B Ph14 gate | — | Score bar + six rows | `computeHealth` | — | — | Unit | Verified |
| HLT-03 | Fix uses same preview/approval/action machinery; unsupported → guided steps + recheck | B Ph14, F§10 | O,A | Guided steps | device preview | — | Agent | E2E | Implemented, unverified |
| DIG-01 | Weekly digest from stored facts (incidents, remediated detections, outstanding recovery, coverage gaps, policy expiry) | B Ph14, F§5 | O / reports | — | digest job | reports | — | Integration | Implemented, unverified |

## 9. Evidence, verifier, anchoring, reports, operations

| ID | Requirement | Sources | User / route | UI | Contract / service | Persistence | Integration | Verification | Status |
|---|---|---|---|---|---|---|---|---|---|
| EVD-01 | Worker signs intents in monotonic org sequence on chain-head row; missing earlier intent blocks later signing | B Ph15 | — | "Signing pending" | evidence job | evidence_intents, evidence_entries, evidence_chain_heads | — | Integration | Verified |
| EVD-02 | Canonical serialization v1; SHA-256; Ed25519 over hash; key IDs; evidence key separate from command key | B Ph15 | — | — | `packages/evidence` | — | — | Unit vectors | Verified |
| EVD-03 | Append-only triggers resist ordinary edits (privileged bypass acknowledged) | B Ph15 | — | — | migration triggers | — | — | Integration: UPDATE rejected | Verified |
| EVD-04 | Signed checkpoints retained outside DB (object storage/owner download) | B Ph15 | O,Au | — | checkpoint job | checkpoints | Storage | Integration | Verified |
| EVD-05 | Bundle export (owners/auditors, synthetic data) with entries, links, key IDs, checkpoint | B Ph15 | O,Au / `/app/evidence/[id]` | Download | export service | reports | Storage | Integration | Verified |
| EVD-06 | `/verify` local verifier + downloadable standalone verifier; separate rows for hashes, links, signatures, retained checkpoint, membership, blockchain | B Ph15, F§11.3, FE§8 | Public / `/verify` | "Not checked offline" | `packages/evidence/verify` | — | — | Unit tamper tests + E2E | Verified |
| EVD-07 | Edit/reorder/wrong key/middle deletion/tail truncation fail with specific reason | B Ph15 gate | — | Failing step named | verifier | — | — | Unit | Verified |
| ANC-01 | Randomized domain-separated commitment per checkpoint; nonce private | B Ph16 | — | — | anchor service | anchor_members | — | Unit | Verified |
| ANC-02 | Deterministic versioned Merkle tree with domain prefixes, defined odd-leaf rule, stored paths | B Ph16 | — | — | `merkle.ts` | anchor_members.path | — | Unit vectors | Verified |
| ANC-03 | Exact root-file bytes stamped via OTS; proof persisted; pending ≠ confirmed; upgrades with backoff | B Ph16 | — | Pending/submitted/retrying | anchor jobs | anchor_batches, anchor_proofs | OpenTimestamps calendars | Live submission recorded | Verified (real calendars, pending) |
| ANC-04 | Bitcoin attestation verified with configured node (independent) or labelled prototype external service; method/time stored; reorg recheck | B Ph16 | O,Au | Method shown | verifier | anchor_proofs | Bitcoin node (Blocked) / Esplora (labelled) | Live when proof upgrades | Blocked (no Bitcoin node; Esplora unreachable) |
| ANC-05 | Calendar/node outage never blocks incident handling | B Ph16 gate | — | — | async jobs | — | — | Integration with unreachable calendar | Verified |
| ANC-06 | Confirmed synthetic example for stage demo, clearly labelled | B Ph16 | — | "Earlier sample" label | — | — | OTS | Depends on Bitcoin confirmation | Blocked (attestation obtained, not verifiable here) |
| RPT-01 | Incident and weekly reports with separate fields for scope, facts, uncertainty, action results, recovery, integrity, timestamp | B Ph17 | O,Au / `/app/reports`, `/app/reports/[id]` | Download readiness | `GET /api/v1/reports`, `POST /incidents/:id/report` | reports | Storage | Integration | Implemented, unverified |
| RPT-02 | Private artifacts, authorized short-lived downloads, access tracking | B Ph17 | O,Au | — | `GET /api/v1/reports/:id/download` | report_access_log | Storage | Integration cross-tenant denied | Implemented, unverified |
| OPS-01 | Health checks distinguish web, DB, worker lag, agent freshness, notification delivery, proof service | B Ph17 | O / settings ops | — | `GET /api/v1/ops/status` | jobs | — | Manual | Implemented, unverified |
| OPS-02 | Integration revoke/disconnect, device retirement, secret rotation | B Ph17 | O | Consequence text | integrations PATCH, devices | — | — | Integration | Implemented, unverified |
| OPS-03 | Retention defaults (7d telemetry, 24h images, 30d reports) as configurable proposals | B Ph17 | O / settings | — | retention job | — | — | Integration | Implemented, unverified |
| INT-01 | Integrations list/detail: can observe / can enforce / read-only / stale / unconnected; credentials write-only; connector events endpoint | B§6, F§4.4, FE§7 | O / `/app/integrations`, `/[id]` | Disconnect consequences | `GET/PATCH /api/v1/integrations/:id`, `POST /:id/events` | integrations | — | Integration | Implemented, unverified |
| PPL-01 | People list/detail with separate sessions, device-account links, shared accounts, dependencies, access/offboarding previews | F§8, FE§7 | A / `/app/people`, `/[id]` | Inactive/shared labels | `GET /api/v1/people`, `/:id/sessions`, `POST /access/previews` | staff, app_sessions | — | E2E | Implemented, unverified |
| DEMO-01 | `/demo` privileged synthetic scenario/replay controls with persistent DEMO/REPLAY badge; never on production tenants | B§6, F§3, FE§7 | Demo role / `/demo` | Badge | `POST /api/v1/demo/replays` | organizations.is_demo | — | Integration | Verified |
| DEMO-02 | Vocabulary switch clinic/shop/school/NGO changes labels only; same authorization outcomes | B§7, F§14 | O / settings | — | i18n | organizations.vocabulary | — | Unit + E2E | Verified |
| ACC-* | build.md §7 acceptance matrix rows are tracked individually in [verification.md](verification.md#acceptance-matrix) | B§7 | — | — | — | — | — | — | See verification.md |

## 10. Route coverage (flow.md §3)

| Route | Requirement IDs | Status |
|---|---|---|
| `/` | UI-11 | Implemented |
| `/login` | ID-01, ID-05 | Implemented |
| `/onboarding` | ID-02, ID-03, ID-09, AUTO-01, TG-01 | Implemented |
| `/app/overview` | UI-02, ID-10 | Implemented |
| `/app/incidents` | UI-03 | Implemented |
| `/app/incidents/[id]` | UI-04, AI-01, UI-09, RCV-03 | Implemented |
| `/app/incidents/[id]/preview/[previewId]` | UI-05, APR-* | Implemented |
| `/app/previews/[previewId]` | APR-09 | Implemented |
| `/app/actions/[id]` | UI-06, APR-05 | Implemented |
| `/app/incidents/[id]/recovery` | RCV-01 | Implemented |
| `/app/devices`, `/app/devices/[id]` | DEV-01, DEV-07 | Implemented |
| `/app/people`, `/app/people/[id]` | PPL-01 | Implemented |
| `/app/ask`, `/app/ask/[id]` | ASK-* | Implemented |
| `/app/health` | HLT-* | Implemented |
| `/app/evidence`, `/app/evidence/[checkpointId]` | EVD-*, ANC-* | Implemented |
| `/app/reports`, `/app/reports/[id]` | RPT-* | Implemented |
| `/app/integrations`, `/app/integrations/[id]` | INT-01 | Implemented |
| `/app/settings` | AUTO-01, ID-05, ID-06, TG-01, OPS-* | Implemented |
| `/workspace/records` | REC-01 | Implemented |
| `/verify` | EVD-06 | Implemented |
| `/demo` | DEMO-01 | Implemented |

## 11. frontend.md §15 acceptance checklist

Tracked in [verification.md](verification.md#frontend-acceptance-checklist).
