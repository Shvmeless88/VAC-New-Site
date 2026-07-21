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
  // deviation would push far past the cap; cap = 22000*0.15 = 3300
  // adjusted = (22000+3300)*0.95 = 24035 → high = round(24035*0.82)
  const r = estimateFromComps([20000, 21000, 22000, 23000, 24000], input({ mileageKm: 0, year: 2015 }));
  assert.ok(r);
  assert.equal(
    r.high,
    Math.round((22000 + 22000 * TRADE_IN_CONFIG.KM_ADJUST_CAP_PCT) * 0.95 * TRADE_IN_CONFIG.OFFER_HIGH_PCT)
  );
});

test('applies the $500 floor', () => {
  const r = estimateFromComps(
    [1200, 1300, 1400, 1500, 1600],
    input({ condition: 'needs_work', mileageKm: 400_000, year: 2010 })
  );
  assert.ok(r);
  assert.ok(r.low >= TRADE_IN_CONFIG.MIN_OFFER);
  assert.ok(r.high >= r.low);
});

test('even-count median averages the middle pair', () => {
  // median of [10000,20000,30000,40000,50000,60000] = 35000
  const r = estimateFromComps(
    [10000, 20000, 30000, 40000, 50000, 60000],
    input({ year: 2026, mileageKm: 0, condition: 'excellent' })
  );
  assert.ok(r);
  // age 0 → expected 0 km, deviation 0 → no mileage adjustment
  assert.equal(r.low, Math.round(35000 * TRADE_IN_CONFIG.OFFER_LOW_PCT));
});
