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
