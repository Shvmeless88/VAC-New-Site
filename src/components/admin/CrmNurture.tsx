import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, Moon, RefreshCw, AlarmClock, Search } from 'lucide-react';

type Row = {
  id: string; name: string; phone?: string | null; email?: string | null;
  lookingFor?: string | null; budget?: string | null; city?: string | null; province?: string | null;
  lostReason?: string | null; lostNote?: string | null; lostAt?: string | null; lostByName?: string | null;
  nurtureAt?: string | null; nurtureStatus?: 'sleeping' | 'dead' | 'woken' | string;
};

async function token() { return (await auth.currentUser?.getIdToken()) || ''; }
const fmt = (iso?: string | null) => { try { return iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'; } catch { return iso || '—'; } };
const daysUntil = (iso?: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null);

export default function CrmNurture() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'sleeping' | 'dead' | 'all'>('sleeping');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/crm/nurture', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to load.');
      setRows(j.rows || []); setError(null);
    } catch (e: any) { setError(e.message || 'Failed to load.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = async (id: string, body: any) => {
    setBusy(id);
    try {
      const res = await fetch('/api/crm/nurture', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ leadId: id, ...body }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { window.alert(j.error || 'Failed.'); return; }
      await load();
    } finally { setBusy(null); }
  };

  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700"><p className="font-bold">Couldn't load Nurture</p><p className="text-sm mt-1">{error}</p></div>;
  if (!rows) return <div className="py-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;

  const s = q.trim().toLowerCase();
  const visible = rows
    .filter((r) => filter === 'all' ? true : filter === 'sleeping' ? r.nurtureStatus === 'sleeping' : r.nurtureStatus === 'dead')
    .filter((r) => !s || [r.name, r.phone, r.email, r.city, r.lostReason, r.lostByName].filter(Boolean).join(' ').toLowerCase().includes(s));
  const sleeping = rows.filter((r) => r.nurtureStatus === 'sleeping').length;
  const dueSoon = rows.filter((r) => r.nurtureStatus === 'sleeping' && (daysUntil(r.nurtureAt) ?? 99) <= 7).length;

  return (
    <div>
      <header className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="mr-auto">
          <h1 className="text-2xl font-display font-bold text-brand-primary leading-none tracking-tight flex items-center gap-2"><Moon className="h-5 w-5 text-amber-500" />Nurture</h1>
          <p className="text-[13px] text-gray-500 mt-1.5">Lost leads asleep until their wake-up date, then back to the Free-to-Call pool. Managers only.</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-accent/70" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full h-10 rounded-full border border-gray-200 bg-white pl-10 pr-4 text-sm outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20" />
        </div>
        <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[12px] font-bold">
          {([['sleeping', `Sleeping (${sleeping})`], ['dead', 'No follow-up'], ['all', 'All lost']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)} className={`px-3.5 py-1.5 rounded-full transition ${filter === k ? 'bg-brand-accent text-white shadow-sm' : 'text-gray-500 hover:text-brand-primary'}`}>{label}</button>
          ))}
        </div>
        <button onClick={load} title="Refresh" className="h-9 w-9 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-400 hover:text-brand-accent"><RefreshCw className="h-4 w-4" /></button>
      </header>

      {dueSoon > 0 && filter === 'sleeping' && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900 flex items-center gap-2">
          <AlarmClock className="h-4 w-4 text-amber-600" /><b>{dueSoon}</b> lead{dueSoon === 1 ? '' : 's'} wake{dueSoon === 1 ? 's' : ''} up within 7 days — good time to plan a re-marketing push.
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
              <th className="px-4 py-3 font-bold">Name</th>
              <th className="px-4 py-3 font-bold">Vehicle</th>
              <th className="px-4 py-3 font-bold">Phone</th>
              <th className="px-4 py-3 font-bold">Lost reason</th>
              <th className="px-4 py-3 font-bold">Lost by</th>
              <th className="px-4 py-3 font-bold">Lost on</th>
              <th className="px-4 py-3 font-bold">Wakes up</th>
              <th className="px-4 py-3 font-bold"></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Nothing here.</td></tr>}
            {visible.map((r) => {
              const du = daysUntil(r.nurtureAt);
              return (
                <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-amber-50/30">
                  <td className="px-4 py-3 font-bold text-brand-primary whitespace-nowrap">{r.name}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[r.lookingFor, r.budget].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.phone || '—'}</td>
                  <td className="px-4 py-3 max-w-[280px]">
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded-md bg-rose-50 text-rose-600">{r.lostReason || '—'}</span>
                    {r.lostNote && <p className="text-[12px] text-gray-500 mt-1 leading-snug line-clamp-2" title={r.lostNote}>{r.lostNote}</p>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.lostByName || '—'}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-500">{fmt(r.lostAt)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.nurtureStatus === 'dead' ? <span className="text-gray-400">No follow-up</span> : (
                      <div className="flex items-center gap-2">
                        <input type="date" defaultValue={(r.nurtureAt || '').slice(0, 10)} min={new Date().toISOString().slice(0, 10)}
                          onBlur={(e) => { const v = e.target.value; if (v && v !== (r.nurtureAt || '').slice(0, 10)) update(r.id, { nurtureAt: new Date(v + 'T14:00:00').toISOString() }); }}
                          className="h-8 rounded-lg border border-gray-200 px-2 text-[12px] outline-none focus:border-brand-accent" />
                        {du != null && <span className={`text-[11px] font-semibold ${du <= 7 ? 'text-amber-700' : 'text-gray-400'}`}>{du <= 0 ? 'now' : `in ${du}d`}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <button disabled={busy === r.id} onClick={() => update(r.id, { wakeNow: true })} title="Send to the Free-to-Call pool now (within ~5 min)"
                        className="h-8 px-3 rounded-lg bg-amber-500 text-white text-[12px] font-bold hover:bg-amber-600 disabled:opacity-40">Wake now</button>
                      {r.nurtureStatus === 'dead' ? (
                        <button disabled={busy === r.id} onClick={() => update(r.id, { nurtureAt: new Date(Date.now() + 90 * 86_400_000).toISOString() })}
                          className="h-8 px-3 rounded-lg border border-gray-200 text-gray-600 text-[12px] font-bold hover:border-brand-accent">Revive (90d)</button>
                      ) : (
                        <button disabled={busy === r.id} onClick={() => { if (window.confirm(`Stop following up with ${r.name}?`)) update(r.id, { nurtureAt: null }); }}
                          className="h-8 px-2.5 rounded-lg text-gray-400 text-[12px] font-bold hover:text-red-500">Drop</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
