import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

export function getVehicleSlug(car: { year?: number | string; make?: string; model?: string; trim?: string }): string {
  const parts = [car.year, car.make, car.model, car.trim].filter(Boolean);
  return slugify(parts.join(' '));
}

export function getVehicleUrl(car: { id: string; year?: number | string; make?: string; model?: string; trim?: string }): string {
  const slug = getVehicleSlug(car);
  if (!slug) return `/inventory/${car.id}`;
  return `/inventory/${slug}-${car.id}`;
}

export function cleanAndFormatPhone(rawInput: string): string {
  // Strip non-digits
  let digits = rawInput.replace(/\D/g, "");
  
  // Strip country code '1' or operator prefix '0' if it is at the start
  // e.g., if we have "1902...", strip the leading "1" to get "902..."
  while (digits.startsWith("1") || digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  
  // Limit to 10 digits
  if (digits.length > 10) {
    digits = digits.slice(0, 10);
  }
  
  // Format as (XXX) XXX-XXXX
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function calculateBiWeeklyPayment(price: number, interestRate: number, termMonths: number, downPayment: number = 0, tradeIn: number = 0): number {
  const principal = Math.max(0, price - downPayment - tradeIn);
  if (principal === 0) return 0;
  if (interestRate === 0) return (principal / termMonths * 12) / 26;
  
  const r = (interestRate / 100) / 12;
  const n = termMonths;
  const monthlyPayment = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  
  return (monthlyPayment * 12) / 26;
}

// ---- Financing term eligibility (lender rate sheets, updated Sep 2026) ----
// Max amortization is set by MODEL YEAR + KILOMETRES (Eden Park booking guide,
// cross-checked against TD Auto Finance and iA Auto Finance matrices). Nothing
// above 180,000 km, and nothing older than 2016, is financeable at all.
// Bands are [maxKm, termMonths] pairs; the first band the car's km fits wins.
const TERM_BANDS: Record<number, [number, number][]> = {
  2027: [[180000, 84]],
  2026: [[180000, 84]],
  2025: [[68000, 84], [100000, 84], [130000, 84], [180000, 72]],
  2024: [[78000, 84], [125000, 84], [150000, 78], [180000, 66]],
  2023: [[85000, 84], [125000, 84], [150000, 78], [180000, 66]],
  2022: [[95000, 84], [130000, 84], [160000, 72], [180000, 66]],
  2021: [[95000, 84], [120000, 84], [170000, 72], [180000, 66]],
  2020: [[110000, 78], [135000, 72], [170000, 60], [180000, 54]],
  2019: [[110000, 72], [130000, 66], [170000, 54], [180000, 48]],
  2018: [[145000, 48], [165000, 48], [180000, 36]],
  2017: [[145000, 48], [165000, 42], [180000, 24]],
  2016: [[145000, 36], [165000, 36], [180000, 12]],
};

/** Longest financing term (months) a vehicle qualifies for, or null if it
 *  can't be financed (year < 2016 or over 180,000 km). */
export function maxFinancingTerm(year?: number | null, km?: number | null): number | null {
  const y = Number(year), k = Number(km);
  if (!y || y < 2016) return null;
  const bands = TERM_BANDS[Math.min(y, 2027)];
  if (!bands) return null;
  if (!k || k <= 0) return bands[0][1];       // unknown km — assume best band
  if (k > 180000) return null;
  for (const [maxKm, term] of bands) if (k <= maxKm) return term;
  return null;
}
