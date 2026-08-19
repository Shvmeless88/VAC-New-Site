import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion, AnimatePresence } from 'motion/react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Logo from '@/components/layout/Logo';
import { cn, cleanAndFormatPhone } from '@/lib/utils';
import { getStoredUtms } from '@/lib/utms';
import { trackPixelEvent } from '@/lib/pixel';
import { trackGTMEvent } from '@/lib/gtm';
import {
  CheckCircle2, ArrowRight, ArrowLeft, Loader2, Lock, Zap, Truck as TruckIcon,
  CarFront as SuvIcon, Car as CarIcon, Bus as VanIcon, AlertTriangle, Home, ShieldCheck, Users,
} from 'lucide-react';

// Bump this whenever the consent wording below changes. Stored with every lead
// so we can always show exactly what a person agreed to.
export const DV_CONSENT_VERSION = '2026-08-04-v3';

// ⚠️ PLACEHOLDER LEGAL COPY — written in-house, NOT reviewed by a lawyer. This is
// now a BY-SUBMISSION disclaimer (no checkbox): submitting the form IS the consent.
// It still authorizes a credit pull + sharing/sale to third-party dealers, so it
// MUST be reviewed by a lawyer (PIPEDA + CASL + provincial consumer-credit rules)
// before launch — note passive consent is weaker than an explicit checkbox. Bump
// DV_CONSENT_VERSION on any change so each applicant's exact wording stays on file.
const CONSENT_TEXT =
  "By submitting, you agree to our Terms & Privacy Policy and consent to Vehicle Approval Centre and its dealer partners contacting you (by phone, text, or email, including automated) and obtaining your credit report. Consent isn't a condition of purchase — unsubscribe anytime.";
// Dealership variant (vehicleapprovalcentre.com/apply-now) — VAC's OWN store, so no
// "dealer partners" / lead-selling language; just VAC contacting the applicant.
const DEALERSHIP_CONSENT_TEXT =
  "By submitting, you agree to our Terms & Privacy Policy and consent to Vehicle Approval Centre contacting you (by phone, text, or email, including automated) and obtaining your credit report. Consent isn't a condition of purchase — unsubscribe anytime.";

const schema = z.object({
  vehicleType: z.string().min(1, 'Select a vehicle type'),
  budget: z.string().min(1, 'Select a budget'),
  creditRating: z.string().min(1, 'Select your credit situation'),
  employmentStatus: z.string().min(1, 'Select your employment status'),
  employer: z.string().optional(),
  jobTitle: z.string().optional(),
  jobYears: z.string().optional(),
  jobMonths: z.string().optional(),
  incomeSource: z.string().optional(),
  incomeType: z.string().min(1, 'Select one'),
  grossIncome: z.string().min(1, 'Enter an amount'),
  hoursPerWeek: z.string().optional(),
  housing: z.string().min(1, 'Select one'),
  housingPayment: z.string().min(1, 'Enter your monthly payment'),
  addressYears: z.string().optional(),
  addressMonths: z.string().optional(),
  hasTradeIn: z.string().min(1, 'Select one'),
  downPayment: z.string().optional(),
  citizenship: z.string().min(1, 'Select one'),
  validLicense: z.string().min(1, 'Select one'),
  firstName: z.string().min(2, 'First name is required'),
  lastName: z.string().min(2, 'Last name is required'),
  dob: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'DD/MM/YYYY'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(14, 'Enter a valid phone number'),
  streetAddress: z.string().min(3, 'Street address is required'),
  suite: z.string().optional(),
  city: z.string().min(2, 'City is required'),
  province: z.string().min(2, 'Province is required'),
  postalCode: z.string().regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, 'Invalid postal code'),
  // Consent is by-submission (no checkbox) — see CONSENT_TEXT. This funnel
  // deliberately never collects SIN or any banking/card numbers.
});

type FormData = z.infer<typeof schema>;

const IMG = 'https://firebasestorage.googleapis.com/v0/b/gen-lang-client-0753805028.firebasestorage.app/o/vehicle%20cards%20for%20selection%2F';

// Four core body styles, all with photos.
const VEHICLES = [
  { id: 'Sedan', label: 'Sedan', image: `${IMG}sedan_500px.webp?alt=media`, Icon: CarIcon },
  { id: 'Minivan', label: 'Minivan', image: `${IMG}minivan_500px.webp?alt=media`, Icon: VanIcon },
  { id: 'SUV & Crossover', label: 'SUV & Crossover', image: `${IMG}suv_500px.webp?alt=media`, Icon: SuvIcon },
  { id: 'Truck', label: 'Truck', image: `${IMG}truck_500px.webp?alt=media`, Icon: TruckIcon },
];

const BUDGETS = ['Under $400 / mo', '$400–499 / mo', '$500–600 / mo', 'Over $600 / mo'];

// Matches Canada Drives' credit rating criteria exactly.
const CREDIT_OPTIONS = [
  { value: 'Poor', range: '300–599' },
  { value: 'Fair', range: '600–659' },
  { value: 'Good', range: '660–724' },
  { value: 'Very Good', range: '725–759' },
  { value: 'Excellent', range: '760–900' },
  { value: 'No Credit / Unsure', range: '' },
];
const EMPLOYMENT = ['Employed', 'Self-Employed', 'Student', 'Retired / Pension', 'Other'];
const INCOME_TYPES = ['Annual Salary', 'Hourly Wage', 'Monthly Income'];

// Steps whose title/validation are keyed by name so the flow can be a dynamic
// list (Student/Retired skip the "time on job" and "employer" steps).
const TITLES: Record<string, string> = {
  vehicle: 'What are you looking to drive?',
  budget: 'What is your budget?',
  credit: 'How would you rate your credit?',
  employmentStatus: "What's your employment status?",
  incomeType: 'How is your income paid?',
  incomeAmount: 'What is your income?',
  timeOnJob: 'How long have you been at your job?',
  employer: 'Where do you work?',
  housing: 'Do you own or rent?',
  housingPayment: 'Your monthly housing cost',
  timeAtAddress: 'How long at your current address?',
  tradeIn: 'Do you have a trade-in?',
  downPayment: 'How much would you like to put down?',
  residency: 'A couple quick checks',
  identity: 'A few details about you',
  reach: 'How can we reach you?',
  address: 'Where do you live?',
};
const AUTO_ADVANCE = new Set(['vehicle', 'budget', 'credit', 'employmentStatus', 'incomeType', 'housing', 'tradeIn']);

// Tap-to-select tiles used across the quiz steps.
function Tiles({ options, value, onSelect, cols = 2 }: {
  options: string[]; value: string; onSelect: (v: string) => void; cols?: 1 | 2 | 3 | 4;
}) {
  const gridClass = cols === 1 ? 'grid-cols-1' : cols === 4 ? 'grid-cols-2 sm:grid-cols-4' : cols === 3 ? 'grid-cols-3' : 'grid-cols-2';
  return (
    <div className={cn('grid gap-3', gridClass)}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onSelect(opt)}
          className={cn(
            'flex items-center justify-center text-center p-4 rounded-2xl border-2 transition-all duration-300 font-bold text-sm leading-tight',
            value === opt
              ? 'border-brand-accent bg-brand-accent/5 text-brand-accent shadow-[0_0_20px_rgba(115,128,255,0.15)]'
              : 'border-gray-100 bg-white text-brand-primary hover:border-brand-accent/50 hover:shadow-lg'
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

const inputClass =
  'w-full h-11 md:h-12 px-4 rounded-lg border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 transition-all outline-none placeholder:text-gray-400';

// One-shot celebratory confetti for the success screen — no external library.
function Confetti() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setActive(false), 4500);
    return () => clearTimeout(t);
  }, []);
  if (!active) return null;
  const colors = ['#7380FF', '#41456B', '#34D399', '#FBBF24', '#F472B6'];
  const fallTo = (typeof window !== 'undefined' ? window.innerHeight : 900) + 40;
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-50">
      {Array.from({ length: 60 }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.5;
        const duration = 2.4 + Math.random() * 1.8;
        const size = 7 + Math.random() * 6;
        const spin = Math.random() > 0.5 ? 360 : -360;
        return (
          <motion.div
            key={i}
            initial={{ y: -40, opacity: 1, rotate: Math.random() * 360 }}
            animate={{ y: fallTo, rotate: spin, opacity: [1, 1, 0.9, 0] }}
            transition={{ duration, delay, ease: 'easeIn' }}
            style={{
              position: 'absolute',
              top: 0,
              left: `${left}%`,
              width: size,
              height: Math.random() > 0.5 ? size : size / 2,
              backgroundColor: colors[i % colors.length],
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}

export default function DriveVacApply({ mode = 'leadgen' }: { mode?: 'leadgen' | 'dealership' } = {}) {
  const isDealership = mode === 'dealership';
  const consentText = isDealership ? DEALERSHIP_CONSENT_TEXT : CONSENT_TEXT;
  // Came from a VDP "Get Approved" button? Capture the exact vehicle so the lead is
  // tagged with it and we can skip the generic "what are you looking to drive?" step.
  const specificVehicle = (() => {
    if (!isDealership || typeof window === 'undefined') return null;
    const p = new URLSearchParams(window.location.search);
    const id = p.get('vehicleId'), make = p.get('make'), model = p.get('model'), year = p.get('year');
    if (!id && !make) return null;
    return { id: id || '', label: [year, make, model].filter(Boolean).join(' ') || 'the vehicle you selected' };
  })();
  const [step, setStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUnderage, setIsUnderage] = useState(false);
  // True while a step crossfades — locks input so a tap can't land on the
  // outgoing step's controls mid-transition.
  const [transitioning, setTransitioning] = useState(false);
  // Standalone landing page: set its own tab title for the ad → page match.
  useEffect(() => {
    document.title = 'Get Pre-Approved | Vehicle Approval Centre';
    // The dealership test route (/apply-now-v2) is unlisted — keep it out of search.
    if (isDealership) {
      const meta = document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex';
      document.head.appendChild(meta);
      return () => { document.head.removeChild(meta); };
    }
  }, [isDealership]);
  const [isGoogleLoaded, setIsGoogleLoaded] = useState<boolean>(!!(window as any).google?.maps?.places);
  const autocompleteRef = useRef<any>(null);

  const { register, handleSubmit, formState: { errors }, trigger, watch, setValue, setError: setFieldError, clearErrors } = useForm<FormData>({
    resolver: zodResolver(schema),
    // Seed every field so validation always sees a string (empty → the friendly
    // "required" message, never Zod's raw "expected string, received undefined").
    defaultValues: {
      vehicleType: '', budget: '', creditRating: '', employmentStatus: '',
      employer: '', jobTitle: '', jobYears: '', jobMonths: '', incomeSource: '',
      incomeType: '', grossIncome: '', hoursPerWeek: '',
      housing: '', housingPayment: '', addressYears: '', addressMonths: '',
      hasTradeIn: '', downPayment: '', citizenship: '', validLicense: '',
      firstName: '', lastName: '', dob: '', email: '', phone: '',
      streetAddress: '', suite: '', city: '', province: '', postalCode: '',
    },
  });

  // VDP applicants: pre-fill vehicle type with the specific vehicle (validation + "Looking For").
  useEffect(() => {
    if (specificVehicle) setValue('vehicleType', specificVehicle.label);
  }, []);

  const v = watch();
  const jobPath = v.employmentStatus === 'Employed' || v.employmentStatus === 'Self-Employed';

  // The ordered step list. The income section expands to four steps for the
  // working paths (type → amount → time on job → employer), and collapses to
  // two for Student / Retired / Other (type → amount) — matching Canada Drives.
  const steps: string[] = [
    // Skip the generic "what are you looking to drive?" when they came from a specific VDP.
    ...(specificVehicle ? [] : ['vehicle']),
    'budget', 'credit', 'employmentStatus',
    // Students skip "how is your income paid" — their income is asked as monthly.
    ...(v.employmentStatus === 'Student' ? [] : ['incomeType']),
    'incomeAmount',
    ...(jobPath ? ['timeOnJob', 'employer'] : []),
    // The final section is split into short steps so no single page is a wall
    // of fields (and a submit never lights up 9 red errors at once).
    'housing', 'housingPayment', 'timeAtAddress', 'tradeIn', 'downPayment', 'residency', 'identity', 'reach', 'address',
  ];
  const total = steps.length;
  // Front-load the bar: a linear fill makes a ~15-step form feel long, so we
  // curve it (exponent <1) to show a real chunk on the first couple of steps
  // for momentum, and never start below 8%.
  const progress = Math.max(8, Math.pow((step + 1) / total, 0.62) * 100);
  const key = steps[Math.min(step, total - 1)];
  const isLast = key === 'address';
  // Soft reassurance on the final stretch instead of a "Step X of Y" counter.
  const almostDone = key === 'reach' || key === 'address';

  const fieldsFor: Record<string, (keyof FormData)[]> = {
    vehicle: ['vehicleType'], budget: ['budget'], credit: ['creditRating'], employmentStatus: ['employmentStatus'],
    incomeType: ['incomeType'], incomeAmount: ['grossIncome'], timeOnJob: [], employer: [],
    housing: ['housing'], housingPayment: ['housingPayment'], timeAtAddress: [], tradeIn: ['hasTradeIn'], downPayment: [], residency: ['citizenship', 'validLicense'],
    identity: ['firstName', 'lastName', 'dob'], reach: ['email', 'phone'], address: ['streetAddress', 'city', 'province', 'postalCode'],
  };

  const formatDOB = (e: ChangeEvent<HTMLInputElement>) => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 8);
    let out = d.slice(0, 2);
    if (d.length > 2) out += '/' + d.slice(2, 4);
    if (d.length > 4) out += '/' + d.slice(4, 8);
    setValue('dob', out, { shouldValidate: true });
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(out)) {
      // Canadian format: DD/MM/YYYY
      const [dd, mm, yyyy] = out.split('/').map(Number);
      const b = new Date(yyyy, mm - 1, dd);
      const t = new Date();
      let age = t.getFullYear() - b.getFullYear();
      const m = t.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && t.getDate() < b.getDate())) age--;
      setIsUnderage(age < 19);
    } else {
      setIsUnderage(false);
    }
  };

  const formatPhone = (e: ChangeEvent<HTMLInputElement>) =>
    setValue('phone', cleanAndFormatPhone(e.target.value), { shouldValidate: true });

  const formatNumeric = (field: keyof FormData) => (e: ChangeEvent<HTMLInputElement>) =>
    setValue(field, e.target.value.replace(/[^0-9.]/g, ''), { shouldValidate: true });

  const formatPostal = (e: ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (val.length > 3) val = `${val.slice(0, 3)} ${val.slice(3)}`;
    setValue('postalCode', val, { shouldValidate: true });
  };

  // Google Places autocomplete for the address step — one field fills street,
  // city, province and postal. Ported from the main site's financing form.
  const attachAddressAutocomplete = (el: HTMLInputElement | null) => {
    if (!el) { autocompleteRef.current = null; return; }
    const g = (window as any).google;
    if (g?.maps?.places && !autocompleteRef.current) {
      const ac = new g.maps.places.Autocomplete(el, {
        componentRestrictions: { country: 'ca' },
        fields: ['address_components'],
        types: ['address'],
      });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        if (!place.address_components) return;
        let streetNumber = '', route = '', city = '', province = '', postal = '';
        for (const c of place.address_components) {
          const t = c.types as string[];
          if (t.includes('street_number')) streetNumber = c.long_name;
          if (t.includes('route')) route = c.long_name;
          if (t.includes('locality')) city = c.long_name;
          if (t.includes('administrative_area_level_1')) province = c.short_name;
          if (t.includes('postal_code')) postal = c.long_name;
        }
        setValue('streetAddress', `${streetNumber} ${route}`.trim(), { shouldValidate: true });
        setValue('city', city, { shouldValidate: true });
        setValue('province', province, { shouldValidate: true });
        setValue('postalCode', postal, { shouldValidate: true });
      });
      autocompleteRef.current = ac;
    }
  };

  // Load the Maps script once.
  useEffect(() => {
    const apiKey = (import.meta as any).env.VITE_GOOGLE_MAPS_API_KEY;
    if ((window as any).google?.maps?.places) { setIsGoogleLoaded(true); return; }
    if (apiKey && !document.getElementById('dv-google-maps')) {
      const s = document.createElement('script');
      s.id = 'dv-google-maps';
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      s.async = true; s.defer = true;
      s.onload = () => setIsGoogleLoaded(true);
      document.head.appendChild(s);
    }
  }, []);

  // Re-attach once the script loads if the address field is already mounted.
  useEffect(() => {
    if (isGoogleLoaded && key === 'address') {
      const el = document.getElementById('streetAddress') as HTMLInputElement | null;
      if (el) attachAddressAutocomplete(el);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGoogleLoaded, step]);

  const advance = () => { setTransitioning(true); setStep((s) => Math.min(s + 1, total - 1)); };
  const back = () => { setTransitioning(true); setStep((s) => Math.max(s - 1, 0)); };

  const next = async () => {
    if (key === 'incomeAmount') {
      const ok = await trigger(['grossIncome'] as any);
      let extra = true;
      if (v.incomeType === 'Hourly Wage') {
        if (!v.hoursPerWeek) { setFieldError('hoursPerWeek', { message: 'Required' }); extra = false; } else clearErrors('hoursPerWeek');
      }
      if (ok && extra) advance();
      return;
    }
    if (key === 'timeOnJob') {
      const months = (Number(v.jobYears) || 0) * 12 + (Number(v.jobMonths) || 0);
      if (months <= 0) { setFieldError('jobYears', { message: 'Enter how long' }); return; }
      clearErrors('jobYears'); advance(); return;
    }
    if (key === 'timeAtAddress') {
      const months = (Number(v.addressYears) || 0) * 12 + (Number(v.addressMonths) || 0);
      if (months <= 0) { setFieldError('addressYears', { message: 'Enter how long' }); return; }
      clearErrors('addressYears'); advance(); return;
    }
    if (key === 'employer') {
      if (!v.employer) { setFieldError('employer', { message: 'Required' }); return; }
      clearErrors('employer'); advance(); return;
    }
    if (key === 'identity') {
      const ok = await trigger(['firstName', 'lastName', 'dob'] as any);
      if (ok && !isUnderage) advance();
      return;
    }
    const ok = await trigger(fieldsFor[key] as any);
    if (ok) advance();
  };

  // Single-choice steps advance the moment you tap.
  const pickAndAdvance = (field: keyof FormData, val: string) => {
    setValue(field, val, { shouldValidate: true });
    advance();
  };

  // Employment status auto-advances into the income section, clearing whatever
  // fields don't apply to the newly-chosen path.
  const pickStatus = (val: string) => {
    setValue('employmentStatus', val, { shouldValidate: true });
    const job = val === 'Employed' || val === 'Self-Employed';
    if (!job) { setValue('employer', ''); setValue('jobTitle', ''); setValue('jobYears', ''); setValue('jobMonths', ''); clearErrors(['employer', 'jobYears']); }
    if (val !== 'Other') setValue('incomeSource', '');
    // Students bypass the income-type question, so default them to monthly income.
    setValue('incomeType', val === 'Student' ? 'Monthly Income' : '');
    advance();
  };

  const amountLabel = v.incomeType === 'Annual Salary' ? 'Annual income' : v.incomeType === 'Hourly Wage' ? 'Hourly wage' : 'Gross monthly income';
  const amountPlaceholder = v.incomeType === 'Annual Salary' ? 'e.g. 60000' : v.incomeType === 'Hourly Wage' ? 'e.g. 22' : 'e.g. 5000';

  // Two titles read wrong for self-employed applicants, so adapt them.
  const selfEmployed = v.employmentStatus === 'Self-Employed';
  const pageTitle =
    key === 'employer' ? (selfEmployed ? 'Tell us about your business' : 'Where do you work?')
      : key === 'timeOnJob' ? (selfEmployed ? 'How long have you run your business?' : 'How long have you been at your job?')
        : key === 'housingPayment' ? (v.housing === 'Own' ? "What's your monthly mortgage?" : "What's your monthly rent?")
          : TITLES[key];

  const onSubmit = async (data: FormData) => {
    if (isUnderage) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = {
        applicant: {
          firstName: data.firstName,
          lastName: data.lastName,
          dob: data.dob,
          email: data.email,
          phone: data.phone,
          address: { street: data.streetAddress, suite: data.suite, city: data.city, province: data.province, postal: data.postalCode },
        },
        vehicle: { type: data.vehicleType, budgetBand: data.budget, tradeIn: data.hasTradeIn, downPayment: data.downPayment, specificVehicle: specificVehicle?.label || null, specificVehicleId: specificVehicle?.id || null },
        credit: { selfRating: data.creditRating },
        employment: { status: data.employmentStatus, employer: data.employer, jobTitle: data.jobTitle, timeOnJob: { years: data.jobYears, months: data.jobMonths }, incomeType: data.incomeType, grossIncome: data.grossIncome, hoursPerWeek: data.hoursPerWeek, incomeSource: data.incomeSource },
        housing: { ownOrRent: data.housing, monthlyPayment: data.housingPayment, timeAtAddress: { years: data.addressYears, months: data.addressMonths } },
        eligibility: { citizenOrPR: data.citizenship, validLicense: data.validLicense },
        consent: {
          shareWithDealers: !isDealership,
          creditPull: true,
          agreed: true,
          textVersion: DV_CONSENT_VERSION,
          // Send the exact wording shown so the server persists proof of what
          // was agreed to (server also stamps timestamp + IP).
          text: consentText,
        },
        marketing: getStoredUtms(),
      };

      const res = await fetch(isDealership ? '/api/apply-now' : '/api/dv-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('submit failed');
      if (isDealership) {
        // ONE clean completion signal: push a `full_lead` custom event. Point your GTM
        // Full Lead / Meta / TikTok tags at a Custom Event trigger (event = full_lead) so
        // they fire here and NEVER at step 3 (the full-form has no early contact step).
        try {
          (window as any).dataLayer = (window as any).dataLayer || [];
          (window as any).dataLayer.push({ event: 'full_lead', form: 'apply_now' });
        } catch {}
      } else {
        // Lead-gen funnel keeps its existing pixel fires.
        trackPixelEvent('Lead', { content_name: 'VAC Pre-Approval Application' });
        trackGTMEvent('generate_lead', { form: 'vac_pre_approval' });
      }
      setIsSuccess(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center px-4 pt-20 pb-12">
        <Confetti />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[2.5rem] shadow-xl shadow-gray-200/40 p-8 md:p-12 text-center border border-gray-100"
        >
          <motion.div
            initial={{ scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.15 }}
            className="bg-green-50 h-20 w-20 rounded-full flex items-center justify-center mx-auto mb-6 border border-green-100"
          >
            <CheckCircle2 className="h-10 w-10 text-green-500" />
          </motion.div>
          <h2 className="text-2xl font-black text-brand-primary mb-2">You're pre-qualified!</h2>
          <p className="text-gray-500 mb-8">
            Thanks, {v.firstName}! {isDealership ? 'Our team' : 'A dealer partner'} will reach out shortly with your options — including doorstep delivery.
          </p>
          <div className="flex items-center justify-center gap-1.5 text-gray-400">
            <Lock className="h-3.5 w-3.5" />
            <p className="text-[10px] font-bold uppercase tracking-widest">Secure &amp; Encrypted</p>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col overflow-y-auto">
      <div className="flex-grow flex flex-col px-4 pt-8 md:pt-16 pb-10">
        <div className="max-w-2xl w-full mx-auto">
          {/* Header */}
          <div className="flex flex-col items-center mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Logo className="h-8 w-auto" />
              <span className="text-xl font-black text-brand-primary tracking-tight">Vehicle Approval Centre</span>
            </div>
            <div className="inline-flex items-center gap-2 bg-white/60 px-3 py-1.5 rounded-full border border-gray-100 shadow-sm">
              <Lock className="h-3 w-3 text-brand-accent" />
              <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">Secure 256-bit Encryption</span>
            </div>
          </div>

          {specificVehicle && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl bg-brand-accent/10 border border-brand-accent/20 px-4 py-3">
              <CarIcon className="h-5 w-5 text-brand-accent shrink-0" />
              <p className="text-sm text-brand-primary"><span className="text-gray-500">You're applying for </span><span className="font-bold">{specificVehicle.label}</span></p>
            </div>
          )}

          <div className="bg-white rounded-[1.5rem] md:rounded-3xl shadow-xl shadow-gray-200/40 border border-gray-100 overflow-hidden">
            {/* Progress */}
            <div className="bg-slate-50 px-4 md:px-8 py-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-brand-accent font-bold text-[10px] uppercase tracking-widest">
                <Zap className="h-3.5 w-3.5 fill-current" /><span>Instant</span>
              </div>
              <span className={cn('text-[10px] font-bold uppercase tracking-widest', almostDone ? 'text-brand-accent' : 'text-slate-400')}>{almostDone ? 'Almost done' : 'Free · No obligation'}</span>
            </div>
            {/* Progress — a little car drives toward your door as you go */}
            <div className="relative h-7 bg-white">
              <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-100">
                <motion.div className="h-full bg-brand-accent" initial={{ width: '0%' }} animate={{ width: `${progress}%` }} transition={{ duration: 0.5, ease: 'easeOut' }} />
              </div>
              <Home className="absolute right-1.5 bottom-1.5 h-4 w-4 text-slate-300" />
              <motion.div
                className="absolute bottom-0.5"
                initial={{ left: '0%', x: '-50%' }}
                animate={{ left: `${Math.min(progress, 94)}%`, x: '-50%' }}
                transition={{ type: 'spring', stiffness: 120, damping: 18 }}
              >
                <CarIcon className="h-5 w-5 text-brand-accent drop-shadow-sm" />
              </motion.div>
            </div>

            <div className="p-4 md:p-8">
              {/* Override the global uppercase-label style just for this funnel. */}
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 [&_label]:block [&_label]:normal-case [&_label]:tracking-normal [&_label]:text-[13px]">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    onAnimationComplete={() => setTransitioning(false)}
                    className={cn('space-y-5', transitioning && 'pointer-events-none select-none')}
                  >
                    {/* Heading lives inside the animated block so it crossfades in
                        lockstep with the options — no half-changed frame. */}
                    <h1 className="text-[24px] md:text-[30px] font-bold text-brand-primary tracking-tight leading-tight">{pageTitle}</h1>
                    {/* Vehicle */}
                    {key === 'vehicle' && (
                      <div className="grid grid-cols-2 gap-3 md:gap-4">
                        {VEHICLES.map((veh) => (
                          <button key={veh.id} type="button" onClick={() => pickAndAdvance('vehicleType', veh.id)}
                            className={cn('flex flex-col items-center p-3 md:p-6 rounded-2xl border-2 transition-all duration-300 group',
                              v.vehicleType === veh.id ? 'border-brand-accent bg-white shadow-[0_0_20px_rgba(115,128,255,0.15)]' : 'border-gray-100 bg-white hover:border-brand-accent/50 hover:shadow-xl')}>
                            <div className="relative w-full h-16 md:h-24 mb-2 flex items-center justify-center">
                              {veh.image ? (
                                <>
                                  <img src={veh.image} alt={veh.label} className="h-full w-auto max-h-[85%] object-contain group-hover:scale-110 transition-transform" referrerPolicy="no-referrer"
                                    onError={(e) => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'block'; }} />
                                  <veh.Icon className="hidden h-9 w-9 text-gray-300" />
                                </>
                              ) : (
                                <veh.Icon className="h-9 w-9 md:h-11 md:w-11 text-brand-accent/60" />
                              )}
                            </div>
                            <span className={cn('text-[11px] md:text-sm font-bold uppercase tracking-[0.12em] text-center leading-tight', v.vehicleType === veh.id ? 'text-brand-accent' : 'text-brand-primary')}>{veh.label}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Budget */}
                    {key === 'budget' && (
                      <div className="space-y-3">
                        {BUDGETS.map((b) => (
                          <button key={b} type="button" onClick={() => pickAndAdvance('budget', b)}
                            className={cn('w-full flex items-center justify-center text-center p-4 rounded-2xl border-2 transition-all duration-300 font-bold text-sm',
                              v.budget === b ? 'border-brand-accent bg-brand-accent/5 text-brand-accent shadow-[0_0_20px_rgba(115,128,255,0.15)]' : 'border-gray-100 bg-white text-brand-primary hover:border-brand-accent/50 hover:shadow-lg')}>
                            {b}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Credit */}
                    {key === 'credit' && (
                      <div className="grid grid-cols-1 gap-3">
                        {CREDIT_OPTIONS.map((opt) => (
                          <button key={opt.value} type="button" onClick={() => pickAndAdvance('creditRating', opt.value)}
                            className={cn('w-full flex items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all duration-300',
                              v.creditRating === opt.value ? 'border-brand-accent bg-brand-accent/5 shadow-[0_0_20px_rgba(115,128,255,0.15)]' : 'border-gray-100 bg-white hover:border-brand-accent/50 hover:shadow-lg')}>
                            <span className={cn('text-sm font-bold', v.creditRating === opt.value ? 'text-brand-accent' : 'text-brand-primary')}>{opt.value}</span>
                            {opt.range && <span className="text-xs font-semibold text-gray-500">{opt.range}</span>}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Employment status (auto-advances) */}
                    {key === 'employmentStatus' && (
                      <>
                        <Tiles options={EMPLOYMENT} value={v.employmentStatus} onSelect={pickStatus} cols={1} />
                        {errors.employmentStatus && <p className="text-xs text-red-500 mt-2">{errors.employmentStatus.message}</p>}
                      </>
                    )}

                    {/* Income type (auto-advances) */}
                    {key === 'incomeType' && (
                      <Tiles options={INCOME_TYPES} value={v.incomeType} onSelect={(val) => pickAndAdvance('incomeType', val)} cols={1} />
                    )}

                    {/* Income amount */}
                    {key === 'incomeAmount' && (
                      <>
                        {v.employmentStatus === 'Other' && (
                          <div className="space-y-2">
                            <Label htmlFor="incomeSource">Source of income <span className="text-gray-500 normal-case font-medium">(optional)</span></Label>
                            <Input id="incomeSource" {...register('incomeSource')} placeholder="e.g. Disability, EI, support" className={inputClass} />
                          </div>
                        )}
                        <div className="space-y-2">
                          <Label htmlFor="grossIncome">{amountLabel} <span className="text-gray-500 normal-case font-medium">(before taxes &amp; deductions)</span></Label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                            <Input id="grossIncome" inputMode="decimal" value={v.grossIncome || ''} onChange={formatNumeric('grossIncome')} placeholder={amountPlaceholder} className={cn(inputClass, 'pl-8')} />
                          </div>
                          {errors.grossIncome && <p className="text-xs text-red-500">{errors.grossIncome.message}</p>}
                        </div>
                        {v.incomeType === 'Hourly Wage' && (
                          <div className="space-y-2">
                            <Label htmlFor="hoursPerWeek">Hours per week</Label>
                            <Input id="hoursPerWeek" inputMode="decimal" value={v.hoursPerWeek || ''} onChange={formatNumeric('hoursPerWeek')} placeholder="e.g. 40" className={inputClass} />
                            {errors.hoursPerWeek && <p className="text-xs text-red-500">{errors.hoursPerWeek.message}</p>}
                          </div>
                        )}
                      </>
                    )}

                    {/* Time on the job — Years / Months (like Canada Drives) */}
                    {key === 'timeOnJob' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="jobYears">Years</Label>
                            <Input id="jobYears" inputMode="numeric" value={v.jobYears || ''} onChange={formatNumeric('jobYears')} placeholder="0" className={inputClass} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="jobMonths">Months</Label>
                            <Input id="jobMonths" inputMode="numeric" value={v.jobMonths || ''} onChange={formatNumeric('jobMonths')} placeholder="0" className={inputClass} />
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-500">Enter 1 month if you just started your job.</p>
                        {errors.jobYears && <p className="text-xs text-red-500">{errors.jobYears.message}</p>}
                      </>
                    )}

                    {/* Employer + job title */}
                    {key === 'employer' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="employer">{v.employmentStatus === 'Self-Employed' ? 'Business name' : 'Employer'}</Label>
                          <Input id="employer" {...register('employer')} placeholder="Company name" className={inputClass} />
                          {errors.employer && <p className="text-xs text-red-500">{errors.employer.message}</p>}
                        </div>
                        {v.employmentStatus === 'Employed' && (
                          <div className="space-y-2">
                            <Label htmlFor="jobTitle">Job title <span className="text-gray-500 normal-case font-medium">(optional)</span></Label>
                            <Input id="jobTitle" {...register('jobTitle')} placeholder="e.g. Technician" className={inputClass} />
                          </div>
                        )}
                      </>
                    )}

                    {/* Own or rent (auto-advances) */}
                    {key === 'housing' && (
                      <>
                        <Tiles options={['Own', 'Rent']} value={v.housing} onSelect={(val) => pickAndAdvance('housing', val)} cols={1} />
                        {errors.housing && <p className="text-xs text-red-500 mt-2">{errors.housing.message}</p>}
                      </>
                    )}

                    {/* Monthly housing payment */}
                    {key === 'housingPayment' && (
                      <div className="space-y-2">
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                          <Input id="housingPayment" inputMode="decimal" value={v.housingPayment || ''} onChange={formatNumeric('housingPayment')} placeholder="e.g. 1500" className={cn(inputClass, 'pl-8')} />
                        </div>
                        {errors.housingPayment && <p className="text-xs text-red-500">{errors.housingPayment.message}</p>}
                      </div>
                    )}

                    {/* Time at address — Years / Months */}
                    {key === 'timeAtAddress' && (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="addressYears">Years</Label>
                            <Input id="addressYears" inputMode="numeric" value={v.addressYears || ''} onChange={formatNumeric('addressYears')} placeholder="0" className={inputClass} />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="addressMonths">Months</Label>
                            <Input id="addressMonths" inputMode="numeric" value={v.addressMonths || ''} onChange={formatNumeric('addressMonths')} placeholder="0" className={inputClass} />
                          </div>
                        </div>
                        <p className="text-[11px] text-gray-500">Enter 1 month if you just moved in.</p>
                        {errors.addressYears && <p className="text-xs text-red-500">{errors.addressYears.message}</p>}
                      </>
                    )}

                    {/* Trade-in (auto-advances) */}
                    {key === 'tradeIn' && (
                      <>
                        <Tiles options={['Yes', 'No', 'Unsure']} value={v.hasTradeIn} onSelect={(val) => pickAndAdvance('hasTradeIn', val)} cols={1} />
                        {errors.hasTradeIn && <p className="text-xs text-red-500 mt-2">{errors.hasTradeIn.message}</p>}
                      </>
                    )}

                    {/* Cash down (optional) */}
                    {key === 'downPayment' && (
                      <div className="space-y-2">
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                          <Input id="downPayment" inputMode="decimal" value={v.downPayment || ''} onChange={formatNumeric('downPayment')} placeholder="e.g. 2000" className={cn(inputClass, 'pl-8')} />
                        </div>
                        <p className="text-[11px] text-gray-500">Optional — leave blank if you're not sure.</p>
                      </div>
                    )}

                    {/* Residency & licence */}
                    {key === 'residency' && (
                      <>
                        <div className="space-y-2">
                          <Label>Are you a Canadian citizen or permanent resident?</Label>
                          <Tiles options={['Yes', 'No']} value={v.citizenship} onSelect={(val) => setValue('citizenship', val, { shouldValidate: true })} cols={1} />
                          {errors.citizenship && <p className="text-xs text-red-500">{errors.citizenship.message}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label>Do you have a valid Canadian driver's licence?</Label>
                          <Tiles options={['Yes', 'No']} value={v.validLicense} onSelect={(val) => setValue('validLicense', val, { shouldValidate: true })} cols={1} />
                          {errors.validLicense && <p className="text-xs text-red-500">{errors.validLicense.message}</p>}
                        </div>
                      </>
                    )}

                    {/* About you — name + DOB */}
                    {key === 'identity' && (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="firstName">First name</Label>
                            <Input id="firstName" {...register('firstName')} placeholder="John" className={inputClass} />
                            {errors.firstName && <p className="text-xs text-red-500">{errors.firstName.message}</p>}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="lastName">Last name</Label>
                            <Input id="lastName" {...register('lastName')} placeholder="Doe" className={inputClass} />
                            {errors.lastName && <p className="text-xs text-red-500">{errors.lastName.message}</p>}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="dob">Date of birth</Label>
                          <Input id="dob" inputMode="numeric" value={v.dob || ''} onChange={formatDOB} placeholder="DD/MM/YYYY" className={cn(inputClass, isUnderage && 'border-red-500')} />
                          {errors.dob && <p className="text-xs text-red-500">{errors.dob.message}</p>}
                          {isUnderage && <p className="text-xs text-red-500">You must be at least 19 years old.</p>}
                        </div>
                      </>
                    )}

                    {/* Reach — email + phone */}
                    {key === 'reach' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input id="email" type="email" {...register('email')} placeholder="john@example.com" className={inputClass} />
                          {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="phone">Phone</Label>
                          <Input id="phone" type="tel" inputMode="numeric" value={v.phone || ''} onChange={formatPhone} placeholder="(902) 000-0000" className={inputClass} />
                          {errors.phone && <p className="text-xs text-red-500">{errors.phone.message}</p>}
                        </div>
                      </>
                    )}

                    {/* Address (Google autocomplete) + consent */}
                    {key === 'address' && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="streetAddress">Street address</Label>
                          <Input id="streetAddress" {...register('streetAddress')}
                            ref={(e) => { register('streetAddress').ref(e); attachAddressAutocomplete(e as HTMLInputElement | null); }}
                            placeholder={isGoogleLoaded ? 'Start typing your address…' : '123 Main St'} className={inputClass} />
                          {errors.streetAddress && <p className="text-xs text-red-500">{errors.streetAddress.message}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="suite">Apt, suite, or unit <span className="text-gray-500 normal-case font-medium">(optional)</span></Label>
                          <Input id="suite" {...register('suite')} placeholder="e.g. 4B" className={inputClass} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="city">City</Label>
                            <Input id="city" {...register('city')} placeholder="City" className={inputClass} />
                            {errors.city && <p className="text-xs text-red-500">{errors.city.message}</p>}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="province">Province</Label>
                            <Input id="province" {...register('province')} placeholder="NS" className={inputClass} />
                            {errors.province && <p className="text-xs text-red-500">{errors.province.message}</p>}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="postalCode">Postal code</Label>
                          <Input id="postalCode" value={v.postalCode || ''} onChange={formatPostal} autoCapitalize="characters" placeholder="A1B 2C3" className={inputClass} />
                          {errors.postalCode && <p className="text-xs text-red-500">{errors.postalCode.message}</p>}
                        </div>

                        {/* Consent — by-submission disclaimer (no checkbox). The
                            exact text is stored server-side with timestamp + IP. */}
                        <p className="pt-3 border-t border-gray-100 text-[10px] leading-snug text-gray-400">{consentText}</p>
                      </>
                    )}
                  </motion.div>
                </AnimatePresence>

                {error && <div className="p-3 bg-red-50 text-red-600 rounded-lg text-xs font-medium">{error}</div>}

                {/* Nav — auto-advance steps hide the Continue button */}
                <div className="flex gap-3 pt-2">
                  {step > 0 && (
                    <Button type="button" variant="outline" onClick={back} disabled={transitioning} className="h-12 px-5 border-slate-200 text-brand-primary hover:bg-slate-50 rounded-xl">
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                  )}
                  {isLast ? (
                    <Button type="submit" disabled={isSubmitting || isUnderage} variant="brand" className="flex-1 h-12 rounded-xl font-bold uppercase tracking-widest text-[11px]">
                      {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing…</> : 'See What You Qualify For'}
                    </Button>
                  ) : AUTO_ADVANCE.has(key) ? null : (
                    <Button type="button" onClick={next} disabled={transitioning} variant="brand" className="flex-1 h-12 rounded-xl font-bold uppercase tracking-widest text-[11px]">
                      Continue <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                </div>
                {isUnderage && key === 'identity' && (
                  <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" /><p className="text-[10px] font-medium">Must be 19+ to apply.</p>
                  </div>
                )}
              </form>
            </div>
          </div>

          {/* Entry-step reassurance + how it works — only on the first page */}
          {key === 'vehicle' && (
            <div className="mt-6 space-y-6">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                {[
                  { Icon: ShieldCheck, label: "Won't affect your credit" },
                  { Icon: CheckCircle2, label: 'Every credit situation' },
                  { Icon: Lock, label: 'Secure & private' },
                ].map(({ Icon, label }) => (
                  <div key={label} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand-primary">
                    <Icon className="h-3.5 w-3.5 text-brand-accent" />{label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { Icon: Zap, title: 'Apply', sub: 'In about 2 minutes' },
                  { Icon: Users, title: 'Get matched', sub: 'With a local dealer' },
                  { Icon: Home, title: 'Delivered', sub: 'Right to your door' },
                ].map(({ Icon, title, sub }) => (
                  <div key={title} className="flex flex-col items-center text-center">
                    <div className="h-9 w-9 rounded-xl bg-brand-accent/10 flex items-center justify-center mb-1.5">
                      <Icon className="h-4 w-4 text-brand-accent" />
                    </div>
                    <span className="text-[12px] font-bold text-brand-primary">{title}</span>
                    <span className="text-[10px] text-gray-400 leading-tight">{sub}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Slim footer — legal + transparency. Legal pages are in-house drafts
              pending lawyer review (see DriveVacLegal.tsx). */}
          <footer className="mt-8 text-center space-y-2">
            <p className="text-[10px] text-gray-500 leading-relaxed max-w-md mx-auto">
              {isDealership
                ? 'Vehicle Approval Centre will use the information you provide to contact you about financing and to obtain your credit report, and to deliver an approved vehicle to your door.'
                : 'Vehicle Approval Centre connects you with licensed dealer partners across Canada who deliver to your door. The information you provide is shared with — and may be sold to — those partners so they can contact you.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-medium text-gray-500">
              <a href="/dv-privacy" target="_blank" rel="noopener noreferrer" className="hover:text-brand-primary underline underline-offset-2">Privacy Policy</a>
              <span className="text-gray-300">·</span>
              <a href="/dv-terms" target="_blank" rel="noopener noreferrer" className="hover:text-brand-primary underline underline-offset-2">Terms</a>
              <span className="text-gray-300">·</span>
              <a href="mailto:privacy@vehicleapprovalcentre.com" className="hover:text-brand-primary underline underline-offset-2">Withdraw consent</a>
              <span className="text-gray-300">·</span>
              <a href="mailto:support@vehicleapprovalcentre.com" className="hover:text-brand-primary underline underline-offset-2">Contact</a>
            </div>
            <p className="text-[10px] text-gray-400">© {new Date().getFullYear()} Vehicle Approval Centre</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
