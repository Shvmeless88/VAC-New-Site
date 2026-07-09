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
