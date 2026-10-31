# Saathi implementation decisions

Each entry records the sources involved, the decision, the reason, and affected requirement IDs ([implementation-matrix.md](implementation-matrix.md)).

## D-001 Workspace location
- Sources: skills.md §3.2, user instruction.
- Observation: the repository contains only the five specification files; no ACM website, `AGENTS.md` or `CLAUDE.md` exists at the repository root (31 Oct 2026). `create-next-app` generated `apps/web/AGENTS.md`, which requires reading the installed Next.js docs before writing code.
- Decision: implement in `saathi/` as a pnpm monorepo with the build.md §2 layout (`apps/web`, `apps/worker`, `apps/agent`, `packages/*`, `tools/anchor`, `tests/*`). Specs stay at the repository root and are linked, not copied.
- Affects: FND-01.

## D-002 PDF location and diagrams
- Sources: skills.md §2 refers to `output/pdf/idea.pdf`; the actual file is `idea.pdf` at the repository root.
- Decision: use the root `idea.pdf` (23 pages). The text of all pages was extracted with pdfjs-dist. Page rasterisation was unavailable (no poppler), but the diagram blocks on pages 1, 7, 10, 17 and 18 are text-drawn sequences (SEE→EXPLAIN→PREVIEW→ACT; INCIDENT→PREVIEW→ACTION→RECOVERY; BROWSER→API→NEON→WORKER; EVENT→DECISION→RESULT→RECEIPT; CHECKPOINT→COMMITMENT→BATCH ROOT→TIMESTAMP), and their labels and order came through in the extraction. They add no relationships beyond build.md.

## D-003 Next.js 16.4.3 Cache Components disabled
- Sources: build.md §3 ("Never opt organization data into shared Next.js caches"), build.md Ph02 ("Require fresh server-side session validation on sensitive operations"); installed guide `01-app/02-guides/authentication-with-cache-components.md`.
- Observation: the scaffold enables `cacheComponents`. Under it, session reads must be wrapped in `use cache: private`, which caches session-derived results in the browser for up to five minutes by default, or sit behind Suspense boundaries everywhere.
- Decision: set `cacheComponents: false`. Authenticated routes read cookies, so they render dynamically per request under the previous model (`02-guides/caching-without-cache-components.md`). Nothing organization-scoped uses `use cache`, `unstable_cache` or `force-static`. Every sensitive API response sets `Cache-Control: private, no-store`.
- Affects: ID-01, ID-06, UI-07.

## D-004 PostgreSQL provider: local PostgreSQL 18 instead of Neon (environment-blocked)
- Sources: build.md §2 (Neon), skills.md §9.
- Observation: no Neon credentials are available. PostgreSQL 18 binaries are installed locally, but the existing services' credentials are unknown and must not be disturbed.
- Decision: `scripts/local-postgres.mjs` creates a private cluster in `saathi/.local/pgdata` on port 55432 with roles `saathi_owner` (migrations, table owner), `saathi_app` (web runtime) and `saathi_worker` (worker runtime). Both runtime roles are `NOBYPASSRLS` and non-owner. The code uses `pg` with one checked-out client per transaction, which is the same driver and transaction model as Neon pooled connections (transaction-local `set_config` only). Pointing the variables at Neon pooled/direct URLs needs no code change. Live Neon is unverified.
- Additional variable: `DATABASE_URL_WORKER` (optional; falls back to `DATABASE_URL`) gives the worker its own restricted role, as build.md §4 requires ("Global job claiming uses a restricted worker role/procedure").
- Affects: FND-03, FND-04.

## D-005 RLS without FORCE; cross-tenant lookups via SECURITY DEFINER functions
- Sources: build.md §4.
- Decision: every tenant table has `ENABLE ROW LEVEL SECURITY` with policies on `current_setting('app.org_id', true)`. FORCE is not applied: the only role exempt from non-forced RLS is the table owner `saathi_owner`, and it is used only for migrations and seeding, never at runtime. Requests that must resolve a tenant before tenant context exists use narrow `SECURITY DEFINER` functions that return only the tenant ID and the minimum needed: device-key lookup, enrollment-code consumption, records-session token lookup, invitation-token lookup, Telegram code/chat lookup, connector-key lookup, job claiming and worker org listing. They run with a fixed `search_path`. Memberships are additionally readable by `app.user_id` so a signed-in user can list their own organizations.
- Worker trust boundary: the worker role can claim any tenant's job and holds the signing keys. Tenant data is still accessed through tenant-scoped transactions.

## D-006 Jobs table is the transactional outbox
- Sources: build.md §4 lists "jobs, outbox"; Ph03.
- Decision: mutations insert `jobs` rows in the same transaction as the state change and its `evidence_intents` row. This is the transactional outbox. A separate outbox relay table would only copy rows into `jobs`, so it is omitted. Dedupe keys are unique.

## D-007 Evidence intent sequence assigned at insertion
- Sources: build.md Ph15.1 ("missing earlier intent blocks later signing").
- Decision: each intent gets its per-organization sequence by incrementing `evidence_chain_heads.next_intent_seq` inside the mutating transaction. The row lock is held until commit, so sequences commit in order and a rollback releases its number, which means no gaps. The worker signs strictly contiguous sequences, and a non-signable intent blocks later ones and raises an operational error. The head row is always the last lock taken (after guards and preview), which preserves the global lock order.

## D-008 Cryptography library
- Decision: `@noble/curves` (Ed25519) and `@noble/hashes` (SHA-256, RIPEMD-160, SHA-1, Keccak for OTS ops). The same audited pure-JS code runs in the worker (signing) and in the browser/standalone verifier, which avoids drift between the two.

## D-009 OpenTimestamps client
- Sources: build.md §2 ("OpenTimestamps through its Python client in the worker image"), Ph16.3.
- Observation: Python is not installed in this environment.
- Decision: implement two anchor backends behind one adapter. (a) `python`: `tools/anchor/ots_wrapper.py` invokes the pinned official client (`opentimestamps-client`, version pinned in `tools/anchor/requirements.txt`) via an argument array, for the worker container image. (b) `native` (default here): a TypeScript implementation of the OpenTimestamps wire protocol (calendar `/digest` submission, `.ots` detached-proof serialization, `/timestamp/<commitment>` upgrades, Bitcoin block-header attestation evaluation). Both produce standard `.ots` files for the same root-file bytes. No token, wallet, custom chain or contract. The python backend is unverified here.

## D-010 Bitcoin verification method
- Sources: build.md Ph16.5.
- Decision: `BITCOIN_VERIFIER=rpc` uses a configured Bitcoin Core RPC node, labelled "independent validating node". `BITCOIN_VERIFIER=esplora` uses an Esplora HTTP API, labelled "prototype external service (trust dependency)". When neither is configured, a Bitcoin attestation is stored as "attestation present, not verified", never confirmed.

## D-011 Object storage driver
- Sources: build.md §2 (private S3-compatible storage).
- Decision: the storage adapter supports `s3` (any S3-compatible endpoint via `OBJECT_STORAGE_*`) and `local` (a private directory outside `public/`, dev/test only, labelled in the operations status). Downloads always go through authorized Route Handlers with short-lived signed tokens, never public URLs.

## D-012 UI component library
- Sources: build.md §2 (shadcn/ui).
- Decision: components follow the shadcn/ui copy-in pattern (Radix primitives from `radix-ui`, `class-variance-authority`, `tailwind-merge`) and are written into `apps/web/src/components/ui`, restyled with the frontend.md tokens. The shadcn CLI's default theme is not used because frontend.md defines its own tokens.

## D-013 Locale handling
- Decision: next-intl without locale-prefixed URLs. The locale comes from a `saathi_locale` cookie (user choice), falling back to the organization's preferred language and then English. Switching language keeps the route, organization and incident (FE§11). Kannada and Hindi strings are model-drafted and marked as needing native review; they are not claimed as reviewed.

## D-014 Records workspace sessions are per-tab
- Sources: build.md Ph04 (two sessions for one staff member), flow.md §15.
- Decision: the reference records app keeps its application-session token in tab-scoped `sessionStorage` and sends it as a bearer header to the gateway. Two tabs can hold two independent sessions of the same staff member (office PC vs unfamiliar laptop) without sharing the console's Better Auth cookie. Each tab's records sign-in is a session-creation writer under the subject guard.

## D-015 Simulated device adapter for demonstrations
- Sources: skills.md §6 (label fixtures), build.md Ph09 (live device action required for gate).
- Decision: the agent has a `--simulate` mode for test/demo contexts only. Its results carry `simulated: true`, and the console shows a persistent "Simulated device (test fixture)" label on every simulated result. Simulated results never count toward the WIN-* live-device gates, which remain Blocked until run on an authorized disposable Windows machine. Read-only collection (event logs and posture) runs for real on this machine.

## D-016 Fresh authentication for approvals
- Sources: build.md §1 ("after fresh authentication when required").
- Decision: approvals and recovery steps require a Better Auth session created within `SENSITIVE_AUTH_MAX_AGE_MINUTES` (default 720). Otherwise the API returns `401 UNAUTHENTICATED` with `reauth: true` and the UI asks the user to sign in again, preserving the destination.

## D-017 Email delivery for invitations
- Observation: no email provider is specified or configured.
- Decision: invitation links are displayed once to the inviting owner for out-of-band sharing. The token is stored hashed and expires after 72 hours.

## D-018 Bitcoin verification not available in this environment
- Observation: blockstream.info Esplora returned HTTP 429 and mempool.space timed out from this network. No Bitcoin Core node is available.
- Decision: proofs carrying a Bitcoin attestation stay "attestation present, not confirmed". The verifier row reads "blockchain: not checked". No status is inferred from the attestation alone. Configure `BITCOIN_VERIFIER=rpc` (preferred) or `esplora` to confirm.

## D-019 Development logs live outside the workspace
- Observation: writing the `next dev` log inside `saathi/` made Turbopack's watcher reload the page in a loop (104 reloads in 8 s).
- Decision: development service logs go to a directory outside the repository, or to an ignored path that the web app does not watch. The README documents this. Worker and agent logs under `.local/` did not trigger reloads.

## D-020 Turbopack persistent cache can serve stale CSS
- Observation: after token changes in `globals.css`, the dev server kept serving the previous stylesheet until `apps/web/.next` was removed.
- Decision: the troubleshooting step is to stop `next dev`, delete `apps/web/.next` and restart. Never run `pnpm build` while `next dev` is running: both use `apps/web/.next`, and a concurrent build caused one transient 500 on an agent request.

## D-021 Deterministic date and time formatting
- Observation: Node and Chrome ship different ICU data for `kn` and `hi`, which caused hydration mismatches, for example "31 ಅಕ್ಟೋ, 1:22 PM" on one side and "ಅಕ್ಟೋ 31, 1:22 ಅಪರಾಹ್ನ" on the other.
- Decision: `formatTime` takes only the numeric parts from `Intl` (with a fixed `en-US` locale and the organization's time zone). Month names, am/pm and word order come from the catalogue (`time.*`). Server and client therefore render identical text.

## D-022 Environment schemas are server-only
- Observation: exporting the Zod env schemas from `@saathi/contracts` placed environment variable names in client bundles.
- Decision: env schemas are imported only from the `@saathi/contracts/env` subpath, from server code. The client-bundle scan checks every `.env` name and value and must report 0 matches.

## D-023 Sign-in rate limiting stays enabled
- Observation: Better Auth's sign-in limit (3 per 10 s) caused e2e failures, and the form reported them as a wrong password.
- Decision: the limit stays on. The form shows a distinct "Too many sign-in attempts" message on 429. The e2e helper caches session cookies and waits out the window instead of disabling the control.

## D-024 Evaluation data is synthetic and small
- Decision: A16, A17 and A18 are measured on labelled synthetic replays and a 16-message set. The measurements are recorded as such in verification.md and are not presented as field accuracy. A pilot needs real (consented) traffic and native-speaker review before any accuracy claim.

## D-025 Neon is the development database; tests stay local
- Change: the user provided a Neon project (PostgreSQL 18.6). On it, `saathi_app` and `saathi_worker` were created as LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS with random passwords, kept in the git-ignored `.local/neon-credentials.json`. `neondb_owner` is the migration/owner role.
- URLs:
  - `DATABASE_URL`: the app role over the **pooled** endpoint (`-pooler`). Transaction-local `set_config` is compatible with transaction pooling.
  - `DATABASE_URL_WORKER` and `DATABASE_URL_DIRECT`: the direct endpoint.
  - All three use `sslmode=verify-full`, which keeps today's strict pg behaviour and avoids the pg v9 semantics change.
- `TEST_DATABASE_URL*` stay on the local cluster, because the integration suite truncates its database. The previous `.env` is backed up at `.local/.env.before-neon`.

## D-026 xAI (Grok) is the default optional-AI provider
- Decision: the optional explanation/OCR adapter (`packages/db/src/services/ai.ts`) defaults to `AI_PROVIDER=xai`, calling xAI's OpenAI-compatible `https://api.x.ai/v1/chat/completions` directly with `fetch` (no new SDK dependency). Anthropic is retained as an explicitly selected alternative; a failed xAI request is never retried on another provider.
- Config: `XAI_API_KEY`, `AI_MODEL` (text), `AI_VISION_MODEL` (image). Models are operator-supplied and not hardcoded — model IDs change and not every Grok model accepts images, so availability is false until the operator sets verified IDs. The real key lives only in the git-ignored `.env` (or deployment secrets); it is never logged, returned, or placed in a `NEXT_PUBLIC_*` variable.
- Verified on Neon:
  - Migrations and seed ran.
  - The app role sees 0 rows without tenant context and only its own organization with context.
  - The worker role processed jobs.
