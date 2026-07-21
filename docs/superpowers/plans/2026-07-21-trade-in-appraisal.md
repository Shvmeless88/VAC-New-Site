# Trade-In Appraisal Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gemini-based trade-in estimate with a server-side valuation endpoint (Marketcheck comps now, CBB slot for later) and re-enable the trade-in flow site-wide.

**Architecture:** A pure valuation-math module (`src/lib/tradeInMath.ts`) is consumed by a new `POST /api/trade-in/estimate` route in `server.ts` that chains providers: CBB stub → Marketcheck comps → `{status:"manual"}`. The rebuilt `TradeIn.tsx` calls that endpoint instead of Gemini and posts leads through the existing `/api/leads` pipeline. Routes/nav links are restored.

**Tech Stack:** React 18 + Vite SPA, Express (single-file `server.ts`, run via tsx), Tailwind, motion/react, sonner. Tests: `node --import=tsx --test` (Node 22, no test framework installed — node:test built-in only).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-trade-in-appraisal-design.md`
- Branch: `claude/website-identification-439rj4` (never push elsewhere)
- Offer range: 72%–82% of adjusted retail median; min 5 comps; floor $500
- Condition multipliers: excellent 1.00, good 0.95, fair 0.85, needs_work 0.70
- Mileage adjust: expected km = 18,000 × age; $0.05/km deviation; capped at ±15% of median
- The customer must NEVER see a formula/AI-guessed number — no comps ⇒ manual-appraisal path
- No `@google/genai` usage may remain in `src/pages/TradeIn.tsx`
- Endpoint must not 500 on provider failure — degrade to `{status:"manual"}`
- `npm run lint` (tsc --noEmit) must pass before each commit

---

### Task 1: Valuation math module (pure, tested)

**Files:**
- Create: `src/lib/tradeInMath.ts`
- Test: `src/lib/tradeInMath.test.ts`

**Interfaces:**
- Produces: `estimateFromComps(prices: number[], input: EstimateInput): EstimateRange | null`, `TRADE_IN_CONFIG`, types `TradeInCondition`, `EstimateInput`, `EstimateRange`. Task 2 imports all of these into `server.ts`.

- [ ] **Step 1: Write the failing test**

`src/lib/tradeInMath.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateFromComps, TRADE_IN_CONFIG } from './tradeInMath';

const input = (over: Partial<Parameters<typeof estimateFromComps>[1]> = {}) => ({
  year: 2019,
  mileageKm: 90_000,
  condition: 'good' as const,
  currentYear: 2026,
  ...over,
});

test('returns null with fewer than MIN_COMPS valid prices', () => {
  assert.equal(estimateFromComps([20000, 21000, 22000, 23000], input()), null);
});

test('ignores junk prices when counting comps', () => {
  // 4 valid + 2 junk = still under the 5-comp gate
  assert.equal(estimateFromComps([20000, 21000, 22000, 23000, 0, NaN], input()), null);
});

test('computes range from median with condition + mileage adjustments', () => {
  // 5 comps, median 22000. Age 7 → expected km 126000; customer has 90000 km,
  // deviation -36000 → adjustment +36000*0.05 = +1800 (under 15% cap of 3300).
  // adjusted = (22000+1800) * 0.95 (good) = 22610
  // low = round(22610*0.72) = 16279, high = round(22610*0.82) = 18540
  const r = estimateFromComps([20000, 21000, 22000, 23000, 24000], input());
  assert.ok(r);
  assert.equal(r.low, 16279);
  assert.equal(r.high, 18540);
});

test('caps mileage adjustment at 15% of median', () => {
  // deviation -200000 km would be +10000; cap = 22000*0.15 = 3300
  // adjusted = (22000+3300)*0.95 = 24035 → low 17305, high 19709
  const r = estimateFromComps([20000, 21000, 22000, 23000, 24000], input({ mileageKm: 0, year: 2015 }));
  assert.ok(r);
  assert.equal(r.high, Math.round((22000 + 22000 * TRADE_IN_CONFIG.KM_ADJUST_CAP_PCT) * 0.95 * TRADE_IN_CONFIG.OFFER_HIGH_PCT));
});

test('applies the $500 floor', () => {
  const r = estimateFromComps([1200, 1300, 1400, 1500, 1600], input({ condition: 'needs_work', mileageKm: 400_000, year: 2010 }));
  assert.ok(r);
  assert.ok(r.low >= TRADE_IN_CONFIG.MIN_OFFER);
  assert.ok(r.high >= r.low);
});

test('even-count median averages the middle pair', () => {
  // median of [10000,20000,30000,40000,50000,60000] = 35000
  const r = estimateFromComps([10000, 20000, 30000, 40000, 50000, 60000], input({ year: 2026, mileageKm: 0, condition: 'excellent' }));
  assert.ok(r);
  // age 0 → expected 0 km, deviation 0 → no mileage adjustment
  assert.equal(r.low, Math.round(35000 * TRADE_IN_CONFIG.OFFER_LOW_PCT));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import=tsx --test src/lib/tradeInMath.test.ts`
Expected: FAIL — cannot find module `./tradeInMath`

- [ ] **Step 3: Write the implementation**

`src/lib/tradeInMath.ts`:

```ts
export type TradeInCondition = 'excellent' | 'good' | 'fair' | 'needs_work';

export interface EstimateInput {
  year: number;
  mileageKm: number;
  condition: TradeInCondition;
  currentYear: number;
}

export interface EstimateRange {
  low: number;
  high: number;
}

export const TRADE_IN_CONFIG = {
  OFFER_LOW_PCT: 0.72,
  OFFER_HIGH_PCT: 0.82,
  MIN_COMPS: 5,
  EXPECTED_KM_PER_YEAR: 18_000,
  KM_ADJUST_PER_KM: 0.05,
  KM_ADJUST_CAP_PCT: 0.15,
  MIN_OFFER: 500,
  MIN_VALID_COMP_PRICE: 1_000,
  CONDITION_MULTIPLIERS: {
    excellent: 1.0,
    good: 0.95,
    fair: 0.85,
    needs_work: 0.7,
  } as Record<TradeInCondition, number>,
};

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function estimateFromComps(prices: number[], input: EstimateInput): EstimateRange | null {
  const cfg = TRADE_IN_CONFIG;
  const valid = prices
    .filter((p) => Number.isFinite(p) && p >= cfg.MIN_VALID_COMP_PRICE)
    .sort((a, b) => a - b);
  if (valid.length < cfg.MIN_COMPS) return null;

  const med = median(valid);
  const age = Math.max(0, input.currentYear - input.year);
  const expectedKm = age * cfg.EXPECTED_KM_PER_YEAR;
  const deviationKm = input.mileageKm - expectedKm;
  const rawAdjust = -deviationKm * cfg.KM_ADJUST_PER_KM;
  const cap = med * cfg.KM_ADJUST_CAP_PCT;
  const mileageAdjust = Math.max(-cap, Math.min(cap, rawAdjust));

  const multiplier = cfg.CONDITION_MULTIPLIERS[input.condition] ?? cfg.CONDITION_MULTIPLIERS.good;
  const adjusted = (med + mileageAdjust) * multiplier;

  const low = Math.max(cfg.MIN_OFFER, Math.round(adjusted * cfg.OFFER_LOW_PCT));
  const high = Math.max(low, Math.round(adjusted * cfg.OFFER_HIGH_PCT));
  return { low, high };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --import=tsx --test src/lib/tradeInMath.test.ts`
Expected: all 6 pass. Also run `npm run lint` — no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tradeInMath.ts src/lib/tradeInMath.test.ts
git commit -m "feat: add trade-in valuation math with comps-based range"
```

---

### Task 2: `/api/trade-in/estimate` endpoint with provider chain

**Files:**
- Modify: `server.ts` (imports at top; new route inserted immediately BEFORE `app.post("/api/invite"` at ~line 788)

**Interfaces:**
- Consumes: `estimateFromComps`, `TRADE_IN_CONFIG`, `TradeInCondition` from `./src/lib/tradeInMath` (Task 1); existing `fetchWithTimeout` (server.ts:28).
- Produces: `POST /api/trade-in/estimate` accepting `{ year, make, model, trim?, mileageKm, condition, vin? }`, returning `{ status: "estimate", low, high, comps, source: "marketcheck" }` or `{ status: "manual" }`. Task 3's UI depends on exactly these shapes.

- [ ] **Step 1: Add the import**

At the top of `server.ts`, after `import { syncInventoryToGoogleSheets } from './src/lib/googleSheets';`:

```ts
import { estimateFromComps, TRADE_IN_CONFIG, type TradeInCondition } from './src/lib/tradeInMath';
```

- [ ] **Step 2: Add providers + route**

Insert immediately before `app.post("/api/invite"`:

```ts
  // ---------------- Trade-In Instant Appraisal ----------------
  const TRADE_IN_CONDITIONS: TradeInCondition[] = ['excellent', 'good', 'fair', 'needs_work'];

  // Provider 1: Canadian Black Book. Activates when CBB developer-portal
  // credentials are configured; endpoint specifics pending account confirmation.
  async function cbbTradeInEstimate(_params: {
    year: number; make: string; model: string; trim?: string;
    mileageKm: number; condition: TradeInCondition; vin?: string;
  }): Promise<{ low: number; high: number; comps: number; source: string } | null> {
    const cbbKey = process.env.CBB_API_KEY?.trim();
    if (!cbbKey) return null;
    console.warn('[TRADE-IN] CBB_API_KEY is set but the CBB provider is not implemented yet; falling through to Marketcheck.');
    return null;
  }

  // Provider 2: Marketcheck active-listing comps (Canadian market).
  async function marketcheckCompPrices(params: {
    year: number; make: string; model: string; trim?: string;
  }): Promise<number[] | null> {
    const apiKey = process.env.MARKETCHECK_API_KEY;
    if (!apiKey) return null;

    const search = async (includeTrim: boolean): Promise<number[]> => {
      const qs = new URLSearchParams({
        api_key: apiKey,
        country: 'CA',
        car_type: 'used',
        year: String(params.year),
        make: params.make,
        model: params.model,
        rows: '50',
        start: '0',
      });
      if (includeTrim && params.trim) qs.set('trim', params.trim);
      const resp = await fetchWithTimeout(
        `https://mc-api.marketcheck.com/v2/search/car/active?${qs.toString()}`,
        {}, 10000
      );
      if (!resp.ok) throw new Error(`Marketcheck search failed: ${resp.status}`);
      const data = await resp.json();
      const listings = Array.isArray(data?.listings) ? data.listings : [];
      return listings
        .map((l: any) => Number(l?.price))
        .filter((p: number) => Number.isFinite(p) && p > 0);
    };

    try {
      let prices = await search(true);
      if (prices.length < TRADE_IN_CONFIG.MIN_COMPS && params.trim) {
        prices = await search(false);
      }
      return prices;
    } catch (err) {
      console.error('[TRADE-IN] Marketcheck comps lookup failed:', err);
      return null;
    }
  }

  app.post("/api/trade-in/estimate", async (req, res) => {
    const { year, make, model, trim, mileageKm, condition, vin } = req.body || {};
    const currentYear = new Date().getFullYear();
    const yearNum = parseInt(year, 10);
    const mileageNum = parseInt(mileageKm, 10);

    if (
      !Number.isInteger(yearNum) || yearNum < 1990 || yearNum > currentYear + 1 ||
      !Number.isInteger(mileageNum) || mileageNum < 0 || mileageNum > 500_000 ||
      typeof make !== 'string' || !make.trim() || make.length > 60 ||
      typeof model !== 'string' || !model.trim() || model.length > 60 ||
      !TRADE_IN_CONDITIONS.includes(condition)
    ) {
      return res.status(400).json({ error: 'Invalid trade-in estimate request' });
    }

    const params = {
      year: yearNum,
      make: make.trim(),
      model: model.trim(),
      trim: typeof trim === 'string' && trim.trim() ? trim.trim().slice(0, 60) : undefined,
      mileageKm: mileageNum,
      condition: condition as TradeInCondition,
      vin: typeof vin === 'string' && vin.trim() ? vin.trim().slice(0, 20) : undefined,
    };

    try {
      const cbb = await cbbTradeInEstimate(params);
      if (cbb) return res.json({ status: 'estimate', ...cbb });

      const prices = await marketcheckCompPrices(params);
      if (prices) {
        const range = estimateFromComps(prices, {
          year: params.year,
          mileageKm: params.mileageKm,
          condition: params.condition,
          currentYear,
        });
        if (range) {
          return res.json({
            status: 'estimate',
            low: range.low,
            high: range.high,
            comps: prices.length,
            source: 'marketcheck',
          });
        }
      }
    } catch (err) {
      console.error('[TRADE-IN] estimate pipeline error:', err);
    }
    return res.json({ status: 'manual' });
  });
```

- [ ] **Step 3: Verify endpoint behavior**

Run: `npm run lint` — expected: no new errors.
Start `npm run dev` in the background, then:

```bash
curl -s -X POST http://localhost:3000/api/trade-in/estimate -H 'Content-Type: application/json' \
  -d '{"year":2019,"make":"Honda","model":"Civic","mileageKm":90000,"condition":"good"}'
```

Expected without `MARKETCHECK_API_KEY` in env: `{"status":"manual"}`.
With a key configured: `{"status":"estimate","low":...,"high":...,"comps":...,"source":"marketcheck"}` (field names of the live Marketcheck response verified here — if `listings[].price` differs, fix the mapping in `marketcheckCompPrices`).

Also verify validation: same curl with `"year":1980` → HTTP 400.

- [ ] **Step 4: Commit**

```bash
git add server.ts
git commit -m "feat: add /api/trade-in/estimate with CBB stub and Marketcheck comps"
```

---

### Task 3: Rebuild TradeIn.tsx without Gemini

**Files:**
- Modify (full rewrite): `src/pages/TradeIn.tsx`

**Interfaces:**
- Consumes: `POST /api/trade-in/estimate` (Task 2 shapes), `canadianMakes`/`canadianVehicleMakesAndModels` from `@/data/canadianVehicles`, `getStoredUtms` from `@/lib/utms`, existing `/api/leads` contract (see current file lines 171–183).
- Produces: page component (default export) for routes `/trade-in` + `/trade-in/success` (Task 4).

- [ ] **Step 1: Rewrite the page**

Replace the entire contents of `src/pages/TradeIn.tsx`. Preserve: the 4-step flow, header/card styling, progress bar, `formatPhone`, lead POST body shape, `/trade-in/success` navigation, scroll-to-top effect. Change: Step 1 uses `<select>` for year (currentYear down to 1990), make, and model (from `canadianVehicleMakesAndModels`, model select disabled until make chosen), optional trim text input, mileage input, condition select over the four spec values, optional VIN input; `getEstimate` POSTs to `/api/trade-in/estimate`; Step 2 renders either the range (with "Conditional offer — confirmed at inspection or doorstep pickup" line) or, when `status:"manual"`, an amber "Our buyer will send your personalized appraisal within 24 hours" panel — both with a Continue button; lead notes include estimate/comps/source or "Manual appraisal required", plus VIN when given; remove `GoogleGenAI` import and all Gemini/fallback-formula code; copy no longer says "our AI".

Key state and handlers (verbatim):

```tsx
type EstimateResult =
  | { status: 'estimate'; low: number; high: number; comps: number; source: string }
  | { status: 'manual' };

const [result, setResult] = useState<EstimateResult | null>(null);
const [formData, setFormData] = useState({
  year: '', make: '', model: '', trim: '', mileage: '',
  condition: 'good', vin: '', name: '', email: '', phone: '',
});

const getEstimate = async () => {
  if (!formData.year || !formData.make || !formData.model || !formData.mileage) {
    toast.error('Please fill in all vehicle details');
    return;
  }
  setIsSubmitting(true);
  try {
    const resp = await fetch('/api/trade-in/estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        year: parseInt(formData.year, 10),
        make: formData.make,
        model: formData.model,
        trim: formData.trim || undefined,
        mileageKm: parseInt(formData.mileage.replace(/\D/g, ''), 10) || 0,
        condition: formData.condition,
        vin: formData.vin || undefined,
      }),
    });
    const data = resp.ok ? await resp.json() : { status: 'manual' };
    setResult(data.status === 'estimate' ? data : { status: 'manual' });
  } catch {
    setResult({ status: 'manual' });
  } finally {
    setIsSubmitting(false);
    setStep(2);
  }
};
```

Lead notes in `finalSubmit`:

```tsx
const estimateLine =
  result?.status === 'estimate'
    ? `Instant Estimate: $${result.low.toLocaleString()} - $${result.high.toLocaleString()} (${result.comps} comps, ${result.source})`
    : 'Manual appraisal required (no instant estimate shown)';
// notes: `Vehicle: ... \nMileage: ...km\nCondition: ...\n${formData.vin ? `VIN: ${formData.vin}\n` : ''}${estimateLine}`
```

Condition options (label → value): Excellent → `excellent`, Good → `good`, Fair → `fair`, Needs work → `needs_work`.

- [ ] **Step 2: Verify**

Run: `npm run lint` — no new errors. `grep -c "genai\|GEMINI" src/pages/TradeIn.tsx` → 0 matches.

- [ ] **Step 3: Commit**

```bash
git add src/pages/TradeIn.tsx
git commit -m "feat: rebuild trade-in form on server-side valuation, drop client Gemini"
```

---

### Task 4: Restore routes, nav links, homepage section

**Files:**
- Modify: `src/App.tsx:118-119`, `src/components/layout/Navbar.tsx:25-29`, `src/components/layout/Footer.tsx:71-75`, `src/pages/Home.tsx:376`

- [ ] **Step 1: Routes** — in `src/App.tsx` replace the two redirect routes:

```tsx
          <Route path="/trade-in" element={<TradeIn />} />
          <Route path="/trade-in/success" element={<TradeIn />} />
```

- [ ] **Step 2: Navbar** — in `primaryLinks` (Navbar.tsx:25) add after 'Financing':

```tsx
  { name: 'Trade-In', path: '/trade-in' },
```

- [ ] **Step 3: Footer** — in the quick-links array (Footer.tsx:71) add after 'Financing':

```tsx
                { name: 'Trade-In', path: '/trade-in' },
```

- [ ] **Step 4: Homepage section** — replace the comment at Home.tsx:376 (`{/* Trade-In Appraisal Section hidden for now */}`) with a compact CTA band consistent with surrounding sections:

```tsx
      {/* Trade-In Appraisal CTA */}
      <section className="py-16 bg-white">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-display font-black text-brand-primary tracking-tighter mb-4">
            Have a vehicle to trade?
          </h2>
          <p className="text-slate-500 text-lg max-w-2xl mx-auto mb-8">
            Get an instant estimate based on live Atlantic Canada market data — and put it toward your next ride.
          </p>
          <Button asChild className="bg-brand-primary text-white font-bold uppercase tracking-widest text-xs h-12 px-8 rounded-xl shadow-md hover:brightness-110 transition-all">
            <Link to="/trade-in">Get My Trade-In Estimate</Link>
          </Button>
        </div>
      </section>
```

(`Button` and `Link` are already imported in Home.tsx; verify and add imports if not.)

- [ ] **Step 5: Verify + commit**

`npm run lint` passes. `npm run dev`: `/trade-in` renders the form (no redirect), navbar/footer links present, homepage CTA visible.

```bash
git add src/App.tsx src/components/layout/Navbar.tsx src/components/layout/Footer.tsx src/pages/Home.tsx
git commit -m "feat: re-enable trade-in route with navbar, footer, and homepage entry points"
```

---

### Task 5: End-to-end verification + push

- [ ] **Step 1:** `node --import=tsx --test src/lib/tradeInMath.test.ts` — all pass.
- [ ] **Step 2:** `npm run lint` — clean.
- [ ] **Step 3:** With `npm run dev` running, walk the flow: fill vehicle step → estimate step shows manual panel (no API keys in this environment) → contact step → submit → success. Lead POST may fail without Pipedrive/Firestore keys locally; confirm the request body shape in the network log instead.
- [ ] **Step 4:** Push:

```bash
git push -u origin claude/website-identification-439rj4
```

(Retry with 2s/4s/8s/16s backoff on network failure only.)
