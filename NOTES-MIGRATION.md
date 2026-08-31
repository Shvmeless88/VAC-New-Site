# Pipedrive notes/activity migration — findings

Investigated 2026-08-31. Nothing built yet. This is the research so whoever picks it up
doesn't redo it.

**Why it matters:** `CLAUDE.md` lists this under "Before cancelling Pipedrive." Only
application data was imported; notes and activity history were not. When the
subscription lapses, API access goes with it and this data is gone permanently. It is
the only task in the project with an irreversible deadline.

## Scale

Measured by probing offsets against the Pipedrive API. Offsets track record ids nearly
1:1, so few records have been deleted and these are close to true counts.

| | Oldest | Newest | Approx. total |
| --- | --- | --- | --- |
| Notes | id 7 — 2021-04-15 | id ~654,507 — 2026-08-31 | **~654,500** |
| Activities | id 18 — 2021-04-08 | id ~877,846 — 2026-08-31 | **~878,000** |

Timeline of the notes corpus, by offset:

| Offset | Date | Character |
| --- | --- | --- |
| 0 | Apr 2021 | human |
| 200,000 | Jan 2025 | human — "No answer" |
| 280,000 | May 2025 | human — "N/A CTE" |
| 330,000 | Oct 2025 | human — "n/a - texted" |
| 400,000 | Feb 2026 | Quo auto-log |
| ~654,500 | Aug 2026 | Quo auto-log |

## Most of the volume is not worth migrating

Roughly the last 300k notes accumulated in ~10 months and are overwhelmingly Quo
integration auto-logs ("📬 Message +1709… Received: Cool" plus a link back to Quo).
**That data still lives in Quo**, which the CRM already integrates with directly.
Copying it duplicates what we have.

Tier the migration:

1. **Human-typed rep notes** — exists nowhere else. Must migrate. Concentrated in the
   first ~350k notes (2021 → late 2025).
2. **AI call summaries** — in `activity.note`, ~1.5–2 KB of HTML each, genuinely
   valuable (customer income, trade-in condition, credit details, next steps).
3. **Quo SMS mirror logs** — skippable, already in Quo.

## Design constraints

- **Join keys:** notes carry `person_id` and frequently `lead_id`; activities carry
  `person_id`. `crmLeads` already stores `pipedrivePersonId`. Deal ids were null on
  every sample.
- **Firestore 1 MiB document limit.** `activityLog` is an array field *inside* each
  `crmLeads` doc — there are no subcollections anywhere in `server.ts`. Rep notes are
  mostly terse one-liners (often <30 bytes), so notes alone are unlikely to breach it.
  The pressure comes from the **activity call summaries** at 1.5–2 KB each. Measure the
  worst-case per-lead activity count before deciding; if it's a risk, write imported
  history to a `crmLeads/{id}/history` subcollection and have the drawer merge both.
- **Content is HTML.** `CrmPanel` renders `activityLog[].text` as plain text (no
  `dangerouslySetInnerHTML`), so tags must be stripped on import.
- **Duplicates are real.** The three most recent notes sampled were byte-identical
  triplicates from the Quo integration. Dedupe on person + timestamp + content.
- **Call recordings** are signed `share.quo.com` URLs. Quo-hosted, so they survive
  Pipedrive cancellation, but the signatures may expire.

## Implementation shape

A new `phase` block in `POST /api/crm/pipedrive-import` in `server.ts`, following the
existing `leads` phase pattern: start-based pagination, `dryRun` default, batched writes
committed every ~300 ops, returning `nextStart` / `done` so a loop script can drive it.
Notes use start-based pagination; activities use cursor pagination (`next_cursor`).

**Suggested first step:** a counting phase that paginates both endpoints and reports
actual totals, the human-vs-Quo split, and worst-case per-lead volume — writing nothing.
That settles the subcollection question with data instead of estimates.

## Gotcha

`PIPEDRIVE_API_TOKEN` in the local `.env.cloudrun` returned **401 Unauthorized** when
tested on 2026-08-31 — likely rotated. Verify against the live Cloud Run env var before
driving any local script with it. (The Pipedrive MCP connection uses separate
credentials and works.)
