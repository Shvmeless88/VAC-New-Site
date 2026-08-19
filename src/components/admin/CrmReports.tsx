import { useCallback, useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, BarChart3, Phone, MessageSquare, FileText, AlertTriangle, Trophy, Clock, RefreshCw } from 'lucide-react';

type Row = {
  rep: { id: string; name: string; active: boolean };
  assigned: number; calls: number; texts: number; notes: number; touches: number; leadsTouched: number; inboundReplies: number;
  toDealertrack: number; approved: number; signed: number; lost: number; released: number; releasedNoEffort: number; bounced: number;
  activeLeads: number; untouchedLeads: number; medianFirstContactMins: number | null; touchesPerLead: number | null;
};

async function token() { return (await auth.currentUser?.getIdToken()) || ''; }

const fmtMins = (m: number | null) => {
  if (m == null) return '—';
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60 * 10) / 10}h`;
  return `${Math.round(m / 60 / 24 * 10) / 10}d`;
};

export default function CrmReports({ role }: { role?: string }) {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ rows: Row[]; totals: { leads: number; pool: number }; since: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isRep = role === 'sales_rep';

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/crm/reports?days=${days}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to load report.');
      setData(j);
    } catch (e: any) { setError(e.message || 'Failed to load.'); }
    finally { setLoading(false); }
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const rows = data?.rows || [];
  const sum = (k: keyof Row) => rows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const maxTouches = Math.max(1, ...rows.map((r) => r.touches));

  return (
    <div>
      <header className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="mr-auto">
          <h1 className="text-2xl font-display font-bold text-brand-primary leading-none tracking-tight flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-brand-accent" /> Reports
          </h1>
          <p className="text-[13px] text-gray-500 mt-1.5">{isRep ? 'Your effort and results.' : 'Who’s making the attempts — and who isn’t.'}</p>
        </div>
        <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[12px] font-bold">
          {[7, 14, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3.5 py-1.5 rounded-full transition ${days === d ? 'bg-brand-accent text-white shadow-sm' : 'text-gray-500 hover:text-brand-primary'}`}>{d}d</button>
          ))}
        </div>
        <button onClick={load} title="Refresh" className="h-9 w-9 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-400 hover:text-brand-accent transition">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {error && <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-red-700 text-sm mb-4">{error}</div>}
      {!data && !error && <div className="py-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}

      {data && (
        <>
          {/* Team totals */}
          {!isRep && (
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-5">
              {[
                { label: 'Leads assigned', v: sum('assigned'), Icon: FileText, c: 'text-brand-accent' },
                { label: 'Calls made', v: sum('calls'), Icon: Phone, c: 'text-blue-500' },
                { label: 'Texts sent', v: sum('texts'), Icon: MessageSquare, c: 'text-brand-accent' },
                { label: 'Signed', v: sum('signed'), Icon: Trophy, c: 'text-emerald-500' },
                { label: 'Hot-lead bounces', v: sum('bounced'), Icon: AlertTriangle, c: 'text-rose-500' },
                { label: 'Released to pool', v: sum('released'), Icon: RefreshCw, c: 'text-amber-500' },
                { label: 'Released, zero effort', v: sum('releasedNoEffort'), Icon: AlertTriangle, c: 'text-rose-500' },
              ].map((t) => (
                <div key={t.label} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">{t.label}</span>
                    <t.Icon className={`h-4 w-4 ${t.c}`} />
                  </div>
                  <p className="text-2xl font-display font-bold text-brand-primary mt-1.5">{t.v}</p>
                </div>
              ))}
            </div>
          )}

          {/* Per-rep table */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-3 font-bold">Rep</th>
                  <th className="px-4 py-3 font-bold">Effort</th>
                  <th className="px-3 py-3 font-bold text-right">Assigned</th>
                  <th className="px-3 py-3 font-bold text-right" title="Outbound calls (Quo)">Calls</th>
                  <th className="px-3 py-3 font-bold text-right">Texts</th>
                  <th className="px-3 py-3 font-bold text-right">Notes</th>
                  <th className="px-3 py-3 font-bold text-right" title="Attempts (calls + texts + notes) ÷ leads assigned">Attempts / lead</th>
                  <th className="px-3 py-3 font-bold text-right" title="Median time from assignment to first call/text">1st contact</th>
                  <th className="px-3 py-3 font-bold text-right" title="Customer messages RECEIVED on leads they own — inbound volume, not something the rep did">Cust. texts in</th>
                  <th className="px-3 py-3 font-bold text-right">Dealertrack</th>
                  <th className="px-3 py-3 font-bold text-right">Signed</th>
                  <th className="px-3 py-3 font-bold text-right">Lost</th>
                  <th className="px-3 py-3 font-bold text-right" title="Fresh leads taken away after sitting 30 min untouched">Bounced</th>
                  <th className="px-3 py-3 font-bold text-right" title="Auto-released to Free-to-Call after 3 business days">Released</th>
                  <th className="px-3 py-3 font-bold text-right" title="Leads they hold right now that they've never touched">Untouched now</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={15} className="px-4 py-8 text-center text-gray-400">No activity in this window.</td></tr>}
                {rows.map((r) => {
                  const noEffort = r.releasedNoEffort > 0;
                  const idle = r.activeLeads > 0 && r.touches === 0;
                  return (
                    <tr key={r.rep.id} className={`border-b border-gray-50 last:border-0 ${idle ? 'bg-rose-50/40' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${r.rep.active ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                          <span className="font-bold text-brand-primary">{r.rep.name}</span>
                          {idle && <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-rose-100 text-rose-600">No attempts</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 w-44">
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-brand-accent to-brand-primary" style={{ width: `${Math.round((r.touches / maxTouches) * 100)}%` }} />
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">{r.touches} touches · {r.leadsTouched} leads</p>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-brand-primary">{r.assigned}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{r.calls}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{r.texts}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{r.notes}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{r.touchesPerLead ?? '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-700"><span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-gray-300" />{fmtMins(r.medianFirstContactMins)}</span></td>
                      <td className="px-3 py-3 text-right text-gray-700">{r.inboundReplies}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{r.toDealertrack}</td>
                      <td className="px-3 py-3 text-right font-bold text-emerald-600">{r.signed}</td>
                      <td className="px-3 py-3 text-right text-gray-500">{r.lost}</td>
                      <td className="px-3 py-3 text-right"><span className={r.bounced > 0 ? 'text-rose-600 font-bold' : 'text-gray-400'}>{r.bounced}</span></td>
                      <td className="px-3 py-3 text-right">
                        <span className={noEffort ? 'text-rose-600 font-bold' : 'text-amber-600'}>{r.released}</span>
                        {noEffort && <span className="text-[10px] text-rose-500 ml-1">({r.releasedNoEffort} w/ 0 effort)</span>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={r.untouchedLeads > 0 ? 'text-rose-600 font-bold' : 'text-gray-400'}>{r.untouchedLeads}</span>
                        <span className="text-[10px] text-gray-400"> / {r.activeLeads}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            Window: last {data && Math.round((Date.now() - new Date(data.since).getTime()) / 86_400_000)} days · Calls/texts come from Quo + the CRM · “Cust. texts in” = messages customers sent on leads the rep owns (context, not credit) · “Untouched now” is a live snapshot of leads a rep holds with zero activity from them · Shared pool accounts aren’t listed.
            {!isRep && <> · Pool right now: <b>{data.totals.pool}</b> unassigned of {data.totals.leads} leads.</>}
          </p>
        </>
      )}
    </div>
  );
}
