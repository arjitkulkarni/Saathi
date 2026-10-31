# VAJRA Saathi - complete product and system flow

Version 1.0 | 31 October 2026 | Intended behavior, not a statement that the product is already implemented

Read [build.md](build.md) for implementation order, data structures, APIs and release gates. Read [idea.pdf](output/pdf/idea.pdf) for the explanation from everyday language to technical design. All three describe the same organization-neutral product.

## 1. The product in one minute

Saathi helps an owner or administrator who is responsible for computers and information but is not a cybersecurity specialist. It watches enrolled computers and connected applications, combines related warning signs, explains the situation, previews the effect of each response, carries out authorized protection, checks the outcome and guides recovery. It creates a signed evidence record and can attach an independent Bitcoin timestamp later.

An organization can be a clinic, shop, school, NGO, small office or service business. The owner sees familiar terms such as patient records, customer records or business records. The underlying security logic is the same.

```text
Connect -> Observe -> Filter -> Understand -> Preview -> Approve
                                                    |
                                                    v
                                       Act -> Verify -> Recover
                                                |
                                                v
                                   Signed evidence -> External timestamp
```

Policy-approved temporary throttling can occur before a human opens the alert. It reduces exposure while the person decides. The product never waits for an AI explanation or blockchain confirmation to enforce a valid existing policy.

## 2. Who can traverse which parts

| User | Default destination | Can do | Cannot do |
|---|---|---|---|
| Owner | Overview or incomplete setup | Manage organization, members, integrations, policy and recovery; review incidents | Bypass unavailable connector capabilities or rewrite signed history |
| Approver | Overview | Review assigned incidents, preview and approve permitted actions | Change ownership or grant themselves broader authority |
| Staff | Ask Saathi | Submit messages, read own assessment, report concerns | Control devices, view unrelated staff messages or approve containment |
| Auditor | Evidence/reports | Read permitted incident history and export evidence | Run responses or edit policy |
| Device agent | No browser dashboard | Send observations and execute supported signed commands for its device | Act across devices or accept arbitrary scripts |

Navigation visibility improves usability; API authorization enforces these rules even when someone enters a URL manually. A user with multiple organizations must choose an active organization, and every deep link is checked against current membership.

## 3. Screen map and navigation

Use a mobile-friendly application shell with organization name, language selector, coverage indicator and profile menu. Desktop has a sidebar. Mobile has Overview, Incidents, Ask and More. Preserve back navigation, filters and focus when returning from incident detail.

| Route | Purpose / visible content | Main onward paths |
|---|---|---|
| `/` | Brief product explanation and sign-in | `/login` |
| `/login` | Authentication and account recovery | `/onboarding` or authorized destination |
| `/onboarding` | Organization, roles, coverage and notification setup | `/app/overview` |
| `/app/overview` | Needs attention, review today, coverage, recent outcomes | Incident detail, devices, health |
| `/app/incidents` | Filterable incident list with severity and state | `/app/incidents/[id]` |
| `/app/incidents/[id]` | Facts, uncertainty, response options and history | Preview, action status, recovery, report |
| `/app/incidents/[id]/preview/[previewId]` | Stored consequence comparison and approval | Action status or refreshed preview |
| `/app/actions/[id]` | Requested/queued/executing/result, probes and limits | Incident detail, retry preview, recovery |
| `/app/incidents/[id]/recovery` | Guided safe return to normal | Fresh-session check, incident and evidence |
| `/app/devices` | Enrolled devices, last seen, capability coverage | Add device, `/app/devices/[id]` |
| `/app/devices/[id]` | Posture, accounts, observations and supported actions | Device action preview, incident, retirement |
| `/app/people` | Staff and current status | `/app/people/[id]` |
| `/app/people/[id]` | Connected-app sessions, grants, declared dependencies | Access preview, offboarding preview |
| `/app/ask` | Paste text/upload screenshot and own report history | `/app/ask/[id]` |
| `/app/ask/[id]` | Assessment, evidence, uncertainty and next steps | Report incident or permitted campaign review |
| `/app/health` | Posture score components, unknown checks and fixes | Device detail or previewed fix |
| `/app/evidence` | Signed checkpoints and timestamp status | `/app/evidence/[checkpointId]` |
| `/app/evidence/[checkpointId]` | Integrity/signature/anchor details and export | Private download, local verifier |
| `/app/reports` | Incident and weekly reports | `/app/reports/[id]` |
| `/app/reports/[id]` | Readable report, scope and proof status | Download PDF/bundle, incident |
| `/app/integrations` | Connected, read-only, failed and unconnected sources | `/app/integrations/[id]` |
| `/app/integrations/[id]` | Capabilities, freshness, test/revoke | Setup, coverage, associated incidents |
| `/app/settings` | Language, organization, working hours, policy, members and alerts | Dedicated settings panels |
| `/workspace/records` | Reference business application, separate from security console | Authorized record access/download |
| `/verify` | Local file integrity verification | Load bundle, retained checkpoint, timestamp help |
| `/demo` | Privileged synthetic scenario/replay controls | Live console with persistent demo badge |

“Preview” on people/devices opens a shared preview component using the respective API. If the action is not attached to an incident, use `/app/previews/[previewId]`; approval still goes to `/app/actions/[id]`. Health fixes use the same flow. Do not invent separate authorization logic for each screen.

## 4. First-time owner journey

### 4.1 Create the organization

The owner signs in and selects a type, display name, preferred language, timezone and working hours. Example types are clinic, retail, education, NGO, service business and other. The next screen explains coverage: Saathi sees only enrolled devices and integrated applications.

Backend creates the organization, owner membership and initial policy transactionally. Default dashboard state is “No sources connected yet.” A score or green “protected” banner must not appear before observations exist.

### 4.2 Add people and responsibilities

Owner invites an approver and staff, assigns roles, and establishes a recovery identity. They describe shared accounts and critical software. Example: “Billing runs on Front Desk PC under the counter account.” This dependency is tagged as owner-declared, with date and confidence.

The product explains the difference between a person, their account and one session. One person can have several sessions, and blocking a session is narrower than disabling an account. If the owner cannot describe a dependency, mark it unknown rather than forcing a guess.

### 4.3 Connect a computer

Owner opens Devices -> Add device -> Generate enrollment code. The page explains the permissions and supported observations. An authorized local administrator installs the agent and enters the code. Enrollment consumes the code once and binds the device to the organization.

The device card progresses through “Waiting for agent,” “Connected,” and “Checks incomplete/Ready for supported actions.” It displays last seen, supported controls and prerequisites. Missing logging permissions produce a setup task, not silence presented as safety.

### 4.4 Connect a business application

Integrations lists each source with visibility and enforcement capabilities separately. The built-in records workspace is clearly labelled a reference integration using synthetic data. For existing software, setup must establish source authentication, session identification, protected operations and probe behavior.

A read-only connector says “Can observe; cannot block.” An unconnected billing system remains outside the preview's guarantee. This distinction appears again when the owner approves an action.

### 4.5 Choose temporary automation

Explain: “When a connected session downloads unusually fast, may Saathi temporarily limit it while you review?” Show exact scope, thresholds, duration, legitimate-user impact and expiry. The initial proposed throttle is one download per minute for 30 minutes; it is a configurable preset requiring evaluation.

Owner can accept or decline. Consent records a policy version. Declining leaves notifications/manual responses available. Enabling temporary throttling does not authorize account disabling, file deletion or broad device restrictions.

### 4.6 Link notifications and finish

Owner links a private Telegram chat using a one-use code, then sends a test notification. Alert links require web login. Setup finishes with a coverage summary: enrolled devices, enforceable applications, read-only sources, unknown dependencies and incomplete checks.

Return path: Settings changes preferences; Devices adds computers; Integrations adds applications. Organization changes do not imply that every source is now protected.

## 5. Normal daily use

The overview answers four questions: What needs me? What has already been handled? What is not visible? What should I improve next?

- “Needs attention” lists actionable incidents without technical event codes.
- “Review today” contains lower urgency concerns and recovery tasks.
- “Handled automatically” states exactly what happened, such as a temporary limit, and when it expires.
- Coverage shows device freshness and application boundaries alongside health.

Each count opens the filtered list that produced it. A funnel such as raw events -> aggregated signals -> incidents uses actual stored dispositions for the selected time range. Replays show a REPLAY label. An empty list says “No incidents detected in connected sources,” not “Your organization is safe.”

The worker schedules weekly summaries. A previously remediated malware detection may go to the digest, while unresolved malware requires review. Facts remain available in history even when notifications are suppressed.

## 6. Main incident journey: suspicious records access

This example works for any organization. A staff member has a normal office session and another session on an unfamiliar device. The unfamiliar session begins downloading many business records.

### Step A - observe and reduce exposure

Every download reaches the records gateway before content is served. It validates the application session, account status, grants and current restrictions. It atomically counts/reserves the allowed operation. When a configured threshold is reached, a consented temporary limit is applied in the same transaction. The gateway writes an event and audit intent.

Without automation consent, the gateway retains ordinary access rules and raises a review event. Without a connected enforcement point, Saathi can alert but cannot promise to stop the download. Already delivered data remains outside its control.

### Step B - make one incident

Worker normalizes observations, preserves counts, groups related events and writes an incident with template keys. It records: observed download rate; unfamiliar device signal; uncertain identity/intent; current restriction; known and unknown scope. A legitimate bulk task remains a possible explanation.

Telegram says “An application needs review.” The owner follows the link, signs in if needed, and lands on the incident after authorization. If the owner is already in the console, the incident appears through polling. Notification failure is visible but does not erase the incident.

### Step C - understand the card

The card displays:

1. **What happened:** “This session requested many records in a short time.”
2. **What we do not know:** “We have not confirmed whether this is an authorized export.”
3. **What already happened:** “Downloads are temporarily limited until [time],” if applicable.
4. **Suggested response:** “Pause this session while you check with the staff member.”
5. **Scope:** connected application and observation timestamp; unconnected sources excluded.

The owner can change language, listen where supported, request an optional explanation or view source facts. None of these controls changes authority or policy.

### Step D - compare consequences

“See who is affected” creates a server-side preview and opens comparison cards.

| Option | Stops or limits | Keeps working within known scope | Important boundary |
|---|---|---|---|
| Pause suspicious session | Requests from that application session | The staff member's other permitted session | Previously downloaded records cannot be recalled |
| Disable connected-app account | Covered account capabilities according to connector semantics | Other staff accounts | Existing tokens/sessions must be assessed and revoked where supported |
| Continue investigation | No additional restriction | Existing authorized access | Exposure can continue; temporary throttle may expire |

Show unknown dependencies, reversibility and freshness next to the action. Never bury them in a tooltip. Approval names the action, target and scope, for example “Pause this records session.” No “Fix everything” button.

### Step E - approve and recheck

The browser submits the preview ID and an idempotency key. The server rechecks current actor authority, preview expiry, relevant versions and state under the locking protocol in `build.md`.

- If another relevant session/grant appeared, show “The situation changed. Review the updated effect.” No action has run; the owner must approve the new preview.
- If nothing relevant changed, create the action and apply the policy transactionally.
- If the user double taps or retries after a network interruption, the same logical action is returned.

### Step F - show the actual outcome

Action status is requested -> queued/executing as applicable -> confirmed, partial, failed or unknown. For this synchronous application control, it may advance rapidly to confirmed after the probe. The UI still uses persisted state rather than a fake timed animation.

The probe demonstrates target-session denial and checks the intended unaffected capability. The incident can be contained for its defined scope only when all identified harmful capabilities are covered. A remaining USB exposure or missing integration keeps the assessment qualified.

### Step G - recover safely

Owner opens Recover, verifies the staff member through a trusted channel, addresses credential compromise if relevant and reviews remaining findings. The old paused session is revoked; a fresh login is issued. The product verifies the fresh authorized session and rejects the old token.

If checks fail, recovery remains blocked with a reason. If successful, the incident becomes recovered for the documented scope. New relevant evidence can reopen investigation. The history and proof remain available.

## 7. Windows incident journey

The agent observes actual events and sends authenticated batches over outbound HTTPS. It does not need an inbound port on the office router. The device's log cursor and offline queue survive restarts.

Related login failures and removable-storage observations can become one incident with distinct findings. The card explains observations without asserting that a pen drive or wrong password proves an intruder.

The owner opens a preview for a supported action. The backend stores approval, the worker signs a short-lived command, and the agent polls for it. The agent checks signature, target, allowed action, parameters, expiry, nonce and local preconditions before execution. It reports observed postconditions, not only a command exit code.

Specific screen behavior:

- **Lock screen:** report the intended session locked only after session-aware observation. Explain that locking is not termination of background activity or a universal response to password guessing.
- **Block new removable storage:** display the policy's exact scope; an already-mounted drive may remain usable. Do not call that existing copying path contained.
- **Disable a local account:** explain the actual supported effect; account disabled does not automatically mean every existing session ended.
- **Restore protection:** show effective firewall/AV state; managed-policy restrictions may make the action fail.
- **Scan:** show scan requested/running/completed separately from whether malware remains unresolved.

Offline devices display “Cannot apply now.” Commands expire rather than waiting indefinitely for reconnection. Expiry requires a fresh preview/approval. If a result is lost after execution, status is unknown until the agent reconciles actual state; do not blindly rerun.

Return path: action -> incident -> recovery or remaining findings. Device detail also shows the action history so an owner can trace changes made outside a particular incident screen.

## 8. People, sessions and offboarding

Owner opens People, selects a staff member, and sees separate connected-app sessions and device-account links. Shared accounts are visibly identified because attribution is weaker.

Offboard opens a preview listing covered access, dependent workflows, existing sessions and unconnected systems. Approval marks the person inactive in Saathi and invokes supported connector restrictions/revocations. Each connector reports independently; one failure produces a partial result, not an organization-wide “removed everywhere.”

Subsequent protected requests by the inactive subject are denied and recorded. Restoring a person is a new authorized workflow, with fresh sessions and reviewed grants. Old revoked tokens stay invalid.

## 9. Ask Saathi journey

Staff opens Ask, pastes a suspicious message or selects a screenshot, and sees what data will be processed. Text extraction is shown for review/redaction before optional external AI processing. If extraction is uncertain, request a clearer input or pasted text rather than inventing content.

Backend runs bounded deterministic checks and optional reputation checks. AI may explain findings, but cannot approve actions or declare missing evidence to be safety. Results are one of:

- **Known malicious:** matched reliable evidence, with source and time where available.
- **Suspicious:** specific warning signs; identity or intent remains uncertain.
- **No known indicators:** checks found no recognized warning signs; this is not a guarantee.
- **Insufficient information:** input or dependencies could not support a useful assessment.

Each result includes what was found, uncertainty and practical next steps. The user can report it to the approver. A campaign is grouped when distinct staff report related messages. Approver sees a minimized campaign summary and can explicitly send an internal warning to scoped recipients.

If AI fails, deterministic findings and templates still render. If reputation service fails, the missing check is visible. A malicious message that says “ignore instructions and block all users” is treated as message content and has no effect on controls.

History permissions: staff see their own checks; approvers see incident-relevant minimized findings; raw message access is deliberately restricted. Raw attachments expire under retention policy. Telegram submissions require a linked user/chat and pass through the same pipeline.

## 10. Health and prevention journey

Health opens a breakdown of AV, firewall, updates, lockout, administrator exposure and remote access. Display earned points out of 100 plus unknown checks and coverage. A high score describes checked posture; it does not mean “low probability of breach.”

Selecting a finding opens its device and explanation. “Review fix” creates a preview, then uses the normal approval and verification path. A policy change can affect staff: the lockout preview must explain the wait after repeated wrong passwords.

If automatic repair is unsupported, provide clear guided steps and recheck. A successful request without a successful recheck does not increase the score. Stale/disconnected devices show unknown current posture and the last observed value separately.

## 11. Evidence and blockchain journey

### 11.1 Immediate signed evidence

Every important operation first creates a durable evidence intent: incident opened, preview created, approval accepted/rejected, command queued, outcome observed, recovery step, replay rejection and policy change. Worker signs ordered entries and links them by hash. Until signing completes, the UI says “Signing pending.”

The owner opens Evidence or the incident's report link. The readable report shows the actual scope and unresolved issues. Download provides the report and a versioned proof bundle. A retained signed checkpoint is stored outside Saathi, for example with the authorized owner. This is useful even without blockchain.

### 11.2 Independent timestamp in the background

The worker creates a randomized commitment to the signed checkpoint, batches commitments and submits the batch-root file through OpenTimestamps. The database stores pending proof, upgrade attempts and eventual verified blockchain evidence.

The customer does not create a wallet or buy cryptocurrency. The UI uses “Independent timestamp,” with technical details available on demand. States mean:

| Status | User meaning |
|---|---|
| Not requested | No timestamp task exists for this checkpoint |
| Pending/submitted | Proof requested; public confirmation not yet verified |
| Confirmed | The configured verification method checked a Bitcoin attestation; method and time shown |
| Retrying/failed | Timestamping could not complete; signed evidence still exists |
| Invalid | Supplied proof did not verify; do not trust that timestamp claim |

Neither a calendar acknowledgment nor a transaction link is enough to display confirmed. Show whether verification used an independently validating node or a prototype external service. A later proof update does not change the underlying incident record.

### 11.3 Verify a downloaded bundle

The owner/auditor opens `/verify` or the downloaded standalone verifier and selects local files. Files remain local for the integrity check. The verifier performs:

1. Canonical data/hash recomputation and sequence/link checks.
2. Signature validation using trusted pinned keys.
3. Match against the separately retained signed checkpoint.
4. Commitment and Merkle membership validation against the root.
5. Bitcoin timestamp verification only when appropriate validated chain context is available.

Display each result separately. With Wi-Fi off and no trusted chain context, integrity may pass while the blockchain check says “Not checked offline.” Do not conflate those results. The standalone verifier must be downloaded before going offline; an uncached web URL is insufficient.

### 11.4 What the evidence means

It establishes consistency with the signed and externally anchored commitment. It does not prove the original observations were true, prove no event was omitted, establish exact incident time, guarantee containment, recover deleted records or confer legal compliance. A chain of hashes in Neon alone is not a public blockchain.

Customer story: an owner can show what Saathi recorded and check whether that retained version was altered later. Core security benefits remain in detection, decisions and verified enforcement.

## 12. Complete end-to-end technical sequence

```mermaid
sequenceDiagram
  participant R as Records session
  participant API as Next.js API / domain services
  participant DB as Neon
  participant W as Durable worker
  participant U as Approver browser
  participant A as Windows agent
  participant O as OTS / Bitcoin
  R->>API: Protected operation
  API->>DB: Lock guard, authorize, reserve budget
  DB-->>API: Decision + durable event/outbox
  API-->>R: Content, throttle, or denial
  W->>DB: Claim event job
  W->>DB: Correlate incident and enqueue notification
  U->>API: Read incident (after login)
  API-->>U: Facts, uncertainty, known scope
  U->>API: Create action preview
  API->>DB: Persist snapshot/version/consequences
  API-->>U: Stops, limits, keeps, unknown, undo
  U->>API: Approve preview + idempotency key
  API->>DB: Recheck actor/state under guards
  alt Relevant state changed
    API-->>U: 409; fresh preview required
  else Application policy action
    API->>DB: Apply restriction + action + evidence intent
  else Device action
    API->>DB: Queue action + evidence intent
    W->>DB: Sign and store bounded command
    A->>API: Poll, validate, execute, report probe
    API->>DB: Save action outcome and containment assessment
  end
  U->>API: Poll action/incident
  API-->>U: Actual outcome and remaining concerns
  W->>DB: Sign evidence and checkpoint
  W->>O: Timestamp commitment asynchronously
  O-->>W: Pending proof, later upgradable attestation
  W->>DB: Store independently checked proof/status
```

Frontend uses shared schemas to display backend decisions; it does not determine permissions. APIs and Server Component loaders use the same server-only DAL. Worker and gateway reuse domain functions. The agent executes only a signed bounded command. Blockchain contains a commitment, not a copy of the organization's security database.

## 13. Failure and recovery paths

| Situation | What the user sees | Correct system behavior / next path |
|---|---|---|
| Session expired | Sign in to continue | Preserve intended destination; recompute preview after return |
| Role removed | You no longer have permission | Reject action even if page was open earlier |
| Device offline | Last seen and unavailable controls | No false confirmation; await reconnection and fresh approval |
| Source data stale | Last observed time and uncertainty | Do not imply current health; disable unsafe previews |
| Preview expired/changed | Review updated consequences | No old action applied; require new approval |
| Network lost after approval | Checking action status | Fetch by idempotency key/action ID; do not submit a new blind action |
| Action partially worked | What worked and what remains | Keep incident unresolved where required; offer next supported preview |
| Probe timed out | Outcome unknown | Reconcile actual state; avoid “failed means nothing changed” assumption |
| Database unavailable | Service temporarily unavailable | Protected gateway fails closed/unavailable; agent queues observations locally |
| Worker unavailable | Processing delayed | Durable jobs remain; synchronous existing policy remains enforced |
| Telegram unavailable | Notification failed; incident remains visible | Retry with dedupe and offer web review |
| AI unavailable | Template explanation | No change to policy or authorization |
| Blockchain service unavailable | Timestamp pending/retrying | Signed evidence and protection continue |
| Integrity mismatch | Verification failed at specific step | Do not discard original evidence; investigate or obtain authentic bundle |
| Retained checkpoint missing | Cannot independently check expected final checkpoint | Show what can be verified and what cannot |
| Temporary throttle expires | Limit expired; review remaining risk | Audit expiry and notify; independent pause/revocation remains |
| Recovery verification fails | Recovery not complete | Preserve required restrictions and identify next step |

## 14. Organization-neutral examples

| Organization | Familiar story | Same underlying mechanism |
|---|---|---|
| Clinic | Reception login exports appointment records unusually fast | Session-specific throttle/pause and continued legitimate access |
| Shop | Billing PC protection is off and an unexpected storage device appears | Posture finding, bounded device response and effect preview |
| School | Staff account requests many student records from an unfamiliar session | Correlation, impact comparison, approval and recovery |
| NGO | Former volunteer credentials are used in a connected application | Offboarding policy denial and audit history |
| Service office | Several staff receive a similar suspicious invoice message | Staff reports, uncertain scam assessment and approved campaign warning |

These are illustrative scenarios using made-up people and data. They do not imply built-in integrations with every clinic, retail or education system. Vocabulary selection changes language and examples, not the actual capabilities of a connector.

## 15. Demonstration traversal

For a short stage presentation, prepare one authorized device and two synthetic application sessions. Keep a confirmed timestamp example ready and identify it as an earlier sample.

1. Overview: show actual source coverage and no incident currently selected.
2. Reference records app: generate suspicious repeated requests from session A.
3. Incident: show one clear explanation and the temporary restriction if consented.
4. Preview: compare pausing A with a broader account action; show session B remains permitted.
5. Action: approve; demonstrate A denied and B still working.
6. Negative case: change relevant state and show stale-preview rejection, or show an honest device-action failure.
7. Evidence: verify a signed bundle and the earlier confirmed timestamp. Modify a copy and show failure.
8. Briefly switch vocabulary to another organization type without claiming new integration coverage.

Longer walkthrough also includes onboarding, a real Windows observation/action, Ask Saathi, health fix, recovery with old-token rejection, weekly report and offline integrity verification. Replays and synthetic seed counts are always labelled. The full application should be traversable without entering a demo mode.

## 16. Completion definition

The intended experience is complete when every screen has a genuine authorized data source, every mutation uses the shared services, every promised control has a supported adapter and probe, and every failure state has an honest next step. No success toast substitutes for enforcement, no blockchain badge substitutes for verification, and no green overview substitutes for coverage.

Production adds installation support, connector validation, security review, operations, retention agreements and real-user evaluation. The full architecture and implementation gates are in [build.md](build.md).

References: [Kodikon Track 3](https://www.embrionepes.in/kodikon-6), [Microsoft lock semantics](https://learn.microsoft.com/en-us/windows/desktop/api/Winuser/nf-winuser-lockworkstation), [OpenTimestamps](https://opentimestamps.org/), and [official proof client](https://github.com/opentimestamps/opentimestamps-client). All detailed UI copy, state models and sequences here are proposed Saathi behavior.
