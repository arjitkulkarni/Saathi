# VAJRA Saathi

Saathi helps a small organization respond to a security incident without guessing. It shows what happened and what is still uncertain. It previews exactly who a response will affect, and the response runs only after an authorized person approves it. It then checks the result through the real enforcement path, guides recovery, and keeps a signed, verifiable record.

The core demonstration: a suspicious records session is paused, while the same person's legitimate session keeps working. A probe then confirms both outcomes.

- Requirements and status: [docs/implementation-matrix.md](docs/implementation-matrix.md)
- What was actually tested, with results: [docs/verification.md](docs/verification.md)
- Decisions and deviations from the brief: [docs/decisions.md](docs/decisions.md)
- Windows agent: [docs/agent.md](docs/agent.md)
- Progress log: [docs/progress.md](docs/progress.md)

## Layout

```
apps/web        Next.js 16 App Router: console, records reference app, /verify, /demo, /api/v1
apps/worker     Persistent job runner: correlation, command signing, notifications, evidence, anchoring, reports
apps/agent      Windows device agent (real / observe-only / simulated) + C# session lock helper
packages/contracts  Shared vocabulary, Zod DTOs, agent protocol, env schemas (server-only subpath)
packages/domain     Pure policy: authorize, consequence preview, rules, containment, health, scam checks
packages/db         Drizzle schema, SQL migrations (RLS, roles, triggers), services, seed
packages/evidence   Canonical JSON, Ed25519 hash chain, Merkle batches, OpenTimestamps, offline verifier
packages/i18n       EN / KN / HI catalogues, vocabulary packs, deterministic formatting
tests/integration   Real-PostgreSQL tests (RLS roles, races, worker, protocols, evaluation)
tests/e2e           Playwright journeys, access control, responsive + accessibility
```

## Prerequisites

- Node 24+ and pnpm 10+.
- PostgreSQL 16+ binaries (developed against 18.3). Either Neon or a local cluster works.
- Windows 10/11, only for the real device agent. The web app, worker and simulated agent run anywhere.

## Install and configure

```bash
cd saathi
pnpm install

# Option A: local PostgreSQL cluster (private data dir in .local/, port 55432)
pnpm db:local:init        # creates the cluster, owner/app/worker roles, saathi_dev + saathi_test
                          # and prints the six DATABASE URLs. Save them to .local/db.env.
pnpm db:local:start       # later sessions: start it again (db:local:stop to stop)

# Option B: Neon or another server. Create three roles (owner, app, worker; app and worker
# must be NOBYPASSRLS) and put the URLs in .local/db.env or straight into .env.

node scripts/generate-env.mjs   # writes .env: DB URLs from .local/db.env, fresh random secrets,
                                # Ed25519 command and evidence keys. Values are never printed.
```

[.env.example](.env.example) documents every variable. Leave these empty unless you have real credentials:

- `TELEGRAM_*`
- `AI_PROVIDER` (`xai` default, or `anthropic`) + the matching key (`XAI_API_KEY` or `ANTHROPIC_API_KEY`) + `AI_MODEL` (text) and `AI_VISION_MODEL` (screenshot OCR)
- `OBJECT_STORAGE_*` (S3)
- `BITCOIN_*`

Without them the product says the feature is unavailable. It never fabricates success.

The optional AI (Ask Saathi explanations, incident "Explain more", and screenshot text extraction) defaults to **xAI (Grok)** over its OpenAI-compatible endpoint. Set `XAI_API_KEY`, `AI_MODEL` (a current text model from [docs.x.ai/docs/models](https://docs.x.ai/docs/models)), and `AI_VISION_MODEL` (an image-capable model — not every Grok model accepts images; leave blank to disable OCR). xAI reads only PNG/JPEG screenshots; WebP is stored but not sent, and the user pastes the text instead. A deterministic verdict, findings and templates are always produced first; the model only explains them and can never change the verdict or take any action. To verify a live key (spends a small amount of credits): `node tools/xai-smoke.mjs`.

`.env`, `.local/` and all generated keys are git-ignored. Private signing keys are used only by the worker.

## Migrate and seed

```bash
pnpm db:migrate            # dev database (owner role)
pnpm db:migrate -- --test  # integration-test database
pnpm db:seed               # 4 synthetic organizations, users, staff, 120 records + 1 decoy
```

Seeded sign-ins all use the password `saathi-demo-2026`.

Lakeview Community Office is the demo tenant. Its accounts:

| Account | Role |
|---|---|
| `owner@lakeview.example` | owner |
| `approver@lakeview.example` | approver |
| `staff@lakeview.example` | staff |
| `auditor@lakeview.example` | auditor |

Northside Family Clinic (Kannada) has its own owner, `owner@northside.example`.

Staff PINs for the records reference app are `ASH001 / 482910` and `JOS002 / 305117`. The seed also includes an offboarded account (`VIK004`) and a shared account (`FRD005`).

## Run the services

Use three terminals. Write logs **outside** the `saathi/` folder: a log file inside the workspace makes `next dev` reload in a loop (D-019).

```bash
pnpm dev:web               # http://localhost:3000
pnpm dev:worker            # required: correlation, command signing, evidence, notifications
pnpm dev:agent -- --simulate --server http://localhost:3000 --state-dir .local/agent-sim --code <CODE>
```

Get `<CODE>` from **Devices → Add device** (one-use, short-lived). Later runs reuse the state directory and need no code.

Agent modes (see [docs/agent.md](docs/agent.md)):

- `--simulate`: an in-memory test device, labelled "Simulated device (test fixture)" everywhere. Use it for demos.
- `--observe-only`: real Windows event collection and posture reads. It never changes the machine, so it is safe on an everyday PC.
- Real mode, with no flag: runs mutating adapters (firewall, account disable, storage restriction, lock helper). Use it only on an **authorized disposable Windows VM**.

Production build:

```bash
pnpm build   # stop `next dev` first; both use apps/web/.next
pnpm --filter @saathi/web start
```

## Demo walkthrough (about 5 minutes)

1. Sign in as `owner@lakeview.example` and open `/demo`. Every demo screen carries a DEMO / REPLAY badge.
2. Click **Start records scenario**. This creates two records sessions for the same staff member: an office PC and an unfamiliar laptop.
3. Click **Send burst from unfamiliar session**. The gateway's atomic rate budget trips, and the consented 30-minute throttle applies immediately ("Downloads are limited until …").
4. Open **Incidents**. Within a few seconds the worker correlates the burst into one incident: "… downloading unusually fast". The incident page separates **What happened**, **What remains uncertain** and **Already limited**, and recommends the narrowest response.
5. Click **Review who is affected**. The preview shows **Will stop** (only the laptop session) and **Keeps working** (the office session). It also shows "Records already downloaded cannot be recalled." and "Impact on unconnected applications is unknown."
6. Click **Pause this session**. The action page shows real states only. **Action confirmed** appears after the probe reports "Access stopped" for the laptop and "Access remains permitted" for the office session. Containment is assessed separately.
7. Optional: open **Recover safely** from the incident. The flow verifies the person, revokes the old session and issues a fresh one, then confirms the old token is rejected.
8. **Devices → Add device**, then run the simulated agent with the code. On the device page, request an antivirus scan. The command is Ed25519-signed by the worker, verified by the agent and probed. The result is labelled simulated.
9. Sign in as `staff@lakeview.example` and use **Ask Saathi**. Paste a suspicious message. The verdict is `known malicious`, `suspicious`, `no known indicators` or `insufficient information`, and never "safe".
10. Open **Evidence**. Checkpoints are signed and chained. Download a bundle and drop it into `/verify`, which checks it locally in the browser. Hashes, links, signatures, membership and blockchain are reported as separate rows. The timestamp stays **pending** until a Bitcoin attestation is verified against a block header; this environment has no verifier, so it is not confirmed.
11. Switch the language to ಕನ್ನಡ or हिन्दी from the header. The route and incident stay the same.

## Tests

```bash
pnpm typecheck
pnpm lint
pnpm test               # unit + property tests (74)
pnpm test:integration   # real PostgreSQL test database, RLS roles, worker runtime (35)
pnpm test:e2e           # needs web + worker (+ simulated agent for the device test) running
```

Results from the last run are in [docs/verification.md](docs/verification.md).

## Troubleshooting

- **Page reloads endlessly in dev**: a file inside `saathi/` is changing, usually a log file. Move logs out of the workspace.
- **Old styles after a CSS change**: stop `next dev`, delete `apps/web/.next`, then restart (D-020).
- **"Too many sign-in attempts"**: Better Auth's sign-in rate limit (3 per 10 s) is intentionally on. Wait 10 seconds.
- **Git Bash mangles `/app/...` arguments**: prefix the command with `MSYS_NO_PATHCONV=1`.
- **Device shows "Waiting for agent" or "Offline"**: the agent sends a heartbeat every 30 s. Approvals are refused for stale devices by design.
- **Telegram alert links point to `localhost:3000`**: there is no persistent production worker yet — background jobs only run when someone starts `pnpm dev:worker` by hand, and it reads `APP_ORIGIN` from whatever `.env` it's launched with. If you point `DATABASE_URL`/`DATABASE_URL_WORKER` at the production Neon database to process real jobs, also set `APP_ORIGIN` to the production origin for that run (and revert both afterward) — otherwise delivered alerts link back to your local dev server.

## Known blockers and limitations

- **Credentials not provided**:
  - Telegram bot token: linking and webhooks are tested with synthetic payloads only.
  - Anthropic API key: deterministic explanations are always used.
  - S3: a private local object directory is used.
  - Bitcoin node / Esplora: proofs stay pending/unverified (D-018).
- **Windows**: the mutating adapters and the session lock helper were not run on a real machine, because no authorized disposable VM was available. Adapter logic is unit-tested, and observe-only collection was run live (non-elevated; the Security log needs elevation).
- **Python OTS backend**: implemented but unverified, because Python is not installed (D-009).
- **Translations**: Kannada and Hindi are model drafts and need native-speaker review before real use.
- **Evaluation**: false-alert and message-check numbers come from small synthetic sets (D-024). No user study has been run.

## Production boundary

- Use Neon (or managed PostgreSQL) with the same three-role setup. Run `db:migrate` with the owner URL only.
- Use S3-compatible private storage, a worker host with the signing keys in a secret store, and HTTPS for the agent. The agent refuses plain HTTP to non-localhost servers.
- Keep `DEMO_MODE=off` for real tenants.
- Rotate `BETTER_AUTH_SECRET`, `DEVICE_SECRET_ENCRYPTION_KEY` and the signing keys through your secret store. Publish only public keys (`*_PUBLIC_KEYS`).
- Nothing personal or business-identifying is anchored. Only a randomized commitment root goes to OpenTimestamps.
- Saathi has no token, chain or wallet.
