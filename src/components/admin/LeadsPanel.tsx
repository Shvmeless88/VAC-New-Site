import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth } from '@/lib/firebase';

// Full dvLeads record (served by GET /api/dv-leads, admin-gated).
type Lead = {
  id: string;
  submittedAt?: string;
  submittedAtMs: number;
  status?: string;   // dedupe status: new | duplicate
  outcome?: string;  // admin-set: new | accepted | sold | returned | bad
  applicant?: any;
  vehicle?: any;
  credit?: any;
  employment?: any;
  housing?: any;
  eligibility?: any;
  consent?: any;
  marketing?: any;
  assignment?: any;  // { dealerId, dealerName, dealerEmail, delivery, orderId, orderNumber }
};
type Dealer = { id: string; name: string; cap: number | null; active?: boolean };
type Order = { id: string; dealerId: string; dealerName: string; number: number; size: number; status: string; createdAt?: string; closedAt?: string };

const OUTCOMES = ['new', 'accepted', 'sold', 'returned', 'bad'] as const;
const OUTCOME_META: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-slate-100 text-slate-600' },
  accepted: { label: 'Accepted', cls: 'bg-blue-50 text-blue-600' },
  sold: { label: 'Sold', cls: 'bg-emerald-50 text-emerald-700' },
  returned: { label: 'Returned', cls: 'bg-amber-50 text-amber-700' },
  bad: { label: 'Bad lead', cls: 'bg-red-50 text-red-600' },
};
// Returned/bad leads don't count toward a dealer's fulfilled cap.
const countsAsFulfilled = (l: Lead) =>
  (l.assignment?.delivery === 'emailed') && !['returned', 'bad'].includes(l.outcome || 'new');

const monthKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const monthLabel = (key: string) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' }); };
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const nameOf = (l: Lead) => [l.applicant?.firstName, l.applicant?.lastName].filter(Boolean).join(' ') || '—';
// DOB is stored DD/MM/YYYY (funnel form) — render the month as a word so it can't be misread as American MM/DD.
const fmtDob = (s: any) => {
  if (typeof s !== 'string') return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return s;
  const dd = +m[1], mm = +m[2];
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return s;
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${dd} ${M[mm - 1]} ${m[3]}`;
};
const dealerOf = (l: Lead) => l.assignment?.dealerName || l.assignment?.dealerEmail || 'Unassigned';

function Stat({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-500' : 'text-brand-primary';
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className={`mt-1 text-3xl font-display font-bold ${color}`}>{value}</p>
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome?: string }) {
  const m = OUTCOME_META[outcome || 'new'] || OUTCOME_META.new;
  return <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
}

function DeliveryCell({ d }: { d?: string }) {
  if (d === 'emailed') return <span className="text-emerald-600 font-bold">✓ emailed</span>;
  if (d === 'failed') return <span className="text-red-500 font-bold">failed</span>;
  if (d === 'held') return <span className="text-amber-600 font-bold">held</span>;
  return <span className="text-gray-400">{d || '—'}</span>;
}

// --- Detail modal: the full application, like the dealer email ---
function LeadDetail({ lead, dealers, onClose, onOutcome, onReassign, saving }: { lead: Lead; dealers: Dealer[]; onClose: () => void; onOutcome: (o: string) => void; onReassign: (dealerId: string) => void; saving: boolean }) {
  const a = lead.applicant || {}; const addr = a.address || {};
  const v = lead.vehicle || {}; const e = lead.employment || {}; const h = lead.housing || {}; const el = lead.eligibility || {}; const c = lead.consent || {}; const mk = lead.marketing || {};
  const money = (x: any) => (x ? `$${x}` : '—');
  const Row = ({ l, val }: { l: string; val: any }) => (val === undefined || val === null || val === '' ? null : (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500 text-sm">{l}</span>
      <span className="text-brand-primary font-semibold text-sm text-right">{val}</span>
    </div>
  ));
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="mb-5">
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-1.5">{title}</h4>
      <div>{children}</div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:p-10" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl my-4" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-start justify-between p-6 border-b border-gray-100">
          <div>
            <h3 className="text-2xl font-display font-bold text-brand-primary">{nameOf(lead)}</h3>
            <p className="text-gray-400 text-xs mt-0.5">
              Submitted {fmtDate(lead.submittedAtMs)} · {dealerOf(lead)}
              {lead.assignment?.orderNumber ? ` · Order #${lead.assignment.orderNumber}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none px-2">×</button>
        </div>

        {/* Outcome editor */}
        <div className="px-6 py-4 bg-slate-50 border-b border-gray-100">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Lead status</p>
          <div className="flex flex-wrap gap-2">
            {OUTCOMES.map((o) => {
              const active = (lead.outcome || 'new') === o;
              const m = OUTCOME_META[o];
              return (
                <button key={o} disabled={saving} onClick={() => onOutcome(o)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-full border transition ${active ? `${m.cls} border-transparent ring-2 ring-brand-accent/40` : 'bg-white text-gray-500 border-gray-200 hover:border-brand-accent/50'}`}>
                  {m.label}
                </button>
              );
            })}
          </div>
          {/* Reassign — send this lead to a different dealer (re-emails them). */}
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Sent to</span>
            <select
              value={lead.assignment?.dealerId || ''}
              disabled={saving}
              onChange={(ev) => { const val = ev.target.value; if (val && val !== (lead.assignment?.dealerId || '')) onReassign(val); }}
              className="h-8 rounded-lg border border-gray-200 px-2 text-xs font-bold text-brand-primary bg-white outline-none focus:border-brand-accent">
              {!lead.assignment?.dealerId && <option value="">Unassigned</option>}
              {dealers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <span className="text-[11px] text-gray-400">— changing re-emails the new dealer</span>
          </div>
          {lead.assignment?.delivery === 'failed' && <p className="text-red-500 text-xs mt-2 font-medium">⚠ Email delivery to the dealer failed — resend manually.</p>}
          {lead.assignment?.delivery === 'held' && <p className="text-amber-600 text-xs mt-2 font-medium">⏸ Held — the dealer's order is full/paused. Starts sending when you open the next order.</p>}
        </div>

        <div className="p-6">
          <Section title="Contact">
            <Row l="Phone" val={a.phone} />
            <Row l="Email" val={a.email} />
            <Row l="Date of birth" val={fmtDob(a.dob)} />
            <Row l="Address" val={[addr.street, addr.suite, addr.city, addr.province, addr.postal].filter(Boolean).join(', ')} />
          </Section>
          <Section title="Vehicle">
            <Row l="Looking for" val={v.type} />
            <Row l="Budget" val={v.budgetBand} />
            <Row l="Trade-in" val={v.tradeIn} />
            <Row l="Down payment" val={money(v.downPayment)} />
          </Section>
          <Section title="Credit"><Row l="Self-rating" val={(lead.credit || {}).selfRating} /></Section>
          <Section title="Employment & income">
            <Row l="Status" val={e.status} />
            <Row l="Employer" val={e.employer} />
            <Row l="Job title" val={e.jobTitle} />
            <Row l="Income type" val={e.incomeType} />
            <Row l="Gross income" val={money(e.grossIncome)} />
            <Row l="Hours/week" val={e.hoursPerWeek} />
            <Row l="Time on job" val={e.timeOnJob && (e.timeOnJob.years || e.timeOnJob.months) ? `${e.timeOnJob.years || 0}y ${e.timeOnJob.months || 0}m` : ''} />
            <Row l="Income source" val={e.incomeSource} />
          </Section>
          <Section title="Housing">
            <Row l="Own/Rent" val={h.ownOrRent} />
            <Row l="Monthly payment" val={money(h.monthlyPayment)} />
            <Row l="Time at address" val={h.timeAtAddress && (h.timeAtAddress.years || h.timeAtAddress.months) ? `${h.timeAtAddress.years || 0}y ${h.timeAtAddress.months || 0}m` : ''} />
          </Section>
          <Section title="Eligibility">
            <Row l="Citizen/PR" val={el.citizenOrPR} />
            <Row l="Valid licence" val={el.validLicense} />
          </Section>
          <Section title="Marketing source">
            <Row l="Source" val={mk.utm_source} />
            <Row l="Medium" val={mk.utm_medium} />
            <Row l="Campaign" val={mk.utm_campaign} />
            <Row l="Content" val={mk.utm_content} />
            <Row l="Term" val={mk.utm_term} />
            <Row l="gclid" val={mk.gclid} />
            <Row l="fbclid" val={mk.fbclid} />
          </Section>
          <div className="mt-4 rounded-xl bg-slate-50 border border-gray-100 p-3 text-[11px] text-gray-500 leading-relaxed">
            ✓ Consent captured{c.timestamp ? ` on ${fmtDate(Date.parse(c.timestamp))}` : ''} — authorized contact + credit check (v{c.textVersion || '?'}, IP {c.ip || 'n/a'}).
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LeadsPanel() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [dealerFilter, setDealerFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [month, setMonth] = useState<string>('');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [selected, setSelected] = useState<Lead | null>(null);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sizeDraft, setSizeDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('Not signed in.');
    const res = await fetch('/api/dv-leads', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Failed to load (${res.status})`); }
    const data = await res.json();
    setLeads(data.leads || []);
    setDealers(data.dealers || []);
    setOrders(data.orders || []);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message || 'Failed to load leads.')); }, [load]);

  const months = useMemo(() => (leads ? Array.from(new Set(leads.map((l) => monthKey(l.submittedAtMs)))).sort().reverse() : []), [leads]);
  useEffect(() => { if (months.length && !month) setMonth(months[0]); }, [months, month]);

  const usingRange = Boolean(from || to);
  const scope = useMemo(() => {
    if (!leads) return [];
    if (usingRange) {
      const lo = from ? Date.parse(`${from}T00:00:00`) : -Infinity;
      const hi = to ? Date.parse(`${to}T23:59:59`) : Infinity;
      return leads.filter((l) => l.submittedAtMs >= lo && l.submittedAtMs <= hi);
    }
    return leads.filter((l) => monthKey(l.submittedAtMs) === month);
  }, [leads, usingRange, from, to, month]);

  const scopeLabel = usingRange ? `${from || '…'} → ${to || '…'}` : month ? monthLabel(month) : '';
  const delivered = scope.filter((l) => l.assignment?.delivery === 'emailed').length;
  const failed = scope.filter((l) => l.assignment?.delivery === 'failed').length;
  const heldInScope = scope.filter((l) => l.assignment?.delivery === 'held').length;

  const startOrder = async (dealerId: string, defaultSize: number) => {
    const raw = sizeDraft[dealerId];
    const size = Math.max(1, Math.floor(Number(raw || defaultSize) || defaultSize));
    if (!window.confirm(`Start a new order of ${size} leads for this dealer?\n\nAny held leads will be released and emailed (up to ${size}).`)) return;
    setStarting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/dv-orders/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dealerId, size }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Failed to start order.');
      await load();
      window.alert(`Order #${j.orderNumber} opened (${j.size} leads). ${j.released || 0} held lead(s) released${j.releaseFailed ? `, ${j.releaseFailed} failed to email` : ''}.`);
    } catch (e: any) { window.alert(e.message || 'Failed to start order.'); }
    finally { setStarting(false); }
  };

  const setOutcome = async (id: string, outcome: string) => {
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/dv-lead-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, outcome }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Failed to update'); }
      setLeads((ls) => (ls ? ls.map((l) => (l.id === id ? { ...l, outcome } : l)) : ls));
      setSelected((s) => (s && s.id === id ? { ...s, outcome } : s));
    } catch (e: any) { window.alert(e.message || 'Failed to update outcome.'); }
    finally { setSaving(false); }
  };

  // Turn a dealer on/off in the funnel rotation (persists to Firestore; overrides code default).
  const toggleDealer = async (dealerId: string, active: boolean) => {
    setDealers((ds) => ds.map((d) => (d.id === dealerId ? { ...d, active } : d))); // optimistic
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/dv-dealer-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dealerId, active }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Failed'); }
    } catch (e: any) {
      window.alert(e.message || 'Failed to update dealer.');
      setDealers((ds) => ds.map((d) => (d.id === dealerId ? { ...d, active: !active } : d))); // revert
    }
  };

  // Reassign a lead to a different dealer — re-emails the full application to them.
  const reassignLead = async (id: string, dealerId: string) => {
    const dealer = dealers.find((d) => d.id === dealerId);
    if (!window.confirm(`Reassign this lead to ${dealer?.name || 'this dealer'}?\n\nThey'll be emailed the full application.`)) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch('/api/dv-lead-reassign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, dealerId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Failed to reassign.');
      const apply = (l: Lead): Lead => ({ ...l, assignment: { ...(l.assignment || {}), dealerId, dealerName: dealer?.name, delivery: 'emailed' } });
      setSelected((s) => (s && s.id === id ? apply(s) : s));
      await load(); // refresh so the dealer's order-fulfilled count reflects the move
      window.alert(`Reassigned to ${j.dealerName || dealer?.name}.${j.emailed ? ' Email sent.' : ' (email may have failed — check logs)'}`);
    } catch (e: any) { window.alert(e.message || 'Failed to reassign.'); }
    finally { setSaving(false); }
  };

  const exportCsv = () => {
    const cols = ['Submitted', 'Name', 'Email', 'Phone', 'City', 'Province', 'Vehicle', 'Budget', 'Credit', 'Employment', 'Dealer', 'Order', 'Delivery', 'Outcome', 'Source'];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = visible.map((l) => [
      new Date(l.submittedAtMs).toISOString(), nameOf(l), l.applicant?.email, l.applicant?.phone,
      l.applicant?.address?.city, l.applicant?.address?.province, l.vehicle?.type, l.vehicle?.budgetBand,
      l.credit?.selfRating, l.employment?.status, dealerOf(l), l.assignment?.orderNumber ? `#${l.assignment.orderNumber}` : '',
      l.assignment?.delivery, OUTCOME_META[l.outcome || 'new']?.label, l.marketing?.utm_source || 'direct',
    ].map(esc).join(','));
    const blob = new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vac-leads-${usingRange ? `${from || 'start'}_to_${to || 'end'}` : month}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700"><p className="font-bold">Couldn’t load leads</p><p className="text-sm mt-1">{error}</p></div>;
  if (!leads) return <div className="py-20 text-center text-gray-400 font-medium">Loading leads…</div>;

  // The lead table can be narrowed to one dealer (stat tiles + order cards stay full).
  const visible = dealerFilter === 'all' ? scope : scope.filter((l) => (l.assignment?.dealerId || '') === dealerFilter);

  return (
    <div className="space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold text-brand-primary mb-2">Leads</h1>
          <p className="text-gray-500">Pre-approval applications from the funnel, and where each one was sent.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={usingRange ? '' : month} onChange={(e) => { setMonth(e.target.value); setFrom(''); setTo(''); }}
            className="h-10 rounded-xl border border-gray-200 px-3 text-sm font-bold text-brand-primary bg-white outline-none focus:border-brand-accent">
            {usingRange && <option value="">Custom range</option>}
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <span className="text-gray-300 text-xs">or</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-xl border border-gray-200 px-2 text-sm text-brand-primary outline-none focus:border-brand-accent" />
          <span className="text-gray-400 text-xs">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-xl border border-gray-200 px-2 text-sm text-brand-primary outline-none focus:border-brand-accent" />
          {usingRange && <button onClick={() => { setFrom(''); setTo(''); }} className="h-10 px-3 text-xs font-bold text-gray-500 hover:text-brand-primary">Clear</button>}
          <select value={dealerFilter} onChange={(e) => setDealerFilter(e.target.value)}
            className="h-10 rounded-xl border border-gray-200 px-3 text-sm font-bold text-brand-primary bg-white outline-none focus:border-brand-accent">
            <option value="all">All dealers</option>
            {dealers.map((dl) => <option key={dl.id} value={dl.id}>{dl.name}</option>)}
          </select>
          <button onClick={exportCsv} disabled={visible.length === 0} className="h-10 rounded-xl bg-brand-primary px-4 text-sm font-bold text-white disabled:opacity-40 hover:brightness-110">Export CSV</button>
        </div>
      </header>

      {/* Active orders — cumulative per dealer (independent of the date filter) */}
      <div className="grid md:grid-cols-2 gap-4">
        {dealers.map((dl) => {
          const dealerOrders = orders.filter((o) => o.dealerId === dl.id).sort((a, b) => a.number - b.number);
          const active = dealerOrders.find((o) => o.status === 'active') || null;
          const fulfilled = active ? leads.filter((l) => l.assignment?.orderId === active.id && countsAsFulfilled(l)).length : 0;
          const heldForDealer = leads.filter((l) => l.assignment?.dealerId === dl.id && l.assignment?.delivery === 'held').length;
          const nextNum = dealerOrders.length + 1;
          const lastSize = active?.size ?? dealerOrders[dealerOrders.length - 1]?.size ?? dl.cap ?? 150;
          const pct = active?.size ? Math.min(100, Math.round((fulfilled / active.size) * 100)) : 0;
          const full = active ? fulfilled >= active.size : false;
          return (
            <div key={dl.id} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-brand-primary truncate">{dl.name}</span>
                  <button
                    onClick={() => toggleDealer(dl.id, !(dl.active ?? true))}
                    title={dl.active ? 'Receiving funnel leads — click to pause' : 'Not receiving leads — click to resume'}
                    className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full border transition ${dl.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'}`}>
                    {dl.active ? '● In rotation' : '○ Off'}
                  </button>
                </div>
                {active ? <span className="shrink-0 text-xs font-bold text-gray-400 uppercase tracking-widest">Order #{active.number}</span>
                  : <span className="shrink-0 text-xs font-bold text-amber-600 uppercase tracking-widest">Paused</span>}
              </div>

              {active ? (
                <>
                  <div className="flex items-end gap-2">
                    <span className={`text-3xl font-display font-bold ${full ? 'text-emerald-600' : 'text-brand-primary'}`}>{fulfilled}</span>
                    <span className="text-gray-400 font-bold mb-1">/ {active.size} fulfilled</span>
                  </div>
                  <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${full ? 'bg-emerald-500' : 'bg-brand-accent'}`} style={{ width: `${pct}%` }} />
                  </div>
                  {full && <p className="text-emerald-600 text-xs font-bold mt-2">✓ Order complete — start the next one when he’s ready.</p>}
                </>
              ) : (
                <p className="text-sm text-gray-500 mt-1">
                  {dealerOrders.length === 0 ? 'No orders yet — start Order #1 to begin sending.' : 'No active order — new leads are being held.'}
                </p>
              )}

              {heldForDealer > 0 && (
                <p className="text-amber-600 text-xs font-medium mt-2">⏸ {heldForDealer} lead{heldForDealer === 1 ? '' : 's'} held — will be released into the next order.</p>
              )}

              <div className="flex items-center gap-2 mt-4">
                <input
                  type="number" min={1} value={sizeDraft[dl.id] ?? String(lastSize)}
                  onChange={(e) => setSizeDraft((s) => ({ ...s, [dl.id]: e.target.value }))}
                  className="h-9 w-20 rounded-lg border border-gray-200 px-2 text-sm text-brand-primary outline-none focus:border-brand-accent"
                />
                <button
                  onClick={() => startOrder(dl.id, lastSize)} disabled={starting}
                  className="h-9 rounded-lg bg-brand-primary px-3 text-xs font-bold text-white disabled:opacity-40 hover:brightness-110">
                  {active ? `Start Order #${nextNum}` : dealerOrders.length === 0 ? 'Start Order #1' : `Start Order #${nextNum}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Date-filtered snapshot */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={scopeLabel || 'Leads'} value={scope.length} />
        <Stat label="Delivered" value={delivered} tone="good" />
        <Stat label="Held (paused)" value={heldInScope} tone={heldInScope ? 'bad' : 'default'} />
        <Stat label="Delivery failed" value={failed} tone={failed ? 'bad' : 'default'} />
      </div>

      {/* Lead list — click a row for the full application */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                <th className="px-5 py-3 font-bold">Submitted</th>
                <th className="px-5 py-3 font-bold">Name</th>
                <th className="px-5 py-3 font-bold">Location</th>
                <th className="px-5 py-3 font-bold">Vehicle</th>
                <th className="px-5 py-3 font-bold">Dealer</th>
                <th className="px-5 py-3 font-bold">Order</th>
                <th className="px-5 py-3 font-bold">Delivery</th>
                <th className="px-5 py-3 font-bold">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-gray-400">No leads for {scopeLabel || 'this range'}.</td></tr>
              ) : visible.map((l) => (
                <tr key={l.id} onClick={() => setSelected(l)} className="border-b border-gray-50 hover:bg-slate-50/70 cursor-pointer">
                  <td className="px-5 py-3 whitespace-nowrap text-gray-500">{fmtDate(l.submittedAtMs)}</td>
                  <td className="px-5 py-3 font-bold text-brand-primary whitespace-nowrap">
                    {nameOf(l)}
                    {l.status === 'duplicate' && <span className="ml-2 text-[10px] font-bold uppercase text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">dup</span>}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">{[l.applicant?.address?.city, l.applicant?.address?.province].filter(Boolean).join(', ')}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">{l.vehicle?.type}{l.vehicle?.budgetBand ? ` · ${l.vehicle.budgetBand}` : ''}</td>
                  <td className="px-5 py-3 whitespace-nowrap font-semibold text-brand-primary">{dealerOf(l)}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-gray-500">{l.assignment?.orderNumber ? `#${l.assignment.orderNumber}` : '—'}</td>
                  <td className="px-5 py-3 whitespace-nowrap"><DeliveryCell d={l.assignment?.delivery} /></td>
                  <td className="px-5 py-3 whitespace-nowrap"><OutcomeBadge outcome={l.outcome} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <LeadDetail lead={selected} dealers={dealers} saving={saving} onClose={() => setSelected(null)} onOutcome={(o) => setOutcome(selected.id, o)} onReassign={(dealerId) => reassignLead(selected.id, dealerId)} />}
    </div>
  );
}
