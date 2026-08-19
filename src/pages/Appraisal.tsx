import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { compressImage } from '../lib/imageCompress';

interface PhotoSlot {
  slot: string;
  label: string;
  hint?: string;
}

// Ordered as a walk-around: front → right → back → left, so the customer just
// keeps circling the car in one direction instead of criss-crossing it.
const REQUIRED_PHOTOS: PhotoSlot[] = [
  { slot: 'registration', label: 'Vehicle registration', hint: 'The paper permit' },
  { slot: 'front', label: '1. Front', hint: 'Start here' },
  { slot: 'right', label: '2. Right side', hint: 'Walk clockwise' },
  { slot: 'back', label: '3. Back', hint: 'Keep going' },
  { slot: 'left', label: '4. Left side', hint: "You're back where you started" },
  { slot: 'interior-front', label: 'Interior — front' },
  { slot: 'interior-back', label: 'Interior — back' },
  { slot: 'dash', label: 'Dash', hint: 'Engine running, showing kilometers' },
  { slot: 'tire', label: 'Close-up of one tire' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Sticker expiry runs into the future on a current vehicle and into the past on
// a lapsed one, so the range has to straddle today.
const THIS_YEAR = new Date().getFullYear();
const EXPIRY_YEARS = Array.from({ length: 9 }, (_, i) => String(THIS_YEAR - 4 + i));

type VinMode = 'photo' | 'manual';

export default function Appraisal() {
  const [searchParams] = useSearchParams();

  const [applicationId, setApplicationId] = useState(searchParams.get('app')?.trim() || '');
  // CRM link mode: /appraisal?lead=<token> — pre-tied to the customer's lead, no App ID needed.
  const leadToken = (searchParams.get('lead') || '').trim();
  const [leadInfo, setLeadInfo] = useState<{ found: boolean | null; firstName?: string; rep?: string | null } | null>(null);
  useEffect(() => {
    if (!leadToken) return;
    let cancelled = false;
    fetch(`/api/appraisal/lead?lead=${encodeURIComponent(leadToken)}`).then((r) => r.json()).then((j) => { if (!cancelled) setLeadInfo(j); }).catch(() => { if (!cancelled) setLeadInfo({ found: null }); });
    return () => { cancelled = true; };
  }, [leadToken]);
  const linkMode = !!leadToken && leadInfo?.found !== false;
  // 'unknown' = our lookup itself failed. Distinct from 'found' on purpose: a
  // broken lookup must never render as a reassuring green checkmark.
  const [appStatus, setAppStatus] = useState<
    'idle' | 'checking' | 'found' | 'notfound' | 'unknown'
  >('idle');

  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [trim, setTrim] = useState('');
  const [kilometers, setKilometers] = useState('');

  // The sticker shows an EXPIRY, which is what a customer can actually read off
  // their windshield. Asking for the inspection date instead would have them
  // reading the same sticker and reporting a number ~2 years out.
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  const [expiryUnknown, setExpiryUnknown] = useState(false);

  const [vinMode, setVinMode] = useState<VinMode>('manual');
  const [vin, setVin] = useState('');
  const [notes, setNotes] = useState('');

  const [photos, setPhotos] = useState<Record<string, File>>({});
  const [damagePhotos, setDamagePhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [compressing, setCompressing] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { matched: boolean; photosUploaded: number }>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // iOS shrinks the visual viewport when the keyboard opens but leaves a
  // position:sticky bar pinned to it, so the button and the keyboard end up
  // squeezing the form into a sliver. Unstick the bar while the keyboard is up.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => setKeyboardOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener('resize', onResize);
    onResize();

    return () => vv.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.title = 'Trade-In Appraisal | Vehicle Approval Centre';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  // The Pipedrive LeadBooster chat widget is injected globally by Google Tag
  // Manager, so it isn't in our React tree — a rendered <style> is the only way
  // to reliably suppress it here, and it keeps working even though the widget
  // loads asynchronously after mount. This page is a single, focused task; a
  // chat bubble is exactly the distraction we're removing.
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-appraisal-hide-chat', '');
    // Pipedrive's own sheet forces `html body #LeadboosterContainer{display:block
    // !important}`. Repeating the ID (#id#id) doubles ID specificity so this wins
    // regardless of source order — a plain `#LeadboosterContainer` loses to it.
    style.textContent =
      '#LeadboosterContainer#LeadboosterContainer, ' +
      'html body iframe[id*="eadbooster"]#LeadboosterContainer { display: none !important; }';
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Check the application number up front. Finding out it's wrong *after*
  // photographing the whole car would be maddening.
  useEffect(() => {
    const id = applicationId.trim();
    if (!id) {
      setAppStatus('idle');
      return;
    }
    setAppStatus('checking');
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/appraisal/verify?app=${encodeURIComponent(id)}`);
        const body = await res.json();
        if (body.found === true) setAppStatus('found');
        else if (body.found === false) setAppStatus('notfound');
        else setAppStatus('unknown'); // lookup broke — say nothing rather than lie
      } catch {
        setAppStatus('unknown');
      }
    }, 600);
    return () => clearTimeout(t);
  }, [applicationId]);

  const setPhotoFile = async (slot: string, file: File | undefined) => {
    if (!file) return;
    setCompressing(slot);
    try {
      const compressed = await compressImage(file);
      setPhotos((p) => ({ ...p, [slot]: compressed }));
      setPreviews((p) => {
        if (p[slot]) URL.revokeObjectURL(p[slot]);
        return { ...p, [slot]: URL.createObjectURL(compressed) };
      });
    } finally {
      setCompressing(null);
    }
  };

  const addDamagePhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setCompressing('damage');
    try {
      const compressed = await Promise.all(Array.from(files).map((f) => compressImage(f)));
      setDamagePhotos((d) => [...d, ...compressed].slice(0, 6));
    } finally {
      setCompressing(null);
    }
  };

  const photoCount = Object.keys(photos).length;
  const needsVinPhoto = vinMode === 'photo';
  const totalRequired = REQUIRED_PHOTOS.length + (needsVinPhoto ? 1 : 0);
  const requiredDone =
    REQUIRED_PHOTOS.filter((p) => photos[p.slot]).length + (needsVinPhoto && photos.vin ? 1 : 0);

  const inspectionDone = expiryUnknown || (expiryMonth !== '' && expiryYear !== '');

  const canSubmit =
    (linkMode || applicationId.trim() !== '') &&
    year.trim() !== '' &&
    make.trim() !== '' &&
    model.trim() !== '' &&
    Number(kilometers) > 0 &&
    inspectionDone &&
    (vinMode === 'photo' ? Boolean(photos.vin) : vin.trim().length >= 11) &&
    requiredDone === totalRequired &&
    !submitting;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    setProgress(0);

    const form = new FormData();
    form.append('applicationId', applicationId.trim());
    if (leadToken) form.append('leadToken', leadToken);
    form.append('year', year.trim());
    form.append('make', make.trim());
    form.append('model', model.trim());
    form.append('trim', trim.trim());
    // Exact odometer reading — the appraisal is booked on this number.
    form.append('kilometers', kilometers);
    form.append(
      'inspectionExpiry',
      expiryUnknown ? 'Unknown / no sticker found' : `${expiryMonth} ${expiryYear}`
    );
    if (vinMode === 'manual') form.append('vin', vin.trim());
    form.append('notes', notes.trim());

    Object.entries(photos).forEach(([slot, file]) => form.append(`photo_${slot}`, file, file.name));
    damagePhotos.forEach((file, i) => form.append(`photo_damage-${i + 1}`, file, file.name));

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/appraisal');
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const body = JSON.parse(xhr.responseText);
            xhr.status >= 200 && xhr.status < 300 ? resolve(body) : reject(new Error(body.error));
          } catch {
            reject(new Error('Unexpected response from the server.'));
          }
        };
        xhr.onerror = () => reject(new Error('Network error. Please check your connection.'));
        xhr.send(form);
      });

      setDone({ matched: result.matched, photosUploaded: result.photosUploaded });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err?.message || "We couldn't submit your appraisal. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-5 py-16">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-display font-black text-brand-primary mb-3 tracking-tight">
            Thanks — we've got it.
          </h1>
          <p className="text-slate-600 mb-2">
            Your {[year, make, model].filter(Boolean).join(' ')} and {done.photosUploaded || photoCount} photos
            are with our appraisal team.
          </p>
          <p className="text-slate-600">
            Someone will be in touch shortly with your trade-in value. You can close this page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg">
      {/* No navbar on this page — keep it distraction-free. */}
      <div className="max-w-xl mx-auto px-4 pt-10 pb-10 md:pt-14 md:pb-16">
        <header className="mb-8 px-1">
          <img
            src="/favicon.svg"
            alt="Vehicle Approval Centre"
            className="h-9 w-9 mb-6"
          />
          <h1 className="text-2xl leading-tight md:text-4xl font-display font-black text-brand-primary tracking-tight mb-3 text-balance">
            Let's value your <span className="whitespace-nowrap">trade-in.</span>
          </h1>
          <p className="text-slate-500 leading-relaxed">
            A few details and some photos of your vehicle — about 5 minutes. Best done standing beside
            your car in good light.
          </p>
        </header>

        <div className="space-y-4">
          {linkMode && leadInfo?.found && leadInfo.firstName && (
            <p className="text-lg font-semibold text-slate-700">Hi {leadInfo.firstName} 👋</p>
          )}
          {/* Application number */}
          {!linkMode && <Section title="Your application number">
            <input
              type="text"
              value={applicationId}
              onChange={(e) => setApplicationId(e.target.value.toUpperCase())}
              placeholder="e.g. SMIT1234"
              autoCapitalize="characters"
              aria-label="Application number"
              className={`${INPUT} text-lg font-medium tracking-wide`}
            />
            <div className="mt-2 min-h-[20px] text-sm">
              {appStatus === 'checking' && <span className="text-slate-400">Checking…</span>}
              {appStatus === 'found' && (
                <span className="text-green-600 font-medium">✓ Found your application</span>
              )}
              {appStatus === 'notfound' && (
                <span className="text-amber-600">
                  We couldn't find that number — double-check it with your sales rep. You can still
                  submit, and we'll match it up manually.
                </span>
              )}
              {appStatus === 'unknown' && (
                <span className="text-slate-400">We'll confirm this when you submit.</span>
              )}
              {appStatus === 'idle' && (
                <span className="text-slate-400">Your sales rep gave you this.</span>
              )}
            </div>
          </Section>}

          {/* Vehicle details */}
          <Section title="Your vehicle">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Year" value={year} onChange={setYear} placeholder="2018" inputMode="numeric" />
              <Field label="Make" value={make} onChange={setMake} placeholder="Honda" />
              <Field label="Model" value={model} onChange={setModel} placeholder="Civic" />
              <Field label="Trim" value={trim} onChange={setTrim} placeholder="LX (optional)" />
            </div>

            <div className="mt-3">
              <FieldLabel>Exact kilometers</FieldLabel>
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  value={kilometers ? Number(kilometers).toLocaleString('en-CA') : ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 7);
                    setKilometers(digits);
                  }}
                  placeholder="184,500"
                  aria-label="Exact kilometers"
                  className={`${INPUT} pr-12 text-lg font-medium`}
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">
                  km
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-2">Read it straight off your odometer.</p>
            </div>
          </Section>

          {/* Safety inspection sticker */}
          <Section title="Safety inspection sticker">
            <p className="text-sm text-slate-500 leading-relaxed mb-4 -mt-1">
              When does it <span className="font-semibold text-slate-700">expire</span>? The sticker is
              on your windshield or driver's door frame — read the month and year straight off it.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={expiryMonth}
                disabled={expiryUnknown}
                onChange={(e) => setExpiryMonth(e.target.value)}
                aria-label="Inspection expiry month"
                className={`${INPUT} ${expiryUnknown ? 'opacity-50' : ''}`}
              >
                <option value="">Month</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>

              <select
                value={expiryYear}
                disabled={expiryUnknown}
                onChange={(e) => setExpiryYear(e.target.value)}
                aria-label="Inspection expiry year"
                className={`${INPUT} ${expiryUnknown ? 'opacity-50' : ''}`}
              >
                <option value="">Year</option>
                {EXPIRY_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2.5 mt-3 cursor-pointer normal-case">
              <input
                type="checkbox"
                checked={expiryUnknown}
                onChange={(e) => {
                  setExpiryUnknown(e.target.checked);
                  if (e.target.checked) {
                    setExpiryMonth('');
                    setExpiryYear('');
                  }
                }}
                className="w-4 h-4 rounded border-slate-300 text-brand-secondary focus:ring-brand-secondary"
              />
              <span className="text-sm text-slate-600 normal-case">
                I can't find a sticker / not sure
              </span>
            </label>
          </Section>

          {/* VIN */}
          <Section title="VIN">
            <div className="flex gap-2 mb-3">
              <ModeButton active={vinMode === 'manual'} onClick={() => setVinMode('manual')}>
                Type it
              </ModeButton>
              <ModeButton active={vinMode === 'photo'} onClick={() => setVinMode('photo')}>
                Photograph it
              </ModeButton>
            </div>

            {vinMode === 'manual' ? (
              <>
                <input
                  type="text"
                  value={vin}
                  onChange={(e) => setVin(e.target.value.toUpperCase())}
                  placeholder="17 characters"
                  maxLength={17}
                  autoCapitalize="characters"
                  aria-label="VIN"
                  className={`${INPUT} font-mono text-lg tracking-wide`}
                />
                <p className="text-sm text-slate-400 mt-2">
                  On your registration, or the driver's-side dashboard by the windshield.
                </p>
              </>
            ) : (
              <PhotoTile
                slot="vin"
                label="Photo of your VIN"
                hint="Dashboard by the windshield, or the door jamb sticker"
                file={photos.vin}
                preview={previews.vin}
                compressing={compressing === 'vin'}
                onPick={(f) => setPhotoFile('vin', f)}
              />
            )}
          </Section>

          {/* Photos */}
          <Section
            title="Photos"
            aside={
              <span className="text-sm font-semibold text-brand-secondary tabular-nums">
                {requiredDone}/{totalRequired}
              </span>
            }
          >
            <div className="h-1.5 bg-slate-100 rounded-full mb-5 overflow-hidden">
              <div
                className="h-full bg-brand-secondary rounded-full transition-all duration-300"
                style={{ width: `${(requiredDone / totalRequired) * 100}%` }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {REQUIRED_PHOTOS.map((p) => (
                <PhotoTile
                  key={p.slot}
                  slot={p.slot}
                  label={p.label}
                  hint={p.hint}
                  file={photos[p.slot]}
                  preview={previews[p.slot]}
                  compressing={compressing === p.slot}
                  onPick={(f) => setPhotoFile(p.slot, f)}
                />
              ))}
            </div>
          </Section>

          {/* Damage */}
          <Section title="Any damage?" optional>
            <p className="text-sm text-slate-500 leading-relaxed mb-4 -mt-1">
              Dents, scratches, cracked glass, warning lights. Being upfront keeps your value accurate —
              surprises at inspection are what change an offer.
            </p>

            {damagePhotos.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {damagePhotos.map((f, i) => (
                  <div key={i} className="relative">
                    <img
                      src={URL.createObjectURL(f)}
                      alt={`Damage ${i + 1}`}
                      className="w-20 h-20 object-cover rounded-lg border border-slate-200"
                    />
                    <button
                      type="button"
                      onClick={() => setDamagePhotos((d) => d.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center"
                      aria-label={`Remove damage photo ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-slate-500 font-medium text-sm normal-case cursor-pointer hover:border-brand-secondary hover:text-brand-secondary transition-colors">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => addDamagePhotos(e.target.files)}
              />
              {compressing === 'damage' ? 'Processing…' : '+ Add damage photos'}
            </label>
          </Section>

          {/* Notes */}
          <Section title="Anything else?" optional>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Winter tires included, recent brake job, still owe money on it…"
              aria-label="Additional notes"
              className={`${INPUT} resize-none`}
            />
          </Section>
        </div>

        {error && (
          <div className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Submit */}
        <div
          className={`bg-brand-bg/95 backdrop-blur-sm pt-4 pb-6 -mx-4 px-4 mt-4 ${
            keyboardOpen ? 'static' : 'sticky bottom-0 border-t border-slate-200'
          }`}
        >
          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="w-full py-4 rounded-2xl bg-brand-secondary text-white font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
          >
            {submitting ? `Uploading… ${progress}%` : 'Submit for appraisal'}
          </button>

          {submitting && (
            <div className="h-1.5 bg-slate-200 rounded-full mt-3 overflow-hidden">
              <div
                className="h-full bg-brand-secondary rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {!canSubmit && !submitting && (
            <p className="text-center text-sm text-slate-500 mt-3">
              {requiredDone < totalRequired
                ? `${totalRequired - requiredDone} more photo${totalRequired - requiredDone === 1 ? '' : 's'} to go`
                : 'Fill in your vehicle details to continue'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Shared input styling. A soft slate fill reads cleanly inside the white cards
// and brightens to white on focus with the brand accent border.
const INPUT =
  'w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 ' +
  'placeholder:text-slate-400 focus:bg-white focus:border-brand-secondary focus:ring-2 ' +
  'focus:ring-brand-secondary/20 focus:outline-none transition-colors';

/** A white card grouping one section of the form. */
function Section({
  title,
  optional,
  aside,
  children,
}: {
  title: string;
  optional?: boolean;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {title}
          {optional && (
            <span className="ml-2 font-medium normal-case tracking-normal text-slate-300">
              Optional
            </span>
          )}
        </h2>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Small field label. Uppercased site-wide via the global <label> rule. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{children}</label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: 'numeric' | 'text';
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className={INPUT}
      />
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-2.5 rounded-xl font-medium text-sm transition-all border-2 ${
        active
          ? 'bg-brand-secondary text-white border-brand-secondary'
          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

function PhotoTile({
  slot,
  label,
  hint,
  file,
  preview,
  compressing,
  onPick,
}: {
  slot: string;
  label: string;
  hint?: string;
  file?: File;
  preview?: string;
  compressing: boolean;
  onPick: (f: File | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <label
      className={`relative block rounded-xl border-2 overflow-hidden cursor-pointer transition-all ${
        file
          ? 'border-brand-secondary'
          : 'border-dashed border-slate-200 bg-slate-50 hover:border-brand-secondary hover:bg-brand-secondary/5'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />

      {preview ? (
        <>
          <img src={preview} alt={label} className="w-full h-32 object-cover" />
          <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-brand-secondary text-white flex items-center justify-center shadow-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="px-3 py-2 bg-white">
            <span className="text-xs font-semibold text-brand-primary">{label}</span>
            <span className="block text-xs text-slate-400 normal-case">Tap to retake</span>
          </div>
        </>
      ) : (
        <div className="h-32 flex flex-col items-center justify-center px-3 text-center">
          {compressing ? (
            <span className="text-sm text-slate-400">Processing…</span>
          ) : (
            <>
              <svg
                className="w-6 h-6 text-slate-400 mb-1.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.75}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-xs font-semibold text-brand-primary leading-tight">{label}</span>
              {hint && (
                <span className="text-[11px] text-slate-400 leading-tight mt-0.5 normal-case">
                  {hint}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </label>
  );
}
