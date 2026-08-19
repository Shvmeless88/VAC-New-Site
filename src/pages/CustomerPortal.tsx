import { useEffect, useState, type FormEvent } from 'react';
import { auth } from '@/lib/firebase';
import {
  onAuthStateChanged,
  isSignInWithEmailLink,
  signInWithEmailLink,
  sendSignInLinkToEmail,
  signOut,
  type User,
} from 'firebase/auth';
import Logo from '@/components/layout/Logo';
import { Mail, LogOut, CheckCircle2, Clock, Loader2, ArrowRight } from 'lucide-react';

// Staff-facing lead statuses → friendly, customer-facing wording.
const STATUS_MAP: Record<string, { label: string; desc: string; cls: string; Icon: any }> = {
  new: { label: 'Application received', desc: 'We have your application — a financing specialist will review it and reach out shortly.', cls: 'bg-blue-50 text-blue-700', Icon: Clock },
  contacted: { label: 'We reached out', desc: 'A specialist has tried to contact you. Keep an eye on your phone and email.', cls: 'bg-blue-50 text-blue-700', Icon: Clock },
  in_review: { label: 'Under review', desc: 'Your application is being reviewed with our lending partners.', cls: 'bg-amber-50 text-amber-700', Icon: Clock },
  working: { label: 'Under review', desc: 'Your application is being reviewed with our lending partners.', cls: 'bg-amber-50 text-amber-700', Icon: Clock },
  approved: { label: 'Approved!', desc: 'Congratulations — you are approved. A specialist will finalize your vehicle and financing with you.', cls: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  sold: { label: 'Complete', desc: 'Your purchase is complete. Thank you for choosing Vehicle Approval Centre!', cls: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
};
const statusOf = (s: string) => STATUS_MAP[s] || { label: 'In progress', desc: 'Your application is in progress — a specialist will be in touch.', cls: 'bg-slate-100 text-slate-600', Icon: Clock };
const fmtDate = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' }) : ''; } catch { return ''; } };

type App = { id: string; createdAt: string | null; status: string; type: string; vehicleType: string | null; price: string | null; downPayment: string | null };

export default function CustomerPortal() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [apps, setApps] = useState<App[] | null>(null);

  // Finish email-link sign-in if we arrived from a magic link, then watch auth state.
  useEffect(() => {
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let e = window.localStorage.getItem('vac_portal_email') || '';
      if (!e) e = window.prompt('Please confirm your email to finish signing in') || '';
      if (e) {
        signInWithEmailLink(auth, e, window.location.href)
          .then(() => { window.localStorage.removeItem('vac_portal_email'); window.history.replaceState({}, '', '/account'); })
          .catch((er) => setErr(er?.message || 'That sign-in link is invalid or has expired.'));
      }
    }
    return onAuthStateChanged(auth, (u) => { setUser(u); setAuthLoading(false); });
  }, []);

  // Load the customer's applications once signed in.
  useEffect(() => {
    if (!user) { setApps(null); return; }
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/my-applications', { headers: { Authorization: `Bearer ${token}` } });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || 'Failed to load your applications.');
        setApps(j.applications || []);
      } catch (e: any) { setErr(e?.message || 'Failed to load your applications.'); }
    })();
  }, [user]);

  const sendLink = async (ev: FormEvent) => {
    ev.preventDefault();
    setSending(true); setErr(null);
    try {
      await sendSignInLinkToEmail(auth, email.trim(), { url: `${window.location.origin}/account`, handleCodeInApp: true });
      window.localStorage.setItem('vac_portal_email', email.trim());
      setLinkSent(true);
    } catch (e: any) { setErr(e?.message || 'Could not send the sign-in link. Please try again.'); }
    finally { setSending(false); }
  };

  if (authLoading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center"><Loader2 className="h-8 w-8 text-brand-accent animate-spin" /></div>;
  }

  // --- Signed OUT: email-link login ---
  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Logo className="h-8 w-auto" />
            <span className="text-xl font-black text-brand-primary tracking-tight">Vehicle Approval Centre</span>
          </div>
          <div className="bg-white rounded-[2.5rem] shadow-xl shadow-gray-200/50 border border-gray-100 p-8 md:p-10">
            {linkSent ? (
              <div className="text-center">
                <div className="bg-emerald-50 h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
                  <Mail className="h-8 w-8 text-emerald-600" />
                </div>
                <h1 className="text-2xl font-display font-bold text-brand-primary">Check your email</h1>
                <p className="text-gray-500 mt-2">We sent a secure sign-in link to <span className="font-bold text-brand-primary">{email}</span>. Open it on this device to view your application.</p>
                <button onClick={() => { setLinkSent(false); setEmail(''); }} className="mt-6 text-sm font-bold text-brand-accent hover:underline">Use a different email</button>
              </div>
            ) : (
              <>
                <div className="text-center mb-8">
                  <div className="bg-brand-accent/10 h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-5">
                    <Mail className="h-8 w-8 text-brand-accent" />
                  </div>
                  <h1 className="text-3xl font-display font-bold text-brand-primary tracking-tight">Your Application</h1>
                  <p className="text-gray-500 mt-1">Track your approval status and details.</p>
                </div>
                <p className="text-center text-sm text-gray-500 leading-relaxed mb-6">
                  Enter the email you applied with and we'll send you a secure sign-in link — no password needed.
                </p>
                <form onSubmit={sendLink} className="space-y-4">
                  <input
                    type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full h-12 px-4 rounded-xl border border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 outline-none"
                  />
                  <button type="submit" disabled={sending}
                    className="w-full h-14 rounded-2xl bg-brand-accent text-white font-bold text-lg hover:brightness-110 disabled:opacity-50 flex items-center justify-center gap-2">
                    {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <>Send sign-in link <ArrowRight className="h-5 w-5" /></>}
                  </button>
                </form>
              </>
            )}
            {err && <p className="mt-4 text-sm text-red-600 text-center">{err}</p>}
          </div>
        </div>
      </div>
    );
  }

  // --- Signed IN: application dashboard ---
  const firstName = (user.displayName || user.email || '').split(/[@ ]/)[0];
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-5 py-10 md:py-14">
        <div className="flex items-center justify-between mb-10">
          <div className="flex items-center gap-2">
            <Logo className="h-7 w-auto" />
            <span className="text-lg font-black text-brand-primary tracking-tight">Vehicle Approval Centre</span>
          </div>
          <button onClick={() => signOut(auth)} className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-500 hover:text-brand-primary">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>

        <h1 className="text-3xl md:text-4xl font-display font-bold text-brand-primary tracking-tight mb-1">
          Welcome back{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="text-gray-500 mb-8">Here's where your application stands.</p>

        {err && <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-red-700 mb-6">{err}</div>}

        {!apps ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
        ) : apps.length === 0 ? (
          <div className="rounded-3xl border border-gray-100 bg-white shadow-sm p-8 text-center">
            <p className="text-gray-500">We couldn't find an application under <span className="font-bold text-brand-primary">{user.email}</span>. If you applied with a different email, sign out and use that one.</p>
            <a href="/apply-now" className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand-accent hover:underline">Start an application <ArrowRight className="h-4 w-4" /></a>
          </div>
        ) : (
          <div className="space-y-5">
            {apps.map((a) => {
              const s = statusOf(a.status);
              return (
                <div key={a.id} className="rounded-3xl border border-gray-100 bg-white shadow-sm p-6 md:p-8">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Financing application</p>
                      <h2 className="text-xl font-bold text-brand-primary mt-0.5">{a.vehicleType || 'Vehicle financing'}</h2>
                      <p className="text-sm text-gray-400 mt-0.5">Submitted {fmtDate(a.createdAt)}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full ${s.cls}`}>
                      <s.Icon className="h-4 w-4" /> {s.label}
                    </span>
                  </div>
                  <p className="text-gray-600 mt-4 leading-relaxed">{s.desc}</p>
                </div>
              );
            })}
            <div className="rounded-3xl border border-dashed border-gray-200 bg-white/50 p-6 text-center">
              <p className="text-sm text-gray-400">📎 Document upload & your purchase paperwork (bill of sale, warranty) are coming here soon.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
