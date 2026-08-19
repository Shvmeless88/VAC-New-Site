import { useEffect, useRef, useState } from 'react';
import { auth, loginWithGoogle, logout, onAuthStateChanged } from '@/lib/firebase';
import type { User } from 'firebase/auth';
import { compressImage } from '../lib/imageCompress';

const PROVINCES = ['NL', 'NS', 'NB', 'PE'];
const ALLOWED_DOMAIN = 'drivevac.ca';

const isStaff = (u: User | null) =>
  Boolean(u?.email && u.emailVerified && u.email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`));

/**
 * One-step delivery photo publisher for staff.
 *
 * Gated behind a verified @drivevac.ca Google account (checked here for UX and
 * re-verified server-side on submit). Replaces the old "post in the Customer
 * Photo chat, then re-key into /admin" double-handling: each submission writes
 * straight to the `deliveries` collection the VAC Family page reads. Unlisted,
 * noindex, no nav/footer.
 */
export default function QuickAddDelivery() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signInError, setSignInError] = useState<string | null>(null);

  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastInitial, setLastInitial] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Add Delivery | VAC';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  const signIn = async () => {
    setSignInError(null);
    try {
      const result = await loginWithGoogle();
      const u = result?.user;
      if (u && !isStaff(u)) {
        // Signed in, but not with a company account — reject and sign back out.
        await logout();
        setSignInError(`That isn't a @${ALLOWED_DOMAIN} account. Use your VAC Google login.`);
      }
    } catch (err: any) {
      setSignInError(err?.message || 'Sign-in failed. Please try again.');
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(file, 1600, 0.82);
      setPhoto(compressed);
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return URL.createObjectURL(compressed);
      });
    } finally {
      setCompressing(false);
    }
  };

  const canSubmit =
    Boolean(photo) && firstName.trim() !== '' && vehicle.trim() !== '' && !submitting;

  const handleSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Your session expired. Please sign in again.');

      const form = new FormData();
      form.append('firstName', firstName.trim());
      form.append('lastInitial', lastInitial.trim());
      form.append('vehicle', vehicle.trim());
      form.append('city', city.trim());
      form.append('province', province);
      if (photo) form.append('photo', photo, photo.name);

      const res = await fetch('/api/delivery', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Something went wrong.');
      setDone(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err?.message || "Couldn't publish. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setPhoto(null);
    setPreview(null);
    setFirstName('');
    setLastInitial('');
    setVehicle('');
    setCity('');
    setProvince('');
    setDone(false);
    setError(null);
  };

  const INPUT =
    'w-full px-4 py-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 ' +
    'placeholder:text-slate-400 focus:bg-white focus:border-brand-secondary focus:ring-2 ' +
    'focus:ring-brand-secondary/20 focus:outline-none transition-colors';

  // --- Auth gate ---
  if (authLoading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  if (!isStaff(user)) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-5">
        <div className="w-full max-w-xs text-center">
          <img src="/favicon.svg" alt="VAC" className="h-10 w-10 mx-auto mb-6" />
          <h1 className="text-xl font-display font-black text-brand-primary mb-1">Add a delivery</h1>
          <p className="text-sm text-slate-500 mb-6">
            Staff only. Sign in with your <span className="font-semibold">@{ALLOWED_DOMAIN}</span>{' '}
            Google account.
          </p>
          <button
            type="button"
            onClick={signIn}
            className="w-full py-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2.5 shadow-sm active:scale-[0.99] transition-transform"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
            </svg>
            Sign in with Google
          </button>
          {signInError && <p className="text-sm text-amber-600 mt-3">{signInError}</p>}
        </div>
      </div>
    );
  }

  // --- Success ---
  if (done) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center px-5 text-center">
        <div className="max-w-sm">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-display font-black text-brand-primary mb-2">Published!</h1>
          <p className="text-slate-600 mb-6">It's live on the VAC Family page now.</p>
          <button
            type="button"
            onClick={reset}
            className="w-full py-3.5 rounded-xl bg-brand-secondary text-white font-bold"
          >
            Add another
          </button>
        </div>
      </div>
    );
  }

  // --- Form ---
  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="max-w-md mx-auto px-4 pt-10 pb-10">
        <header className="mb-6 px-1 flex items-start justify-between gap-3">
          <div>
            <img src="/favicon.svg" alt="VAC" className="h-9 w-9 mb-4" />
            <h1 className="text-2xl font-display font-black text-brand-primary tracking-tight">
              Add a delivery
            </h1>
            <p className="text-slate-500 text-sm mt-1">Posts straight to the VAC Family page.</p>
          </div>
          <button
            type="button"
            onClick={() => logout()}
            className="text-xs text-slate-400 hover:text-slate-600 mt-1 shrink-0"
            title={user?.email || ''}
          >
            Sign out
          </button>
        </header>

        <div className="space-y-4">
          <section className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Photo</h2>
            <label
              className={`relative block rounded-xl border-2 overflow-hidden cursor-pointer ${
                preview ? 'border-brand-secondary' : 'border-dashed border-slate-200 bg-slate-50'
              }`}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => pickPhoto(e.target.files?.[0])}
              />
              {preview ? (
                <img src={preview} alt="Delivery" className="w-full h-56 object-cover" />
              ) : (
                <div className="h-40 flex flex-col items-center justify-center text-center px-4">
                  {compressing ? (
                    <span className="text-sm text-slate-400">Processing…</span>
                  ) : (
                    <>
                      <svg className="w-7 h-7 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-sm font-semibold text-brand-primary">Take / choose photo</span>
                    </>
                  )}
                </div>
              )}
              {preview && (
                <div className="px-3 py-2 bg-white text-xs text-slate-400 normal-case">Tap to change</div>
              )}
            </label>
          </section>

          <section className="bg-white rounded-2xl border border-slate-100 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Customer</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  aria-label="First name"
                  className={INPUT}
                />
              </div>
              <input
                type="text"
                value={lastInitial}
                onChange={(e) => setLastInitial(e.target.value.toUpperCase())}
                placeholder="Last init."
                maxLength={2}
                aria-label="Last initial"
                className={`${INPUT} text-center`}
              />
            </div>
            <input
              type="text"
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              placeholder="Vehicle (e.g. 2024 Nissan Rogue)"
              aria-label="Vehicle"
              className={`${INPUT} mt-3`}
            />
            <div className="grid grid-cols-2 gap-3 mt-3">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                aria-label="City"
                className={INPUT}
              />
              <select
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                aria-label="Province"
                className={INPUT}
              >
                <option value="">Prov.</option>
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={handleSubmit}
            className="w-full py-4 rounded-2xl bg-brand-secondary text-white font-bold text-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Publishing…' : 'Publish to website'}
          </button>
        </div>
      </div>
    </div>
  );
}
