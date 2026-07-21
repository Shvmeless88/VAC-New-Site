# Trade-In Appraisal Rebuild — Design

**Date:** 2026-07-21
**Status:** Approved by J. Jackson (chat, 2026-07-21)

## Goal

Replace the disabled, Gemini-based trade-in appraisal (`src/pages/TradeIn.tsx`) with a
data-driven instant estimate backed by real market data, and re-enable the trade-in flow
on the public site. Business driver: acquire lower-priced inventory (especially sub-$15k
units suited to subprime approvals) directly from site visitors instead of at auction.

## Non-goals

- No CARFAX valuation integration in the instant math (their valuation products are not
  self-serve APIs). VIN, when provided, is attached to the lead so staff can pull the
  CARFAX report during manual confirmation.
- No changes to the orphaned `SellOrTradeSection` / `SellOrTradeModal` widgets; they stay
  unused for now.
- No binding cash offers. Everything shown is a conditional range confirmed at inspection.

## Architecture

### Valuation endpoint — `POST /api/trade-in/estimate` (server.ts)

Request body: `{ year, make, model, trim?, mileageKm, condition, vin? }`
Response: `{ status: "estimate", low, high, comps, source }` or `{ status: "manual" }`

Provider chain, first confident answer wins:

1. **Canadian Black Book** (`src/server/valuation/cbbProvider` concept, inline module in
   `server.ts` to match existing single-file server style). Activated only when
   `CBB_API_KEY` (and related CBB config vars) are present in the environment. Ships as a
   stub with a documented interface — endpoint specifics get filled in when the user's
   CBB developer-portal credentials are confirmed. When inactive it returns `null` and
   the chain falls through.
2. **Marketcheck comps** — uses the existing `MARKETCHECK_API_KEY`. Queries active
   Canadian listings matching year/make/model (trim included when provided, dropped on
   retry if it yields too few results). Computes the **median asking price** of comps,
   then adjusts:
   - **Mileage:** expected km = 18,000 × vehicle age; adjust median by $0.05/km of
     deviation, capped at ±15% of the median.
   - **Condition multiplier:** Excellent 1.00, Good 0.95, Fair 0.85, Needs work 0.70.
   - **Offer range:** 72%–82% of the adjusted retail figure (config constants
     `TRADE_IN_OFFER_LOW_PCT` / `TRADE_IN_OFFER_HIGH_PCT` at top of the module).
   - **Confidence gate:** minimum 5 comps, else fall through. Floor of $500.
3. **Manual fallback** — `{ status: "manual" }`. The UI shows "our buyer will send your
   appraisal within 24 hours" and still captures the lead. **No formula or AI guesses are
   ever shown to the customer.**

All tuning constants (percentages, multipliers, min comps, $/km) live in one config block.
The Marketcheck request/response field names are verified against the live API with the
existing key during implementation (a test route pattern already exists in server.ts).

### Form — rebuilt `src/pages/TradeIn.tsx`

Same 4-step shape as the current page, same visual language (motion, shadcn/ui, sonner):

1. **Vehicle:** year/make/model dropdowns sourced from `src/lib/canadianVehicles.ts`
   (same dataset the inventory filters use), optional trim, mileage (km), condition
   (Excellent / Good / Fair / Needs work), optional VIN ("for the most accurate offer").
2. **Estimate:** shows the range with "conditional offer — confirmed at inspection or
   doorstep pickup" framing, or the manual-appraisal message when `status: "manual"`.
3. **Contact:** name / email / phone. Submits to the existing `/api/leads` flow with
   `isTradeIn: true`; notes include vehicle details, estimate range, comp count, and
   data source. Pipedrive sync, round-robin rep assignment, and UTM attribution ride the
   existing pipeline unchanged.
4. **Success** (`/trade-in/success`).

The `@google/genai` import and client-side `GEMINI_API_KEY` usage on this page are
deleted (removes the Gemini key from this page's client bundle).

### Routing & navigation

- `App.tsx`: remove the `/trade-in` → `/` redirects; restore real routes for `/trade-in`
  and `/trade-in/success`.
- Add "Trade-In" link to navbar and footer.
- Un-hide the homepage trade-in section (currently commented out in `Home.tsx`),
  pointing at `/trade-in`.

## Error handling

- Marketcheck timeouts/errors → provider returns `null` → manual fallback. The endpoint
  never 500s for provider failures; it degrades to `{ status: "manual" }`.
- Client-side: estimate fetch failure shows the manual-appraisal path, not an error wall;
  lead capture works regardless.
- Input validation server-side: year 1990–current+1, mileage 0–500,000 km, known
  condition values; reject otherwise with 400.

## Testing

- Unit-testable pure function for the comps→range math (median, mileage/condition
  adjustments, gates) exercised with fixture data.
- Manual verification with `npm run dev`: known-good vehicle (e.g., 2019 Honda Civic,
  90,000 km) returns a plausible range; an obscure vehicle falls through to manual;
  Marketcheck key removed → manual; lead lands in Firestore + Pipedrive with trade-in
  metadata.

## Rollout

Develop on `claude/website-identification-439rj4`. CBB activation later = add env vars +
fill in the stub provider; no structural change.
