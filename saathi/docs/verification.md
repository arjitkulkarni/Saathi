# Saathi verification record

Only checks that were actually run are recorded as passed. Anything not run is marked **Not run** or **Blocked**, with the reason.

## Environment

- OS: Windows 11 Home (10.0.26300). Node 24.14.0, pnpm 10.33.3, Chromium (Playwright).
- Database: Neon (PostgreSQL 18.6) for development since D-025; local PostgreSQL 18.3 cluster (D-004), `127.0.0.1:55432`, with separate migrator, app and worker roles (none can bypass RLS). The integration tests use a separate `saathi_test` database migrated with `pnpm db:migrate -- --test`.
- Services during browser checks: `next dev` on :3000, the persistent worker, and a simulated agent (`--simulate`, labelled).
- Not available:
  - Anthropic API key.
  - S3 credentials.
  - Bitcoin Core RPC node, and a reachable Esplora service (blockstream.info returned 429; mempool.space timed out).
  - Python.
  - An authorized disposable Windows VM.

## Runs (2026-10-31)

| Command | Scope | Result |
|---|---|---|
| `pnpm -r typecheck` | All 7 workspace packages | Pass, 0 errors |
| `pnpm lint` | apps/web ESLint (Next config) | 0 errors, 10 warnings. All 10 are deliberate `window.location.assign` full reloads after sign-in, org switch or locale switch |
| `pnpm test` | Unit: domain, evidence, i18n, agent | **74/74 pass**, 7 files. Includes fast-check property tests |
| `pnpm test:integration` | Real PostgreSQL with RLS roles and the worker runtime | **35/35 pass**, 4 files: `core`, `journey`, `protocols`, `evaluation` |
| `pnpm test:e2e` | Playwright desktop Chromium against dev server, worker and simulated agent | **19/19 pass** (core suite, rerun at the end in 3.0 min). Plus `pages-smoke.spec.ts` **2/2**: every console route renders an `h1` with no console errors, and staff get an ask verdict. It initially failed and found two real defects: no `h1` on the ask result, and an empty recovery page with no heading. Both were fixed, then the spec passed |
| `pnpm db:migrate -- --test` | Flag handling | Found a defect: pnpm forwards the literal `--`, so the flag was ignored and the **dev** database was migrated instead (harmless, because migrations are idempotent). Fixed in `migrate.ts` and `seed.ts` (`argv.includes('--test')`) and rerun |
| `pnpm build` | Next.js production build | Pass, 55 routes |
| Production smoke | `next start` on :3001 | Public pages 200. `/app` 307 → `/login?next=…`. `/api/v1/overview` 401. `Cache-Control: private, no-store` on API responses. CSP, frame and referrer headers present |
| Neon setup (D-025) | migrate, seed, RLS spot check, worker run | Pass. App role over the pooler: 0 rows with no context, 5 staff / 1 org with Lakeview context. Worker completed 6 jobs. The web server was not restarted onto Neon (the user's own dev server was still running) |
| Client-bundle secret scan | Every `.next/static/**` file checked for every `.env` name and value | 0 names, 0 values |
| Agent live observe-only | This developer PC, not elevated | Enrolled. Posture: 6/6 read (all pass). The Security log was unreadable (`access_denied`) and is shown as an unmet prerequisite, not as a pass. See [agent.md](agent.md#verification) |
| Agent live simulated | This PC, separate state directory | Enrolled with 9/9 capabilities. Commands were signed, delivered, executed (simulated) and probed. The console labels the device as simulated |
| OpenTimestamps (native) | Public calendars alice.btc / bob.btc / finney | Real submissions returned pending attestations. One spike proof later upgraded to a Bitcoin block-header attestation (height ≈973938). It is **unverified** because no node or Esplora service was reachable |

## Acceptance matrix (build.md §7)

| # | Test | Required outcome | Test location | Status |
|---|---|---|---|---|
| A1 | Cross-tenant object ID, session or job payload | No unauthorized read/write or evidence disclosure | `core.test.ts` "a member of another organization…", "RLS hides other tenants…"; `access.spec.ts` cross-org URL + forged org selector | **Pass** |
| A2 | Staff calls action endpoint; approver role revoked mid-flow | Denied server-side | `core.test.ts` "staff cannot preview or approve", "approver whose role is revoked mid-flow"; `access.spec.ts` staff/auditor API 403 | **Pass** |
| A3 | Two sessions, pause only one | Target denied; other unchanged | `core.test.ts` first test; `journey.test.ts` D–F; `core-journey.spec.ts`; property test "pausing one session leaves the other permitted" | **Pass** |
| A4 | Account disable with existing sessions | Connector semantics shown | Preview consequence partitions for `records.disable_account` (`core.test.ts` race tests use it). The preview UI shows connector semantics. No dedicated assertion on the semantics text | **Partial**: behaviour exercised, text not asserted |
| A5 | Concurrent session creation vs approval | Serialized or stale rejection | `core.test.ts` "serializes session creation racing with approval" (×8), "rejects approval when a relevant new session appeared" | **Pass** |
| A6 | Unrelated user's new session | Does not invalidate narrow preview | `core.test.ts` "does not invalidate a narrow preview…"; property test on relevant state hash | **Pass** |
| A7 | Duplicate approval / command / result delivery | Single logical action | `core.test.ts` duplicate taps; `protocols.test.ts` duplicate result accepted once, contradictory late result rejected; agent `executor.test.ts` redelivery never reruns | **Pass** |
| A8 | Concurrent download burst | Atomic budget prevents over-admission | `core.test.ts` 40 concurrent requests → at most 21 admitted, exactly 1 throttle | **Pass** |
| A9 | Agent offline / stale / local state changed | Unavailable, expired or re-preview | `protocols.test.ts` stale device → `DEVICE_OFFLINE`, no action created; `device-command.spec.ts` offline device; agent `executor.test.ts` expected-state mismatch | **Pass** |
| A10 | Command tamper, expiry, wrong device, replay | Rejected and recorded | Agent `executor.test.ts` (tampered params/expiry, expired, wrong device, replayed nonce); `protocols.test.ts` HMAC spoof/replay/stale/wrong key version; delivery only to the target device | **Pass** |
| A11 | Worker crash after external side effect | Reconciled or unknown | `journey.test.ts` lease reclaimed, processed once; agent crash reconciliation (observed → confirmed, otherwise unknown); `protocols.test.ts` "claiming success without passing probes → unknown" | **Pass** (simulated / unit level) |
| A12 | USB already mounted / unsupported class | Boundary visible; no false containment | Agent `executor.test.ts` "reports partial when … a drive is already mounted" | **Pass** (adapter logic). Live Windows run **Blocked** (no disposable VM) |
| A13 | One finding fixed, another unresolved | Partial; incident stays open/investigating | `packages/domain/test/evaluation.test.ts` A13 | **Pass** |
| A14 | Expired auto-throttle | Visible expiry and audit; pause remains | `journey.test.ts` "throttle expiry does not undo the independent pause"; property test "expired restrictions never deny" | **Pass** |
| A15 | Recovery and old token replay | Fresh session works; old denied | `journey.test.ts` G; `core.test.ts` revoked token stays denied | **Pass** |
| A16 | Normal business-day replay | False alerts measured | `tests/integration/evaluation.test.ts` A16 | **Measured**: 49 replayed events (41 aggregated, 6 informational, 1 digest, 1 correlated) gave **0 incidents** and 0 false alerts. Synthetic data, one day; not a field measurement |
| A17 | Slow extraction below thresholds | Limitation and miss recorded | `evaluation.test.ts` A17; domain test "slow extraction below the burst threshold is NOT detected" | **Measured**: 90 events, all aggregated, **0 incidents**. A missed detection, as documented |
| A18 | Known benign and malicious messages | Confusion matrix reported | `packages/domain/test/evaluation.test.ts` A18 (16 labelled messages) | **Measured**: TP 8, FN 0, FP 1, TN 7. The false positive is an internal "please update your password" reminder. 2 scams were `known_malicious` (blocklist) and 6 `suspicious`. A small synthetic set |
| A19 | Prompt injection / AI down | No authorization path; templates work | Domain test "prompt-injection text is only data"; the AI adapter has no tools; with no API key the deterministic explanation is shown ("Showing the standard explanation") | **Pass** for the no-key path. The live model path is **Blocked** (no Anthropic key) |
| A20 | Evidence edit/reorder/truncate/wrong key | Integrity fails with reason | `evidence.test.ts` (edit, reorder, middle deletion, tail truncation via retained checkpoint, wrong key, nonce/path tamper); `journey.test.ts` bundle tamper; `protocols.test.ts` UPDATE/DELETE blocked by triggers | **Pass** |
| A21 | OTS pending / tampered inclusion / node unavailable | Never fabricated confirmation | `evidence.test.ts` (pending stays pending; attestation verified only against the matching merkle root; proof for another file rejected); `protocols.test.ts` calendar outage → `retrying` | **Pass** |
| A22 | Offline verifier without chain context | Integrity works; blockchain unverified offline | `evidence.test.ts` "claimed Bitcoin attestation without chain context is not checked offline"; `/verify` page and the standalone verifier use the same module | **Pass** |
| A23 | Vocabulary switch | Same authorization outcomes | Property test "vocabulary/locale never affect authorization"; i18n "vocabulary switch changes labels only" | **Pass** |
| A24 | Accessibility and language comprehension | Keyboard/mobile usable; native-reviewed copy | `responsive-a11y.spec.ts`: no overflow at 6 widths × EN/KN/HI, mobile nav, skip link/focus, reduced motion, axe (public + console) | **Partial**: automated checks pass. KN/HI copy is a model draft with **no native review**, and no user study was run |

Additional gates verified in `protocols.test.ts`:
- Enrollment codes are single-use.
- Duplicate event batches are stored once.
- Telegram link codes are single-use; update dedupe works, and group chats and unlinked chats are ignored. This used synthetic webhook payloads in `protocols.test.ts`, not the live Bot API. Separately, 2026-10-31: `scripts/register-telegram.mjs` registered the production webhook for `@v_saathi_bot` against https://saathi-woad.vercel.app/, and a synthetic payload posted directly to the production route (correct secret header) returned `{"ok":true}`, confirming the production env vars and database path work. No real Telegram-initiated update (a human tapping the deep link) has been exercised yet.
- Three distinct reporters create one scam campaign and one incident.

## E2E (Playwright, desktop Chromium 1440×900)

- `core-journey.spec.ts`: burst → incident → preview → approve → the suspicious session is denied and the legitimate session keeps working (probe cards).
- `device-command.spec.ts`: a signed command reaches the simulated agent and is probed; an offline device cannot be approved.
- `access.spec.ts`: signed-out deep link, staff/auditor landing and 403s, cross-org 404, forged org 403, CSRF 403, gateway 401.
- `responsive-a11y.spec.ts`:
  - Overflow at 320/390/768/1024/1440/1920 in EN/KN/HI.
  - Mobile "More" dialog with focus return.
  - Keyboard skip link.
  - Reduced motion.
  - axe-core with no serious or critical violations.

Not run:
- A separate mobile-device Playwright project (the width checks cover layout).
- Firefox and WebKit.
- A screen reader (NVDA or Narrator).
- Slow network and offline browser.
- A lost approval response.

## Frontend acceptance checklist (frontend.md §15)

| Item | Status | Evidence |
|---|---|---|
| Landing has warm neutral/serif/coral character with Saathi content | Pass (visual review) | Screenshots at 320/768/1440 |
| App keeps palette; operational headings sans-serif | Pass (visual review) | Console screenshots |
| Incident title, facts, uncertainty, next step easy to locate | Pass (visual review) | Incident detail reading order follows FE§6.3 |
| Preview exposes effects incl. unknown coverage and recovery before approval | Pass | `core-journey.spec.ts` asserts the panels before approval |
| EN/KN/HI readable, no clipping | Pass (automated overflow) | Glyph quality still needs native review |
| Success/partial/failure/unknown get equal visual care | Pass (code review) | Shared `StatusBadge` and action-state components |
| No invented customer marks, claims, counts | Pass (review) | Landing uses no logos, testimonials or metrics |
| Every flow.md route has a purposeful screen | Pass | Route table in [implementation-matrix.md](implementation-matrix.md#10-route-coverage-flowmd-3) |
| Only backend/probe data changes status/health/proof | Pass | No optimistic security state; `usePolling` reads server state only |
| Session expiry, role removal, tenant switch, stale preview | Pass | Integration tests (A2, A5) and e2e (access) |
| Pending timestamp never becomes confirmed by timer | Pass | A21; the UI reads `anchorStatus` from the server only |
| Local integrity and blockchain separately labelled | Pass | Verifier rows; evidence status cards |
| Technical identifiers available, not dominant | Pass (visual review) | `<details>` "Technical details" |
| Review at the six widths | Pass (automated) | `responsive-a11y.spec.ts` |
| No overflow, hidden focus or covered approval controls | Pass | Same spec ("mobile navigation never hides incident approval controls") |
| Keyboard-only + screen-reader smoke | Keyboard pass; screen reader **Not run** | — |
| Contrast measured on rendered surfaces | Pass (axe on rendered pages) | — |
| Reduced motion retains information | Pass | Same spec |
| Slow network, offline browser, offline device, lost approval response | Offline device pass; the other three **Not run** | — |
| Long translated text / dependency lists / multiple findings wrap | Pass (overflow checks in KN/HI) | — |
| Animation never delays risk/expiry/failure information | Pass (code review) | Animations are decorative only (≤300 ms) and disabled under reduced motion |
| Human understanding study | **Not run** | Needs real non-security users |
