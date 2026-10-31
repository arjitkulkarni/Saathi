# Saathi Windows agent

The agent is the device side of Saathi (build.md Ph05, Ph09). It sends authenticated observations and heartbeats over outbound HTTPS, polls for signed commands, and runs only a fixed set of supported actions. It never accepts executables, script bodies, file paths or command lines from the server.

Code: [apps/agent/src](../apps/agent/src). Lock helper: [apps/agent/windows-helper](../apps/agent/windows-helper).

## Modes

| Mode | Flag | What it does | Where to use it |
|---|---|---|---|
| Observe-only | `--observe-only` | Real event collection and posture reads. Every action is reported as unsupported ("observe-only mode"). | Any authorized machine, including a developer's everyday PC |
| Simulated | `--simulate` | In-memory device with synthetic accounts and posture. Every result carries `simulated: true`, the `simulated` boundary and a `simulated` probe, and the console labels it "Simulated device (test fixture)". | Tests and labelled demonstrations only (decision D-015) |
| Full | _(no flag)_ | Real collection and real policy changes. | **Only** on an authorized, disposable Windows test VM. Never on an everyday machine. |

Each state directory is bound to the mode it enrolled in, so use a separate `--state-dir` per mode.

## Install and run

Prerequisites: Windows 10/11, Node.js 22+ and pnpm, and the Saathi workspace checked out (`pnpm install`).

1. In the console, open **Devices → Add device**, name the computer and generate an enrollment code. The code works once and expires after 15 minutes.
2. On the computer, from `saathi/`:

```powershell
# observe-only (safe)
pnpm dev:agent -- --observe-only --server https://your-saathi.example --code ABCD-EFGH-JKLM
# simulated test device (labelled)
pnpm dev:agent -- --simulate --server http://localhost:3000 --code ABCD-EFGH-JKLM --state-dir .local\agent-sim
# full mode on a disposable VM, protecting the recovery administrator
pnpm dev:agent -- --server https://your-saathi.example --code ABCD-EFGH-JKLM --recovery-account S-1-5-21-...-500
```

Other options:
- `--state-dir <dir>`: defaults to `%ProgramData%\SaathiAgent`, or `%ProgramData%\SaathiAgent-simulated` in simulated mode.
- `--duration <seconds>`: run, then stop.
- `--verbose`: log each heartbeat and collection pass.

Plain HTTP is refused except for `localhost`.

After enrollment, run the same command without `--code`. The device secret and the pinned command-verification keys are in `device.json`.

To run unattended, register the agent as a service with a service wrapper such as NSSM (`node --import tsx src/index.ts ...`) running as LocalSystem. Service packaging and signed updates are production work, not part of this prototype (build.md §9).

## What the agent sends

| Channel / source | Event IDs | Saathi type | Facts sent (minimized) |
|---|---|---|---|
| Security | 4625 | `auth.failed` | user name, SID, source address, logon type, status |
| Security | 4624 (logon types 2, 3, 7, 10, 11; machine and service accounts skipped) | `auth.succeeded` | user name, SID, logon type, source address |
| Security | 4720 | `account.created` | user name, SID |
| Security | 4732 (Administrators group only) | `account.admin_added` | member SID and name |
| Microsoft-Windows-Partition/Diagnostic | 1006 (capacity > 0) | `storage.attached` | manufacturer/model label, bus type, capacity |
| Windows Defender/Operational | 1116 / 1117 / 5001 | `malware.detected` / `malware.remediated` / `protection.disabled` | threat id, threat name, severity/action |

**Posture**, sent every 5 minutes with the heartbeat, is pass, fail or unknown, each with its source and observation time:

| Check | Source | Pass when |
|---|---|---|
| `av` | `Get-MpComputerStatus` | Real-time protection is on |
| `firewall` | `Get-NetFirewallProfile` | All profiles are on |
| `updates` | `Get-HotFix` | Latest update was installed ≤ 45 days ago |
| `lockout` | `net accounts` | Threshold is between 1 and 20 |
| `admin_exposure` | Local Administrators group | ≤ 2 enabled admin accounts |
| `remote_access` | `fDenyTSConnections` | Remote Desktop is off |

A read that fails is reported as `unknown`, never as a pass.

**Reliability:**
- **Heartbeat:** every 30 s, separate from event volume.
- **Bookmarks:** each channel's bookmark is persisted only after its events are in the spool. A cleared or recreated log starts a new `logEpoch`.
- **First run:** collection starts at the current position; history is not imported.
- **Spool:** `spool.jsonl` is capped at 5 MB. New events beyond the cap are dropped and counted, and the count is reported (`droppedSinceLast`, `droppedEvents`), so the gap is visible.

**Prerequisites** are reported in every heartbeat and shown on the device page, never silenced:
- `elevated`
- `security_log_access`: the Security log needs administrator rights.
- `defender_available`
- `admin_group_readable`
- `state_dir_acl`: result of the best-effort `icacls` restriction to SYSTEM, Administrators and the agent user.

## Commands

**Transport:**
- Every request carries an HMAC-SHA256 signature over `METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)` using the per-device secret. The server enforces a ±300 s clock window and nonce uniqueness.
- Command polling runs every 2 s while commands are active, backing off to 30 s when idle or offline.

**Verification order** (`src/verify.ts`):
1. Allowed type (else `unsupported`).
2. Envelope schema.
3. Organization (`wrong_org`), then device (`wrong_device`).
4. Pinned key id (`unknown_key`).
5. Ed25519 signature over `sha256(canonical(envelope minus signature))` (`bad_signature`).
6. Only after the signature verifies: expiry (`expired`), nonce ledger (`replayed`), and parameter bounds from `DEVICE_ACTION_PARAMS` (`invalid_params`).

**Execution** (`src/executor.ts`):
- The receipt and nonce are written to `ledger.json` **before** execution. Local preconditions run next: protected identities (`protected_identity`), the account still existing, undo still owned (`precondition_changed`). The receipt is then marked `applying`, the adapter applies the desired state, and postcondition probes run.
- The outcome comes from the probes:
  - all pass → `confirmed`
  - some pass → `partial`
  - none pass → `failed`
  - not observable → `unknown`

  An exit code alone never confirms.
- A redelivered command returns its stored result and never reruns.
- After a crash between apply and record, startup reconciliation reports `confirmed` only if the desired state is observed, otherwise `unknown`. It never blindly reruns.
- The agent refuses to disable:
  - the recovery account (`--recovery-account`)
  - the agent's own identity
  - the last enabled administrator

## Adapters: what each can and cannot prove

| Action | Implementation | Probe evidence | Boundary |
|---|---|---|---|
| Lock session | Named pipe `\\.\pipe\saathi-lock` → `SaathiLockHelper.exe` in the user session → `LockWorkStation` | `session_locked` passes only on an observed `WTS_SESSION_LOCK` for that session | Does not stop programs or network activity; not a response to remote password guessing |
| Disable local account | `Disable-LocalUser -SID` | `account_disabled` (Enabled=False). `new_login_denied` is reported `unknown`: it would need a test credential. | Existing sign-ins are assessed separately |
| Block new removable storage | Device-installation policy `DenyRemovableDevices=1`; prior value saved | `storage_policy_effective` plus `mounted_removable_volumes` (count must be 0) | An already-mounted drive may stay accessible. If one is mounted the outcome is `partial`. |
| Turn on firewall | `Set-NetFirewallProfile` | `firewall_profile_enabled` (effective state) | Does not block every unwanted connection; management policy can override |
| Lockout policy | `net accounts /lockoutthreshold /lockoutduration` (argument array) | `lockout_threshold` read back | Staff who mistype passwords must wait |
| Block source IP | `New-NetFirewallRule` named `Saathi block <ip>` | `rule_present` **and** `rule_matches` (inbound, block, enabled, exact address) | Rule existence alone is not proof |
| Turn on real-time AV | `Set-MpPreference -DisableRealtimeMonitoring $false` | `av_realtime_enabled` | Tamper protection or management can refuse |
| Request AV scan | `MpCmdRun.exe -Scan` started asynchronously | `scan_status` (a scan started after the request) | Scan completion is not proof of eradication |
| Undo | Restores the saved prior state only if current state equals the Saathi-applied state | `prior_state_restored` | Later administrator changes are never overwritten |

**Undo identifier:** the agent resolves `params.changeId` against its own change id **or the original action id**. The server currently sends `device_changes.id`, so the console should send the original action id (see the integration note in docs/progress.md).

## Lock helper

```powershell
pnpm --filter @saathi/agent build:helper   # compiles with %WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
```

Run `apps\agent\windows-helper\bin\SaathiLockHelper.exe` **in the interactive user's session**, for example from a Startup shortcut or a logon scheduled task. The pipe ACL admits only LocalSystem and that user. The helper:
- accepts only `LOCK <hex nonce>`
- replies `LOCKED <nonce> <sessionId>` after observing the lock notification
- otherwise replies `NOT_OBSERVED <nonce>`

## Uninstall

1. Stop the agent (and its service wrapper, if any).
2. Delete the state directory, which holds the device secret and ledger.
3. Retire the device in the console. Retiring stops new commands, but a command already delivered may still run before it expires (60 s).
4. Remove the helper's startup entry.

Settings Saathi changed stay in place until an authorized local administrator restores them, or until an undo is approved before retirement.

## Verification status (2026-10-31)

| Check | Environment | Result |
|---|---|---|
| Unit tests (`pnpm --filter @saathi/agent test`) | Node 24, Windows 11 | 23/23 pass. Covered: every rejection reason, receipt-before-execute, no rerun on redelivery, crash reconciliation, protected identities, undo ownership, partial for mounted storage, spool cap/drops, HMAC string, event normalization, unknown-not-pass posture. |
| Lock helper compile | csc 4.x (.NET Framework), this machine | Builds `SaathiLockHelper.exe`. **Not executed**: this machine is never locked. |
| Observe-only live run | Developer PC (Windows 11 Home 10.0.26300, non-elevated) against local web + worker | Enrolled. Heartbeats, capabilities (0/9 supported) and 7 local accounts accepted. Posture read: av pass (tamper on), firewall pass (all on), updates pass (17 days), lockout pass (10), admin_exposure pass (1 admin), remote_access pass (RDP off). **Security log not readable** (`access_denied`; prerequisite reported unmet). Partition and Defender channels were readable with 0 new events in the window. |
| Simulated live run | Same machine, separate state dir | Enrolled as simulated with 9/9 capabilities. Synthetic posture accepted; the failing firewall became a `protection.disabled` observation. |
| Mutating adapters on real Windows | — | **Blocked**: no authorized disposable Windows VM. Full-mode actions remain unverified live. |
| Helper lock observation | — | **Blocked**: same reason. |
| Elevated Security-log collection | — | **Blocked**: running elevated on the developer PC was not authorized for this task. |
