# Vehicle Approval Centre — Project Guide for Claude

Dealership site (vehicleapprovalcentre.com) + in-house CRM at `/admin` being built to
replace Pipedrive (~$2,500/mo). One repo: Vite/React frontend + `server.ts` (single
~4,500-line Express backend run with tsx) deployed together to Cloud Run.

## Current phase (as of 2026-08-27)
- **CRM is in BETA.** Whole team invited to explore; everyone still works Pipedrive
  full-time. Pipedrive + the n8n round-robin remain the source of truth for routing.
- All Pipedrive data is imported: ~63k leads in the Free-to-Call pool, live rep books
  synced to boards (they drift during beta — that's expected; re-sync at cutover).
- **Cutover plan:** pick a Monday → rerun the three sync phases that morning → turn off
  n8n round-robin, turn on CRM auto-assign → Pipedrive read-only → 1–2 week parallel
  (dual-write stays on) → full Pipedrive export → cancel before next billing date.
- **Before cancelling Pipedrive:** import notes/activity history (NOT yet migrated —
  only application data came over). Once the subscription ends, API access is gone.

## Infrastructure
- **Cloud Run**: service `vehicle-approval-centre`, project `gen-lang-client-0753805028`,
  region `us-west1`. Prod domain via Cloudflare. Firestore database **`vacnortheast1`**
  (NOT the default db — every REST call needs `/databases/vacnortheast1/`).
- **Deploy** (from repo root; requires `gcloud auth login`, which expires often):
  ```
  gcloud run deploy vehicle-approval-centre --source . --region us-west1 --no-traffic --tag leadtest --quiet
  # poll the new revision until status True (cold start with tsx on 0.5 CPU is slow and
  # can miss the health probe — a "failed" deploy's revision often turns Ready ~1-2 min later)
  gcloud run services update-traffic vehicle-approval-centre --region us-west1 --to-revisions <REV>=100 --quiet
  ```
  **Rules:** ONE deploy at a time (check `pgrep -f "gcloud run deploy"`); overlapping
  deploys have served stale code. Verify a new feature exists in prod before using it.
- GitHub (`Shvmeless88/VAC-New-Site`) is **backup only** — pushing does not deploy.

## CRM data model (`crmLeads` collection)
- Doc ids: `pd_<last-10-phone-digits>` (the merge key — one person, one record, always)
  or `pp_<pipedrivePersonId>` when phone-less. Never create phone-less stubs.
- Stages: `new_lead → attempting_contact → dealertrack → approved → signed → lost`,
  plus `free_to_call` (unassigned pool). `signed` = won/delivered ONLY (Pipedrive
  "Agreed to Buy" maps to `approved`).
- `dnc: true` (Opt Out / Wrong Number) excludes from the pool. A fresh application
  revives an archived/lost/dnc record back to the Inbox.
- Applied dates matter to reps: `firstAppliedAt` / `lastAppliedAt` / `appliedMonth`
  (+ `applications` array) drive the pool's month/year filters.
- Website dual-write (`/apply-now` → Pipedrive + crmLeads) keys by phone so returning
  applicants merge; it never resets stage/owner of a lead that's being worked.
- Reps: `crmReps` collection; `pipedriveOwnerId` field maps Pipedrive user ids to reps.

## Pipedrive sync tooling (`POST /api/crm/pipedrive-import` in server.ts)
Auth: admin session OR `x-tick-secret` header — secret is the Cloud Run env var
`CRM_TICK_SECRET` (read it with `gcloud run services describe … --format` or from the
console; never commit it). Long runs are driven by small Python loop scripts (see the
pattern in git history / scratchpad): call with `{phase, pages, start}`, follow
`nextStart` until `done`.

Phases (all dry-run by default; `fix:true` / `confirm:true` applies):
- `persons` / `leads` / `leads-backfill` / `deals` — the original bulk import passes.
- `reconcile-inbox` — merges uuid-keyed dual-write docs into phone-keyed records and
  adopts Pipedrive lead owners. Also exposed as the admin Inbox's
  "Sync owners from Pipedrive" button.
- `audit-deals` — every OPEN sales-pipeline (id 5) deal added since Aug 1 must sit on
  the right rep's board in the right stage; `fix:true` re-owns and creates missing
  records from deal fields. **This is the cutover-morning command.**
- `audit-leads` — same for rep-owned Pipedrive leads (round-robin assignments that
  never became deals); skips leads Pipedrive labels "Free To Call"/"Not interested".
- `sample`, `persons-peek`, `deals-peek`, `wipe-imported`, `wipe-stubs` — diagnostics/safety.

Pipedrive API v1 gotchas: persons/leads lists carry 40-char field hashes top-level with
start-based pagination; deals list uses `user_id` (not `owner_id`); data lives on the
PERSON (2021-22 era), DEAL (mid-era) or LEAD (recent) depending on age — all passes
needed. Join phone-less deals via `pipedrivePersonId` with batched `in` queries of 30.
SIN field hash is intentionally excluded from all imports.

## Automations & integrations
- Cloud Scheduler `vac-crm-tick` hits the server every 5 min: 3-BUSINESS-day
  auto-release of untouched `attempting_contact` leads to the pool (clock =
  `attemptingSince`; set it to "now" when re-owning or leads get instantly swept),
  hot-lead bounce, email refresh.
- **n8n round-robin** (separate build) routes new Pipedrive leads using the
  "Hot Lead Rotation" Google Sheet (Reps tab: Accepting Leads yes/no, per-rep Google
  Chat WebhookUrl, LastAssigned). The CRM's distribution engine replaces this at
  cutover; copy the Accepting flags into CRM Active toggles that morning.
- Quo/OpenPhone for SMS (E.164 numbers, text-only API — photos via `sms:` handoff);
  Gmail domain-wide delegation for email (keyless signJwt). **Texts/emails from the
  CRM are REAL customer messages, including during beta.**
- Trade-in appraisal links, customer portal `/account`, lead-gen funnel `/get-approved`
  (separate business — forwards to buyer webhooks via `/api/dv-lead`, never Pipedrive).

## Known issues / gotchas
- The GTM-injected public-site chatbot renders an invisible max-z iframe bottom-right
  on ALL pages; Admin.tsx force-hides it (inline !important styles + MutationObserver —
  a plain <style> rule loses to the widget's CSS). Don't remove that effect.
- ~8 customers have TWO open Pipedrive deals under different reps; merge-to-one means
  sync passes flip-flop their owner. Reps should dedupe in Pipedrive pre-cutover.
- A few deals have no phone → no CRM record can be created (add a phone in Pipedrive,
  then re-sync).
- gcloud auth expires frequently. A Firestore REST 403 comes back inside a JSON array
  and naive parsers read it as "0 results" — always check for an `error` key.
- The `www` → apex Cloudflare redirect drops URL paths; use the bare domain for
  deep links like `/admin` or `/management-access` (the admin login page).
- `<input type="month">` is broken in the admin's browser matrix — use separate
  month/year selects.

## Key files
- `server.ts` — entire backend: CRM endpoints, import/sync phases, Quo/Gmail webhooks,
  CRM_FIELDS/CRM_ENUMS hash maps, tick.
- `src/pages/Admin.tsx` — admin shell, tabs, scoped dark mode, chatbot hide.
- `src/components/admin/CrmPanel.tsx` — board/pool/inbox + lead drawer (thread,
  composer with Note/Text/Email, recordings player). CrmInbox.tsx is DEAD code — the
  live Inbox is CrmPanel's `mode === 'inbox'`.
- `src/components/admin/CrmNurture.tsx`, `CrmReports.tsx`, `CrmTeam.tsx` — nurture
  (managers only), per-rep reports, rep onboarding/invites.
- `src/lib/gmailDelegate.ts` — delegated Gmail send + VAC signature.

## Conventions
- Never send rep invites, flip routing, or mass-modify leads without the owner's
  explicit go-ahead. Merge duplicates by phone, always. Ownership imported only for
  Aug 1, 2026+ activity; everything older stays unassigned in the pool.
