import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, User, Car, StickyNote, X } from 'lucide-react';

type Note = { text: string; by?: string; byName?: string; at?: string };
type Deal = {
  id: string;
  name: string;
  email: string;
  phone: string;
  vehicle: string;
  price: string | null;
  downPayment: string | null;
  annualIncome: string | null;
  monthlyHousing: string | null;
  address: string | null;
  dob: string | null;
  type: string;
  stage: string;
  repName: string;
  createdAt: string | null;
  notes: Note[];
  intakeNote?: string | null;
};
type Stage = { key: string; label: string };

const fmtDate = (iso: string | null) => { try { return iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : ''; } catch { return ''; } };
const fmtDateTime = (iso?: string) => { try { return iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch { return iso || ''; } };
const money = (x: any) => (x ? `$${Number(String(x).replace(/[^0-9.]/g, '')).toLocaleString('en-CA')}` : '—');

async function token() { return (await auth.currentUser?.getIdToken()) || ''; }

// --- Detail drawer: full application + notes thread ---
function DealDetail({ deal, stages, onClose, onMove, onNote, busy }: {
  deal: Deal; stages: Stage[]; onClose: () => void; onMove: (stage: string) => void; onNote: (text: string) => Promise<void>; busy: boolean;
}) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    await onNote(draft.trim());
    setDraft('');
    setSaving(false);
  };
  const Row = ({ l, v }: { l: string; v: any }) => (v ? (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500 text-sm">{l}</span><span className="text-brand-primary font-semibold text-sm text-right">{v}</span>
    </div>
  ) : null);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-6 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="text-2xl font-display font-bold text-brand-primary">{deal.name}</h3>
            <p className="text-gray-400 text-xs mt-0.5">{deal.repName} · {fmtDate(deal.createdAt)}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-6 py-4 bg-slate-50 border-b border-gray-100">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Stage</p>
          <select value={deal.stage} disabled={busy} onChange={(e) => onMove(e.target.value)}
            className="h-10 w-full rounded-xl border border-gray-200 px-3 text-sm font-bold text-brand-primary bg-white outline-none focus:border-brand-accent">
            {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <div className="p-6">
          <Row l="Phone" v={deal.phone} />
          <Row l="Email" v={deal.email} />
          <Row l="Vehicle" v={deal.vehicle} />
          <Row l="Price" v={deal.price ? money(deal.price) : null} />
          <Row l="Down payment" v={deal.downPayment ? money(deal.downPayment) : null} />
          <Row l="Annual income" v={deal.annualIncome ? money(deal.annualIncome) : null} />
          <Row l="Monthly housing" v={deal.monthlyHousing ? money(deal.monthlyHousing) : null} />
          <Row l="Address" v={deal.address} />
          <Row l="Date of birth" v={deal.dob} />

          {deal.intakeNote && (
            <div className="mt-6">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">From application</h4>
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                <p className="text-sm text-brand-primary whitespace-pre-wrap">{deal.intakeNote}</p>
              </div>
            </div>
          )}

          <h4 className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mt-6 mb-3">Notes</h4>
          <form onSubmit={submit} className="mb-4">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} placeholder="Add a note…"
              className="w-full rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-brand-accent resize-none" />
            <button type="submit" disabled={saving || !draft.trim()}
              className="mt-2 h-9 rounded-lg bg-brand-accent px-4 text-xs font-bold text-white disabled:opacity-40 hover:brightness-110">
              {saving ? 'Saving…' : 'Add note'}
            </button>
          </form>
          <div className="space-y-3">
            {deal.notes.length === 0 ? (
              <p className="text-gray-400 text-sm">No notes yet.</p>
            ) : [...deal.notes].reverse().map((n, i) => (
              <div key={i} className="rounded-xl bg-slate-50 border border-gray-100 p-3">
                <p className="text-sm text-brand-primary whitespace-pre-wrap">{n.text}</p>
                <p className="text-[11px] text-gray-400 mt-1.5">{n.byName || 'Staff'} · {fmtDateTime(n.at)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DealsBoard() {
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Deal | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/deals', { headers: { Authorization: `Bearer ${await token()}` } });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Failed to load deals.');
    setDeals(j.deals || []);
    setStages(j.stages || []);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message || 'Failed to load deals.')); }, [load]);

  const byStage = useMemo(() => {
    const m: Record<string, Deal[]> = {};
    stages.forEach((s) => (m[s.key] = []));
    (deals || []).forEach((d) => { (m[d.stage] = m[d.stage] || []).push(d); });
    return m;
  }, [deals, stages]);

  const moveDeal = async (id: string, stage: string) => {
    setDeals((ds) => (ds ? ds.map((d) => (d.id === id ? { ...d, stage } : d)) : ds));
    setSelected((s) => (s && s.id === id ? { ...s, stage } : s));
    setBusy(true);
    try {
      const res = await fetch('/api/deal-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ id, stage }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Move failed'); }
    } catch (e: any) { window.alert(e.message || 'Move failed'); await load(); }
    finally { setBusy(false); }
  };

  const addNote = async (id: string, text: string) => {
    try {
      const res = await fetch('/api/deal-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ id, note: text }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to add note');
      const note = j.note;
      setDeals((ds) => (ds ? ds.map((d) => (d.id === id ? { ...d, notes: [...d.notes, note] } : d)) : ds));
      setSelected((s) => (s && s.id === id ? { ...s, notes: [...s.notes, note] } : s));
    } catch (e: any) { window.alert(e.message || 'Failed to add note'); }
  };

  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700"><p className="font-bold">Couldn’t load deals</p><p className="text-sm mt-1">{error}</p></div>;
  if (!deals) return <div className="py-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;

  return (
    <div>
      <header className="mb-8">
        <h1 className="text-4xl font-display font-bold text-brand-primary mb-2">Deals</h1>
        <p className="text-gray-500">Your dealership pipeline — drag a card to move a stage, click it to add notes.</p>
      </header>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((s) => {
          const col = byStage[s.key] || [];
          return (
            <div
              key={s.key}
              onDragOver={(e) => { e.preventDefault(); setDragOver(s.key); }}
              onDragLeave={() => setDragOver((d) => (d === s.key ? null : d))}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); setDragOver(null); if (id) moveDeal(id, s.key); }}
              className={`flex-1 min-w-[172px] rounded-2xl p-3 transition-colors ${dragOver === s.key ? 'bg-brand-accent/10' : 'bg-slate-100/70'}`}
            >
              <div className="flex items-center justify-between px-2 py-2 mb-1">
                <span className="text-sm font-bold text-brand-primary">{s.label}</span>
                <span className="text-xs font-bold text-gray-400 bg-white rounded-full px-2 py-0.5">{col.length}</span>
              </div>
              <div className="space-y-2 min-h-[40px]">
                {col.map((d) => (
                  <div
                    key={d.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', d.id)}
                    onClick={() => setSelected(d)}
                    className="rounded-xl bg-white border border-gray-100 shadow-sm p-3 cursor-pointer hover:border-brand-accent/50 hover:shadow-md transition-all"
                  >
                    <p className="font-bold text-brand-primary text-sm">{d.name}</p>
                    {d.vehicle && <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1"><Car className="h-3 w-3" />{d.vehicle}</p>}
                    <div className="flex items-center justify-between mt-2 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1"><User className="h-3 w-3" />{d.repName}</span>
                      {d.notes.length > 0 && <span className="flex items-center gap-1"><StickyNote className="h-3 w-3" />{d.notes.length}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <DealDetail
          deal={selected}
          stages={stages}
          busy={busy}
          onClose={() => setSelected(null)}
          onMove={(stage) => moveDeal(selected.id, stage)}
          onNote={(text) => addNote(selected.id, text)}
        />
      )}
    </div>
  );
}
