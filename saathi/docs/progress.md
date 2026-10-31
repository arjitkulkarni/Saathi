# Saathi progress log

After any context reset, read this file, [implementation-matrix.md](implementation-matrix.md), [decisions.md](decisions.md) and [verification.md](verification.md). Then inspect the code before continuing.

## Current state (2026-10-31)

All phases 00–18 are implemented. The remaining work is blocked externally (credentials, a disposable Windows VM, a Bitcoin verifier, native translation review) or is a human study. See "Remaining" below.

## Completed

- Read skills.md, build.md, flow.md, frontend.md and all 23 pages of idea.pdf.
- Workspace `saathi/` (pnpm monorepo, Next.js 16.4.3, React 19). `cacheComponents` is disabled (D-003).
- Private PostgreSQL 18 cluster with migrator, app and worker roles. RLS on every tenant table, plus SECURITY DEFINER resolvers for pre-tenant lookups (D-004).
- `packages/contracts`, `domain`, `evidence`, `db`, `i18n` (EN/KN/HI; KN/HI are model drafts).
- `apps/worker`:
  - Lease/backoff/dead-letter runtime and scheduler.
  - All job handlers.
  - PDF reports and signed export manifest; weekly digest.
  - OpenTimestamps submit/upgrade.
- `apps/agent`:
  - HMAC-signed client, spool and bookmarks.
  - Ed25519 command verification with a persistent replay ledger.
  - Adapters for real, observe-only and simulated modes.
  - C# WTS lock helper.
- `apps/web`:
  - Better Auth database sessions.
  - About 60 `/api/v1` Route Handlers.
  - Landing, login, onboarding, `/demo`, `/verify` (+ standalone verifier), `/workspace/records`, and every `/app/*` console route.
- Tests:
  - Unit and property: 74.
  - Integration on real Postgres: 35.
  - E2E: 21 (19-test core suite + 2 page-smoke tests).
- Docs: README, matrix statuses, verification record, decisions D-001..D-024.

## Checks run (latest)

| Command | Result |
|---|---|
| `pnpm -r typecheck` | Pass |
| `pnpm lint` | 0 errors, 10 intentional warnings |
| `pnpm test` | 74/74 |
| `pnpm test:integration` | 35/35 |
| `pnpm test:e2e` | 19/19 core suite; the page-smoke spec (2/2) was added and run separately afterwards |
| `pnpm build` | Pass on the final code (rerun after the last UI and migrate fixes, with `next dev` stopped) |
| Client bundle secret scan | 0 matches |

## Remaining (blocked or needs people)

- Live Telegram, Anthropic, S3 and Neon runs: credentials needed.
- Bitcoin attestation verification: needs `BITCOIN_VERIFIER=rpc` (or a reachable Esplora).
- Mutating Windows adapters and the lock helper: needs an authorized disposable Windows VM.
- Python OTS backend: needs Python.
- Native review of the KN/HI catalogues.
- Human comprehension study (frontend.md §15).
- Not yet tested:
  - Screen-reader smoke test.
  - Slow network and offline browser.
  - Lost approval response.
  - Firefox and WebKit.
