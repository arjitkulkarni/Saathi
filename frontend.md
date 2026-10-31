# VAJRA Saathi - frontend design and implementation specification

Version 1.0 | 31 October 2026 | Design specification, not an implemented frontend

Companions: [build.md](build.md), [flow.md](flow.md), and [idea.pdf](output/pdf/idea.pdf).

Primary visual reference: [incident.io - Incident response in Slack](https://incident.io/incident-response-slack), inspected in the browser on 31 October 2026. The previous ACM website specification from this filename is preserved in [frontend-acm-2026-10-24.md](frontend-acm-2026-10-24.md). It is a separate project's brief and does not govern Saathi.

## 1. Design objective and relationship to the other specifications

Create a polished, calm and approachable security product for owners and staff who have no cybersecurity expertise. The interface must help someone understand an incident, compare the consequences of a response, approve it, and see what actually happened. It must be credible and legible during a live presentation and useful on an ordinary phone afterwards.

The requested visual direction is close to the linked incident.io page: warm light surfaces, confident editorial headings, restrained coral accents, clear product panels and generous spacing. Preserve Saathi's name, content, identity and actual capabilities. The application should feel like the same product as its landing page.

This document defines **presentation and frontend implementation**. `build.md` defines authoritative architecture, APIs, permissions, policy and verification. `flow.md` defines journeys, routes and transitions. Do not change a backend state or invent a workflow to fit a visual effect. If a design needs an absent field, explicitly extend the shared contract before displaying it.

The goal for hackathon judging is immediate understanding and visible proof of the central idea. No style guarantees a prize. Design effort should make the mechanism easy to follow: suspicious access stops within its documented scope while legitimate access continues.

### Core commitments

1. One important decision at a time, with a clear primary action.
2. Facts, uncertainty, consequences and verified outcomes are visually distinct.
3. Beautiful whitespace without hiding essential scope or warnings below decorative content.
4. Organization-neutral wording, with clinic/shop/school/NGO vocabulary from the existing localization model.
5. Light appearance by default; complete the light experience before considering another theme.
6. Subtle animation explains interaction and state changes. The backend determines whether an action succeeded.
7. Every useful screen has loading, empty, partial, stale, unavailable and permission-aware states.

## 2. How to translate the reference

Observed reference characteristics: the public page has a centered serif hero, sans-serif supporting copy, rounded coral and pale secondary CTAs, abundant white space, warm cream product stages, split text/visual feature sections, thin separators and restrained shadows. Feature selectors reveal different product illustrations. Its product illustrations communicate workflows, while the surrounding page explains their purpose.

The reference is a marketing page, not a specification for Saathi's authenticated console. The following dimensions and tokens are Saathi design choices, not measured copies of its CSS.

| Reference quality | Saathi interpretation |
|---|---|
| Large editorial hero | A short serif headline explaining security decisions to ordinary people |
| Warm product illustration stage | A live-looking, labelled example of incident -> preview -> verified result |
| Coral emphasis | Primary marketing CTA, selected navigation accents and active feature tabs |
| Short copy beside a product panel | Explain one Saathi capability at a time with concrete consequences |
| Soft card boundaries | White application surfaces on a warm neutral canvas |
| Spacious section pacing | Clear separation of explanation, preview and outcome |
| Product-centered storytelling | Demonstrate a real Saathi workflow rather than decorative technical imagery |

Use an original typographic Saathi wordmark and a simple companion/shield/check motif if needed. Do not import incident.io logos, customer marks, testimonials, screenshots or its seasonal mascot as Saathi assets. Recreate interface examples with Saathi components and labelled synthetic data. The reference's Slack interface is not a Saathi feature: our notifications use Telegram and our decisions occur in the authenticated web app.

## 3. Visual system

### 3.1 Color tokens

Warm cream, near-black ink and coral are the governing palette. This replaces the earlier conversational teal proposal for this frontend only; it does not change the architecture or workflows in the companion documents.

| Token | Value | Use |
|---|---|---|
| `canvas` | `#FFFFFF` | Public page and main reading surfaces |
| `canvas-warm` | `#F8F6F2` | App background, hero example stages |
| `surface` | `#FFFFFF` | Cards, forms, dialogs |
| `surface-subtle` | `#F1EFEB` | Secondary controls and inactive panels |
| `ink` | `#242420` | Headings and main body |
| `ink-secondary` | `#60605A` | Supporting text and metadata |
| `brand-art` | `#F65B3A` | Decorative accents and larger non-text visual details |
| `brand-action` | `#BE3E24` | Primary buttons with white text; deliberately deeper than decorative coral |
| `brand-action-hover` | `#A5331D` | Hover/active action and brand-colored links |
| `brand-soft` | `#FCEBE5` | Selected navigation background and non-status emphasis |
| `border-subtle` | `#E4E0D9` | Decorative divisions and card edges |
| `border-control` | `#8A877F` | Inputs where a visible boundary is required |
| `focus` | `#182E54` | Keyboard focus outline, separate from status color |
| `success-ink` / `success-soft` | `#176344` / `#EAF5EE` | Observed successful postcondition |
| `warning-ink` / `warning-soft` | `#8A5000` / `#FFF4D8` | Review needed, uncertainty and approaching expiry |
| `danger-ink` / `danger-soft` | `#A52B28` / `#FDEDEC` | Failed operation or urgent risk, with explicit labels |
| `neutral-ink` / `neutral-soft` | `#68665F` / `#F1EFEB` | Unknown, unavailable or inactive state |

Do not use bright coral with small white text. The specified white/`brand-action` pair has approximately 5.38:1 contrast. `ink-secondary` on white is approximately 6.33:1 and on `canvas-warm` approximately 5.86:1. Listed status-ink/status-soft pairs exceed 4.5:1 in static calculations. Recheck rendered combinations, disabled states, icons, focus and overlays in the actual implementation.

Brand coral is not a severity signal. Always accompany status with a word and an icon. Use the same destructive-action treatment everywhere; do not let a normal navigation button look like an emergency alert.

### 3.2 Typography

- **Display:** Georgia initially, or a locally hosted licensed editorial serif such as Lora after testing. Use it for the landing hero and major marketing section headings. The reference-like serif/sans pairing is a key part of the visual direction.
- **Product UI:** Inter, with a system sans-serif fallback. Use sans-serif for app headings, incident descriptions, controls and tables so operational information is quick to scan.
- **Regional text:** Noto Sans Kannada and Noto Sans Devanagari, loaded when needed. Use a tested suitable fallback and do not force Latin tracking or tight line heights on these scripts.
- **Technical values:** system monospace for hashes and IDs inside expanded details only.

| Element | Desktop | Mobile | Line height |
|---|---|---|---|
| Landing hero | 64-76px serif | 38-46px serif | 1.08-1.15 |
| Marketing section heading | 38-48px serif | 30-34px serif | 1.15-1.25 |
| App page heading | 28-32px sans, 600 | 24-28px | 1.25-1.35 |
| Incident explanation | 18px | 17-18px | 1.55-1.65 |
| Standard body | 16px | 16px | 1.55-1.65 |
| Controls and rows | 14-16px | 15-16px | At least 1.4 |
| Secondary metadata | 13-14px | 14px | At least 1.45 |

Keep explanation text near 60-70 characters per line. Do not justify paragraphs. Labels are sentence case. Use tabular numerals for timestamps/countdowns to avoid movement. Critical warnings never use microtype. Regional copy can wrap and increase card height naturally.

### 3.3 Geometry and density

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96, 120px.
- Marketing content width: 1160-1200px. Hero text width: 800px; supporting paragraph: 660px.
- App reading width: up to 1180px, with an incident explanation column ideally 680-760px.
- Marketing section padding: 96-112px desktop and 56-64px mobile.
- App section gap: 24-32px; card padding: 24px desktop, 18-20px mobile.
- Card radius: 14-18px. Large illustration stage: 20-24px. Controls: 10-12px. Marketing CTA: pill shape.
- Main controls: at least 44px high; primary mobile controls 48px. Dense table menu buttons retain a 44px interaction area.
- Resting card shadow: `0 2px 8px rgb(36 36 32 / 4%)`; elevated preview/dialog: `0 12px 32px rgb(36 36 32 / 8%)`.
- Thin borders establish structure. Do not place translucent glass, gradients or moving textures behind essential text.
- Use one consistent outline icon family, such as Lucide, with 18-20px navigation icons and 20-24px status icons.

## 4. Public landing page at `/`

This is where visual similarity to the reference should be strongest. Keep it concise enough that the actual application remains the focus of the demo.

### A. Header

Wordmark left; How it works, Who it helps and Trust anchor links in the center; Sign in/Open Saathi right. All links have real destinations. Use a 72px desktop header and a 64px mobile header. A sticky header uses an opaque light background and a subtle divider after scrolling. Do not add a fake announcement bar or customer-logo strip.

On mobile show wordmark, Sign in and a labelled Menu button. The menu is an accessible sheet with focus management and Escape dismissal. Anchor sections have sufficient scroll margin so the header does not cover headings.

### B. Hero

Centered composition with generous top/bottom whitespace, closely following the reference's editorial pacing.

- Eyebrow: **Security for everyday organizations**.
- Heading: **Know what happened.\nKnow what to do.**
- Description: **Saathi explains security concerns in your language, shows who each response affects, and checks what happened after you act.**
- Primary CTA: **Open Saathi** -> `/login`, or the user's authorized landing page if signed in.
- Secondary CTA: **See how it works** -> `/#how-it-works`.
- Small factual qualifier: **For connected devices and applications.**

No invented customer totals, “100% protection,” benchmark scores or institutional endorsements. Use a serif headline, dark body text and a coral primary action. The hero's copy and controls remain visible without waiting for JavaScript or animation.

Below the hero, place a warm illustration stage containing one compact Saathi incident example. It should feel like a real product window, with a small “Illustrative example” label. It can show a single concern and an unambiguous “Review response” action. It must not look like a live alert about the visitor's own organization.

### C. How it works: three feature stages

Use split sections like the reference: a short heading/copy column beside a cream-backed product illustration. On mobile, stack heading -> explanation -> selectors -> corresponding visual.

| Stage | Heading | Product illustration |
|---|---|---|
| Understand | One clear concern, with the context you need. | Facts, uncertainty and current limits on an incident card |
| Decide | See who a response will affect. | Stops, keeps working, unknown and cannot-control preview |
| Verify | Know what actually changed. | Target session denied; legitimate session still permitted; probe timestamp |

Use explicit button selectors for alternative examples if necessary. A user selects the example; panels do not auto-cycle. Keep their dimensions stable. Each panel is independently understandable with animation disabled.

### D. Who it helps

A short paragraph and four restrained text/icon cards: Clinics, Shops, Schools, Small offices/NGOs. Cards change example vocabulary or jump to an explanation. They do not claim automatic integrations with sector-specific software. Use generic, made-up organization names only where an example needs a name.

### E. Trust and evidence

Two spacious panels: **Verified actions** and **Receipts you can check**. Explain the difference between an observed protective result and an independently timestamped record. Show a small receipt example with two separate statuses: “Receipt integrity: verified” and “Independent timestamp: pending.” Label examples.

Public copy does not require understanding Ed25519, Merkle trees or Bitcoin RPC. Put technical detail behind an explicit disclosure. Keep the explanation accurate: evidence proves consistency with a retained commitment, not that every underlying observation is true.

### F. FAQ, final CTA and footer

FAQ questions: What can Saathi see? Does it work with my current software? What if a device is offline? Does AI decide what gets blocked? What does the timestamp prove? Use concise answers aligned with `build.md`.

Finish with **Make security decisions with confidence** and Open Saathi. Footer contains the product name, working navigation and a short prototype/coverage explanation when appropriate. Do not add nonworking pricing, contact, social or policy links simply to fill a footer.

## 5. Authenticated application shell

The app inherits the warm palette, restrained coral and soft surfaces. It uses more compact sans-serif headings and smaller vertical gaps than the marketing site.

### Desktop and tablet

Use a 232-248px sidebar, 64px top bar and a main content area with 28-32px padding. The sidebar is warm ivory; main cards are white. Avoid an oversized marketing hero after login.

Sidebar order:

1. Overview
2. Incidents
3. Ask Saathi
4. Devices
5. People and access
6. Health
7. Evidence
8. Reports
9. Integrations
10. Settings

Group the first three under Work, the next three under Organization, and the rest under Records/Manage, using quiet labels. Preserve every route from `flow.md`. The active item uses a pale coral surface, dark coral text and a visible marker; no color-only selection.

Top bar: organization switcher, compact coverage link, language control and profile. Coverage is a specific count/time, not a decorative green shield. Detailed search is optional and must only be shown when functional. Staff and auditors see only relevant navigation; server-side permissions remain authoritative.

### Mobile

Use the `flow.md` navigation: Overview, Incidents, Ask and More. More opens the remaining permitted destinations. Add bottom padding equal to navigation plus safe-area inset. Compact top bar shows organization and language; longer controls live in a menu.

Incident approval is never hidden behind the bottom navigation. Sticky approval controls reserve their own layout space and must not cover consequences, form errors, browser zoom or the virtual keyboard. On a short screen or with enlarged text, use natural document flow instead of forcing a sticky bar.

### Role destinations

Owner/approver -> `/app/overview`; staff -> `/app/ask`; auditor -> permitted evidence/reports. Incomplete owner setup redirects to onboarding with a resumable step. An inaccessible deep link displays a clear authorization state and a safe return route rather than rendering private content and hiding it after hydration.

## 6. Signature screens

### 6.1 Overview: decisions before metrics

Route: `/app/overview`. Data: `GET /api/v1/overview`.

First row: page heading **Your organization**, one sentence summarizing current needs, and last-refresh time. Example counts are only shown when backed by actual data.

Main column (about two-thirds on wide desktop):

- **Needs your attention:** up to three prominent incident rows, with Show all when more exist.
- **Review today:** quieter items with a clear next step.
- **Recently handled:** exact action results and remaining follow-up.

Supporting column:

- **Connected sources:** device/app counts, stale sources and coverage link.
- **Protection checks:** compact health summary with unknown checks.
- **Temporary limits:** current expiry times and review links.

Use a quiet inline sentence for the event funnel, expandable to actual dispositions. Do not make a large animated chart the first thing users must interpret. The first viewport should explain what needs a decision and where to click.

Empty state: **No incidents detected in connected sources** plus coverage. No sources: **Connect your first device or application**, with authorized setup CTA. Stale data keeps the last observed value but is labelled as stale.

### 6.2 Incident list: readable at a glance

Route: `/app/incidents`. Data: `GET /api/v1/incidents`.

Tabs/filters: Needs attention, Investigating, Recovering and All; additional state/urgency filters as required by the backend. Do not make frontend tabs redefine the incident state machine. Preserve filters/cursor in the URL and restore them on Back.

Each row contains one short plain-language title, affected source, status, observation age and next step. The full row opens the incident, with keyboard focus support. Secondary menus should contain secondary actions only. A dismiss operation requires a reason through the existing workflow.

Mobile rows become stacked cards. Keep titles readable and put technical identifiers in details. Never truncate the fact that a result is partial or a source is offline.

### 6.3 Incident detail: understand before deciding

Route: `/app/incidents/[id]`. Data: `GET /api/v1/incidents/:id`.

Desktop uses a 680-760px reading column plus a quieter context/timeline rail when there is room. Mobile is a single column. Use this reading order:

1. Title and current incident status.
2. Affected device/application, source freshness and known scope.
3. **What happened** - observed facts, two or three short statements.
4. **What is uncertain** - direct language, visible without expansion.
5. **Already limited** - only when a real temporary guard exists; show expiry.
6. **Recommended next step** - supported action and reason.
7. **Review who is affected** - primary CTA to create a preview.
8. Alternatives, history and raw source details.

The primary card may use a small warm illustration/icon in its header, but it should not compete with the explanation. Use subtle separators instead of six heavily shadowed boxes. Optional Explain more and Read aloud are secondary controls.

### 6.4 Consequence preview: the most important screen

Routes: `/app/incidents/[id]/preview/[previewId]` and `/app/previews/[previewId]`. Fetch/store contracts come from the existing preview services; do not recompute consequences in the browser.

Heading is specific: **Pause this records session?** Subheading: **Review what will change before you approve.** Show the exact target using a friendly label plus a secondary identifier where needed.

Wide layout: two equally prominent consequence panels, followed by full-width limits and recovery. The contrast is between the effects, not between a glowing recommended choice and unreadable alternatives.

```text
Back to incident                         Preview observed at 9:08 PM

Pause this records session?
Review what will change before you approve.

+---------------------------+  +-------------------------------+
| Will stop                 |  | Keeps working                 |
| This session's protected  |  | The other permitted session   |
| record requests           |  | Other staff in this app       |
+---------------------------+  +-------------------------------+

Will be limited       Only if the selected action throttles activity
Unknown effects       Any unconnected or unverified dependencies
Cannot control        Records already downloaded
Recovery              Verify the person and issue a fresh login

[Choose another response]                    [Pause this session]
```

Use neutral warm surfaces, small status icons and readable text. Reserve green for confirmed outcomes and clearly supported unchanged permissions; do not imply the whole incident is already safe. The CTA uses the action name, never “Secure everything” or “Confirm” alone.

If comparing actions, use a labelled radio selection and update a server-generated preview for the selected action. While fetching, show **Updating consequences** and disable approval. Do not leave a usable approval button beside stale displayed effects. Preserve choice after recoverable errors but require a fresh preview when stale.

Always show relevant `unknown`, `cannotControl`, scope and recovery requirements before approval. The page may scroll naturally. Do not make clicking approval depend on a fabricated countdown or checking an unrelated consent box.

### 6.5 Action result: show the proof

Route: `/app/actions/[id]`. Data: `POST /api/v1/actions`, then `GET /api/v1/actions/:id`.

Show a short progress rail: **Request accepted -> Applying -> Checking result -> Outcome**. Map it to real action states. A synchronous action may skip intermediate visible stages; never slow it down for an animation.

After a valid probe, show two simple session cards when the integration supplies evidence:

- **Selected session: access stopped**, with scope and checked-at time.
- **Other session: access remains permitted**, with the actual checked capability/time.

If only one side was checked, the other says **Not checked**, not “Still working.” Show remaining findings below. Separate **Action confirmed** from **Incident contained**; the latter comes from the containment assessment, not a frontend inference.

Partial/failed/unknown results use the same layout quality as success. Provide **Review next step**, **Return to incident** or **Check status again** according to the service response. Retrying a change starts with a fresh preview when required. A network timeout after submission triggers an idempotent status lookup, not an automatic new action.

### 6.6 Recovery: calm guided steps

Route: `/app/incidents/[id]/recovery`. Show an ordered checklist with brief explanations, evidence-backed completion and a clear blocked state.

Steps: verify the person -> address credentials/findings -> revoke old session -> establish fresh authorized access -> verify old token rejection -> finish. Only show steps applicable to that connector. User-attested steps and machine-verified steps must have different labels.

The original session is never visually “resumed.” Explain that recovery creates a fresh login. A failed step remains visible and prevents a false recovered state. Use understated completion transitions; no confetti for security operations.

## 7. Complete route-by-route presentation map

This matrix accounts for the rest of `flow.md`; the signature screens above are not the entire application.

| Route | Layout and key UI | Primary data/service connection |
|---|---|---|
| `/login` | Centered white form on warm canvas; product wordmark; persistent labels; clear recovery; no decorative obstacle | Better Auth handler; authorized return destination |
| `/onboarding` | One task at a time with progress and resumable state; organization, people, sources, automation, notifications, coverage review | Organizations, invitations, enrollment, integrations, Telegram APIs |
| `/app/devices` | Device list; name, current freshness, coverage and checks; owner-only Add device | `GET /api/v1/devices`; enrollment code creation |
| `/app/devices/[id]` | Overview, checks, supported controls and history; unsupported action has a reason | Device detail; device preview service |
| `/app/people` | Human-readable staff list, active/inactive/shared-account context | `GET /api/v1/people` |
| `/app/people/[id]` | Separate connected sessions and device-account links; dependencies and offboarding preview | Sessions and access-preview APIs |
| `/app/ask` | Large labelled input, screenshot upload, review/redaction and recent own checks | `POST /api/v1/scam-checks`; shared validated upload contract |
| `/app/ask/[id]` | Finding label, reasons, uncertainty, next step and report option | `GET /api/v1/scam-checks/:id`; authorized report/campaign service |
| `/app/health` | Simple component score and unknown-check count; ordered findings; Review fix opens normal preview | `GET /api/v1/health`; device-preview APIs |
| `/app/evidence` | Checkpoint list with separate signature and timestamp columns | Authorized checkpoint/report queries from shared DAL |
| `/app/evidence/[checkpointId]` | Readable evidence summary; integrity and anchor cards; advanced details expandable | Checkpoint query; anchor status/request API; export service |
| `/app/reports` | Incident/weekly filters, date, scope and download readiness | `GET /api/v1/reports` |
| `/app/reports/[id]` | Readable document view, unresolved items, proof status, download actions | Report query and authenticated download API |
| `/app/integrations` | Capability-based list: can observe, can enforce, read-only, stale/unconnected | Tenant-scoped integration DAL |
| `/app/integrations/[id]` | Setup steps, current scopes, test result, freshness and disconnect consequences | Integration GET/PATCH/events and authorized revocation service |
| `/app/settings` | Clear sections for organization, roles, language, hours, notifications and versioned automation policy | Existing organization/member/policy services; do not expose secrets |
| `/workspace/records` | Clearly labelled reference business application with synthetic records and session identity | Gateway authorization on every protected download |
| `/verify` | Local file picker, retained-checkpoint input, separate verification results and offline limits | Browser verifier; optional explicitly described chain-verification path |
| `/demo` | Privileged scenario controls with persistent DEMO/REPLAY label | Demo-only replay endpoint; isolated synthetic tenant |

Some reads above use server-side DAL queries rather than a separately listed REST route in `build.md`. If a Client Component needs a new read/upload/report mutation endpoint, define its shared schema, permission check and durable behavior explicitly before wiring it. A UI-only mock must never stand in for missing functionality in the production path.

### Ask Saathi details

Use an input-first layout. Explain what will be processed before upload. Display extracted text for review/redaction; provide pasted-text fallback when extraction is unavailable. Assessment labels are exactly the defined categories: Known malicious, Suspicious, No known indicators, Insufficient information. “No known indicators” is neutral, not a green Safe badge. User content is rendered as text; suspicious links are not auto-opened or silently fetched.

### Health details

Use a simple score bar plus six check rows. Show unknown points and source freshness next to the score. The score describes checked posture, not safety probability. A fix opens a preview. A queued command does not increase the score; only verified posture does.

### Settings and automation

Risk-bearing policy controls have descriptions and a review step: exact action, threshold, duration, affected scope and expiry. An enabled toggle is not sufficient evidence of saved policy. Show saving, saved version and failure. Changes to ordinary appearance preferences may update immediately; security policy changes wait for server confirmation.

## 8. Evidence and blockchain UI

Use the customer-facing title **Receipts you can verify**. Blockchain is an explanatory detail of the independent timestamp, not a separate cryptocurrency dashboard.

Display two distinct primary cards:

1. **Receipt integrity:** pending signature, signed, verified against supplied trusted material, or verification failed. Distinguish a server-reported signed status from a local verification result.
2. **Independent timestamp:** not requested, pending/submitted, confirmed, retrying/failed or invalid. Include verification method and checked-at time.

User controls: Download report, Download proof bundle, Verify locally, and Retry timestamp only when authorized and appropriate. Put hash, signature, Merkle path, key ID and block details behind **Technical details** with copy controls and full accessible values. Truncated display values must have a way to access the full value.

The `/verify` page gives individual checks their own rows: data hashes, sequence links, signatures, retained checkpoint, batch membership, and blockchain timestamp. Local integrity files stay in the browser. Any network-dependent verification explicitly identifies what is checked remotely and never uploads a full private bundle without the described user action.

Offline state: **Receipt integrity can be checked here. The blockchain timestamp has not been checked offline.** Offer the downloadable verifier before disconnection. Do not use an endless spinning Bitcoin icon, a fake confirmation countdown or an explorer link as proof of verification.

## 9. UI states and truthful microcopy

| Backend fact / situation | Frontend wording and appearance | Next step |
|---|---|---|
| No connected sources | Warm neutral onboarding card | Connect a source |
| No detected incidents | Calm neutral state plus coverage | Review devices/checks if desired |
| `requested` | Request accepted | Poll actual state |
| `queued` | Waiting to apply | Explain device/worker delay where known |
| `executing` | Applying change | Show current phase without invented percentage |
| `confirmed` | Action confirmed, with exact postcondition | Show containment assessment separately |
| `partial` | Some changes worked | Show remaining concern and next supported option |
| `failed` | Could not complete this change | Show reason and valid next step |
| `unknown` | We could not confirm the result | Reconcile/check status; do not assume nothing changed |
| `expired` | Request expired before completion | Review a fresh preview |
| `cancelled` | Request cancelled | Return to incident; no success badge |
| `STALE_PREVIEW` | The situation changed. Review the updated effects. | Fresh preview and new approval |
| `DEVICE_OFFLINE` | Device offline. Last seen [time]. | Explain why control is unavailable |
| AI unavailable | Showing the standard explanation | Continue core workflow |
| Timestamp submitted | Independent timestamp pending | Protection and receipt viewing remain available |
| Role revoked | You no longer have permission for this action | Safe return; private content removed |
| Temporary guard expiry | Temporary limit ends at [time] / has expired | Review remaining risk; separate pause persists |

Use icons and words in addition to color. Critical status is inline, not only a toast. Toasts are appropriate for copied text, saved noncritical preferences or queued report creation, with concise accessible announcements.

Avoid security shorthand in ordinary copy. Prefer “Repeated wrong passwords” to an event code, “Who is affected” to blast radius, “Check result” to probe, and “Connected application” to enforcement boundary. Keep technical terms available in details for judges and engineers.

## 10. Motion specification

Use CSS transitions for the default implementation. Native browser animation/IntersectionObserver can support small reveal effects. A motion library is optional, not a prerequisite; add one only if an actual interaction needs it and the bundle remains within budget.

### Motion timings

| Interaction | Specification | Reduced motion |
|---|---|---|
| Button hover/focus | Color/border transition, 120-160ms | Color/border only or immediate |
| Click feedback | Optional 1px press, 90-120ms; no magnetic movement | No translation |
| Marketing section reveal | Opacity plus maximum 8px rise, 240-320ms, once | Already visible, no reveal |
| Feature-panel selection | 160-200ms crossfade inside stable stage | Immediate panel change |
| Menu/dialog opening | 140-180ms fade and at most 6px movement | Immediate or brief opacity |
| Newly received incident | One 300ms warm border emphasis; preserve row focus/order | Static new label |
| Status change | Text/badge crossfade, 120-160ms, only after real update | Immediate text update |
| Actual verified result | Single restrained check appearance, 160-200ms | Static check and text |
| Expanded technical details | Natural disclosure; optional brief opacity | Immediate; no height animation |
| Pending task | Small progress indicator plus text; no fake percentage | Static indicator with updating text |

Default easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`. Avoid spring overshoot for decisions. A nonessential entrance sequence should finish quickly, not progressively hide an entire screen behind delays.

### Important animation rules

- No continuous mascot, particle field, globe, scanning beam, parallax, animated counters, typewriter explanations or screen-wide celebration.
- Keep text and primary actions visible if JavaScript fails or the reveal observer never runs. Enhancement may animate an already meaningful state; it must not block access to content.
- Disable decorative movement under `prefers-reduced-motion: reduce`; also stop offscreen/background decorative work.
- Never animate the cursor, move a button away from focus, or reorder active incident rows during keyboard navigation.
- No frontend timer turns requested into confirmed. A verified icon follows the API result.
- Security information updates immediately even if a transition is in progress. Do not delay a failure or expiry notice for visual continuity.
- Do not auto-advance preview alternatives. Users control their decision and reading pace.

Illustrative CSS token contract (to implement after reading installed framework/style conventions):

```css
:root {
  --saathi-canvas: #ffffff;
  --saathi-canvas-warm: #f8f6f2;
  --saathi-ink: #242420;
  --saathi-ink-secondary: #60605a;
  --saathi-action: #be3e24;
  --saathi-action-hover: #a5331d;
  --saathi-focus: #182e54;
  --saathi-duration-fast: 140ms;
  --saathi-duration-panel: 180ms;
  --saathi-ease: cubic-bezier(.2, .8, .2, 1);
}

[data-saathi-interactive] {
  transition: color var(--saathi-duration-fast) var(--saathi-ease),
              background-color var(--saathi-duration-fast) var(--saathi-ease),
              border-color var(--saathi-duration-fast) var(--saathi-ease);
}

:focus-visible {
  outline: 3px solid var(--saathi-focus);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  [data-saathi-motion] {
    animation: none;
    transform: none;
    transition: none;
    opacity: 1;
  }
  html { scroll-behavior: auto; }
}
```

This snippet is a design contract, not a completed stylesheet. Also account for motion in third-party primitives and any unmarked components during QA.

## 11. Responsive and accessibility rules

| Available width | Required behavior |
|---|---|
| 320-639px | One-column content, 16-20px gutters, readable controls, mobile navigation; consequences stack without omissions |
| 640-1023px | 24px gutters; two-column support cards only when text fits; sidebar becomes menu/rail with accessible labels |
| 1024-1279px | Full sidebar where it fits; app details usually one main column with context below |
| 1280px+ | Full sidebar; incident/context split; preview comparison side by side; content width capped |

Use content fit, container queries where appropriate and CSS layout; never infer layout from user agent. Reference-like marketing whitespace may shrink on small screens, while reading size and useful controls remain comfortable.

Accessibility gates:

- Semantic headings, landmarks, labels, real buttons and links. A skip link bypasses navigation.
- Keyboard can reach every action, menu, selector and proof control; visible focus is never clipped.
- Dialogs have a title, focus trap, Escape handling and focus return. Critical preview is a full page so essential consequences are not compressed into a small modal.
- All statuses have readable words. Meaning survives grayscale and color-vision differences.
- Standard text meets at least 4.5:1 contrast; large text at least 3:1. Check component boundaries/focus separately.
- No horizontal page overflow at 320px. Technical tables can use a labelled scroll region or stacked rows; ordinary incident text must reflow.
- At 200% text size and 400% desktop zoom, content remains available without overlaps or hidden approvals.
- Use `aria-live="polite"` for meaningful action-state changes, not every polling response or countdown second. Announce urgent blocking errors appropriately without repeated interruption.
- Forms have persistent labels, inline errors and a summary when multiple errors exist. Retain safe values after recoverable failure.
- Read-aloud controls explicitly say Play/Stop and detect appropriate installed voices. Missing voice support does not remove text.
- Language switches preserve route, selected organization and current incident; invalidate nothing solely because the display language changed. Policy previews use stable IDs and parameters, not translated prose as identity.

## 12. Frontend architecture and data discipline

Use the selected stack from `build.md`: Next.js App Router, TypeScript, Tailwind, shadcn/ui primitives, SWR, next-intl and shared Zod contracts. Add Lucide icons if the chosen component setup does not already provide them. The design does not require a second component framework, WebGL or a new backend.

### Suggested frontend files

```text
apps/web/src/components/brand/       wordmark, decorative product stage
apps/web/src/components/marketing/   header, hero, feature selector, FAQ, footer
apps/web/src/components/shell/       sidebar, mobile nav, org/language controls
apps/web/src/components/incidents/   incident card, fact list, uncertainty, timeline
apps/web/src/components/preview/     consequences, target summary, approval controls
apps/web/src/components/actions/     phase indicator, probe result, remaining findings
apps/web/src/components/devices/     freshness, capability labels, device rows
apps/web/src/components/ask/         message input, redaction, assessment
apps/web/src/components/evidence/    integrity card, timestamp card, proof checks
apps/web/src/components/shared/      status badge, empty/error/loading state, copy field
apps/web/src/styles/                 design tokens, global typography, motion
packages/i18n/                      shared translated keys and vocabulary packs
packages/contracts/                 API/DTO types; authoritative statuses
```

Core reusable components: `AppShell`, `PageHeader`, `CoverageSummary`, `IncidentCard`, `ObservedFacts`, `UncertaintyNotice`, `ConsequencePreview`, `ApprovalBar`, `ActionProgress`, `ProbeResult`, `RecoveryChecklist`, `SourceFreshness`, `StatusBadge`, `IntegrityStatus`, `TimestampStatus`, `LocalVerifier`, `EmptyState`, `InlineError` and `TechnicalDetails`.

### Server/client boundary

Server Components obtain initial minimal DTOs from the authorized DAL. Client Components manage selection, forms, dialogs, file verification, speech and polling. Route Handlers and server loaders call the same application services. Keep Neon clients, signing keys, role authority and incident containment logic server-side.

Next.js version-sensitive APIs must follow the installed local guides. Await dynamic params/request APIs when required by that version. Sensitive responses are private/no-store; do not cache an organization view across users. Load public marketing content separately from authenticated state.

### SWR and mutation behavior

- Keys contain organization and resource identity. Switching organizations clears/separates visible sensitive results and caches.
- Poll active actions approximately every two seconds initially, with backoff and a bounded active window. Less urgent overview/device reads can be slower. These are starting UX targets to measure.
- Pause unnecessary polling when hidden; revalidate on focus. Preserve a visible last-updated time. Never report an offline browser as a confirmed offline endpoint without source evidence.
- Use stable DTOs and shared state enums. Components cannot guess progress from elapsed time.
- Security changes use a stored preview ID and stable idempotency key. Disable repeat submission visually, but rely on backend idempotency for correctness.
- A request timeout after approval checks the existing action. A fresh HTTP retry must not silently generate another idempotency key.
- Never optimistically claim containment, recovery, health improvement or timestamp confirmation.
- Show `409 STALE_PREVIEW` in the decision context, with an explicit new review. Generic toast-only error handling is insufficient.

### Privacy and rendering

Keep user-submitted messages plain text. Mask confidential details in overview/notification examples. Do not leak full session tokens, device secrets, signed command contents or private records into the DOM. Local verification bundles remain local unless the user explicitly chooses a documented remote action. Use permission-specific DTOs rather than hiding sensitive fields with CSS.

## 13. Aligning frontend delivery with the build plan

| Frontend increment | Corresponding build phases | Required output |
|---|---|---|
| Tokens, typography, primitives, shell | 00-02 | Warm visual system, role-aware shell, auth/onboarding frames |
| Reference records workspace and event views | 03-06 | Genuine data sources, coverage and readable incident list |
| Incident, consequence preview and approval | 07-08 | Stored server previews, stale handling and idempotent mutation |
| Device results and honest action states | 09-10 | Supported controls, real probes, mobile/locale layouts |
| Recovery and notifications | 11-12 | Guided verified recovery, linked notification destinations |
| Ask Saathi and health | 13-14 | Uncertainty-aware assessment and previewed fixes |
| Evidence, verifier, timestamps | 15-16 | Separate signature/integrity/anchor states and local file UI |
| Reports, deployment and evaluation | 17-18 | Complete navigation, failure testing, performance and demonstration |

Marketing can be developed alongside foundation components, but the core decision screens take priority once the backend contracts exist. Reuse real application components in labelled public illustrations where feasible. Do not create a separate beautiful mock workflow that the real application cannot reproduce.

Practical screen order: tokens -> application shell -> incident card -> consequence preview -> result -> overview -> onboarding -> devices/people -> recovery -> Ask/health -> evidence/reports -> landing polish. This is presentation work within the dependency order of `build.md`, not a replacement for backend prerequisites.

## 14. Performance and presentation quality

Target responsiveness on ordinary office hardware and phones. Render meaningful content promptly. Defer optional AI explanations, charts, proof parsing and large report previews until requested. Prefer CSS-built product examples and small SVG icons over video backgrounds.

- Self-host and subset licensed fonts; load regional fonts when needed. Use fallback metrics to reduce layout shift.
- Reserve dimensions for product panels, skeletons and any images.
- Keep stable layouts during status changes and pagination.
- Use cursor pagination for longer incident/evidence lists; avoid rendering thousands of rows.
- Dynamic-import the local proof verifier so it does not slow the incident decision page.
- Avoid a mandatory loading animation before the page becomes useful.
- Keep decorative transitions off the critical interaction path.
- Measure public-page and app-route performance separately. Field targets are LCP <=2.5s, INP <=200ms and CLS <=0.1 at p75; these are targets, not measured achievements. Use lab tests and actual device checks before claiming results.

### Hackathon demonstration sequence

Spend only a short opening moment on the landing page, then use the actual application:

1. Overview: clear coverage and one actionable concern.
2. Incident: facts, uncertainty and a human-readable recommendation.
3. Preview: visible stops/limits/keeps/unknown and a specific action.
4. Result: target session denied and legitimate session checked as still permitted.
5. Failure case: stale preview or unsupported action shown honestly.
6. Receipt: integrity and independent timestamp shown separately.

Use a browser window large enough for judges to read, and prepare a mobile viewport for the real owner experience. A dedicated presenter zoom can enlarge the browser; do not introduce a separate fake presentation mode that changes state semantics. DEMO/REPLAY labels remain visible on synthetic fixtures. Reset controls require the authorized demo role and isolated tenant.

## 15. Acceptance checklist

### Visual and readability

- [ ] Landing has the reference's warm neutral/serif/coral visual character, implemented with Saathi content.
- [ ] Application inherits the palette and spacing but keeps operational headings sans-serif and readable.
- [ ] Incident title, facts, uncertainty and next step are easy to locate without instruction.
- [ ] Preview exposes all material effects before approval, including unknown coverage and recovery.
- [ ] All text remains readable in English, Kannada and Hindi; no clipped glyphs or fixed-height truncation.
- [ ] Success, partial, failure and unknown states receive equal visual care.
- [ ] No invented customer marks, performance claims, incident counts or disconnected functionality.

### Functional and contract alignment

- [ ] Every route from `flow.md`, including standalone preview and local verifier, has a purposeful screen.
- [ ] Every action uses the corresponding authorized service/contract from `build.md`.
- [ ] Only backend/probe data changes security status, health or proof confirmation.
- [ ] Session expiry, role removal, tenant switch and stale-preview paths work.
- [ ] Pending timestamp never becomes confirmed due to a timer or visual transition.
- [ ] Local integrity and blockchain verification remain separately labelled.
- [ ] Technical identifiers and source details are available without dominating the main explanation.

### Interaction and responsive QA

- [ ] Review at 320x568, 390x844, 768x1024, 1024x768, 1440x900 and a wide desktop.
- [ ] No horizontal page overflow, hidden focus or approval controls covered by fixed navigation.
- [ ] Keyboard-only operation and screen-reader smoke tests pass for the core workflow.
- [ ] Contrast is measured on final rendered surfaces, not just token swatches.
- [ ] Reduced motion retains all information and controls.
- [ ] Slow network, offline browser, offline device and lost approval response are tested separately.
- [ ] Long translated text, unknown dependency lists and multiple incident findings wrap naturally.
- [ ] Animation never delays current risk, expiry or failure information.

### Human understanding

Have several non-security users complete the central journey. Ask them to explain what happened, what is uncertain, who the response affects and how they know it worked. Record actual errors and time to decide. A small pilot is descriptive evidence, not universal usability proof. Fix confusion in the wording or hierarchy before adding decorative effects.

## 16. Sources and final implementation brief

- [Primary visual reference: incident.io Slack response page](https://incident.io/incident-response-slack). Browser inspection informed the short visual observation in section 2. The rest is an original Saathi specification.
- [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
- [MDN prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion).
- [Core Web Vitals targets and measurement](https://web.dev/articles/vitals).
- Installed Next.js guides: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `15-route-handlers.md` in the same directory; re-read relevant installed guides during implementation.
- [build.md](build.md) and [flow.md](flow.md) are authoritative for the product behavior described here.

**Implementation direction:** make Saathi feel warm, precise and composed. Use the reference's editorial public-page style and carry its restrained surfaces into a readable application. Make consequence preview the visual centerpiece, verified outcomes the demonstration payoff, and all backend limits visible in ordinary language. Ship a complete, usable decision workflow before adding visual flourishes.
