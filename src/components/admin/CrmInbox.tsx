import { useCallback, useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, Search, Inbox as InboxIcon, ArrowRight } from 'lucide-react';

type Lead = {
  id: string; firstName?: string; lastName?: string; title?: string;
  phone?: string; email?: string; city?: string; province?: string; postal?: string;
  creditSelfRating?: string; lookingFor?: string; budget?: string;
  employer?: string; jobTitle?: string; addTime?: string | null; owner?: string | null;
};
type Rep = { id: string; name: string; quoNumber?: string | null };

const nameOf = (l: Lead) => [l.firstName, l.lastName].filter(Boolean).join(' ') || l.title || '—';
const fmt = (iso?: string | null) => { try { return iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : ''; } catch { return iso || ''; } };
async function token() { return (await auth.currentUser?.getIdToken()) || ''; }

export default function CrmInbox() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [reps, setReps] = useState<Rep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [assigning, setAssigning] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  // Pull each inbox lead's owner from Pipedrive (round-robin) and merge duplicates
  // into their phone-keyed record. Useful during the parallel period.
  const syncFromPipedrive = async () => {
    if (!window.confirm('Sync the Inbox with Pipedrive?\n\nLeads already dispersed in Pipedrive move to that rep’s board, duplicates merge into one record, and archived test leads are removed.')) return;
    setSyncing(true); setSyncMsg(null);
    try {
      const res = await fetch('/api/crm/pipedrive-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ phase: 'reconcile-inbox', confirm: true }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) throw new Error(j.error || 'Sync failed.');
      setSyncMsg(`Done — ${j.assigned} assigned to reps, ${j.merged} duplicate${j.merged === 1 ? '' : 's'} merged, ${j.deletedJunk} removed, ${j.keptInbox} kept in the inbox.`);
      await load();
    } catch (e: any) { setSyncMsg(e.message || 'Sync failed.'); }
    setSyncing(false);
  };

  const load = useCallback(async () => {
    const res = await fetch('/api/crm/leads', { headers: { Authorization: `Bearer ${await token()}` } });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Failed to load leads.');
    setLeads((j.leads || []).filter((l: Lead) => !l.owner)); // unassigned only
    setReps(j.reps || []);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message || 'Failed to load.')); }, [load]);

  const assign = async (lead: Lead, uid: string, name: string) => {
    setAssigning(lead.id);
    setLeads((prev) => prev && prev.filter((l) => l.id !== lead.id)); // optimistic: leaves the inbox
    const res = await fetch('/api/crm/lead-update', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ id: lead.id, owner: uid, ownerName: name }),
    });
    if (!res.ok) { window.alert('Assign failed.'); await load(); }
    setAssigning(null);
  };

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return leads || [];
    return (leads || []).filter((l) =>
      [nameOf(l), l.phone, l.email, l.city, l.province, l.postal, l.employer, l.jobTitle, l.lookingFor, l.budget, l.creditSelfRating]
        .filter(Boolean).join(' ').toLowerCase().includes(s));
  }, [leads, q]);

  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700"><p className="font-bold">Couldn’t load the inbox</p><p className="text-sm mt-1">{error}</p></div>;
  if (!leads) return <div className="py-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;

  return (
    <div>
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-brand-primary leading-none tracking-tight flex items-center gap-2">
            <InboxIcon className="h-5 w-5 text-brand-accent" /> Inbox
            <span className="text-[13px] font-bold text-white bg-brand-accent rounded-full px-2 py-0.5">{leads.length}</span>
          </h1>
          <p className="text-[13px] text-gray-500 mt-1.5">New website leads waiting to be assigned. Reps don’t see these until you disperse them.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full lg:w-auto">
          <button onClick={syncFromPipedrive} disabled={syncing}
            className="h-10 shrink-0 rounded-xl bg-brand-accent text-white text-[13px] font-bold px-4 inline-flex items-center justify-center gap-2 hover:opacity-90 transition disabled:opacity-60">
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {syncing ? 'Syncing…' : 'Sync owners from Pipedrive'}
          </button>
          <div className="relative w-full lg:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email, city…"
              className="w-full h-10 rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-brand-primary" />
          </div>
        </div>
      </header>
      {syncMsg && <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] font-semibold text-emerald-800">{syncMsg}</div>}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500 font-medium">{q ? 'No leads match your search.' : 'Inbox is empty.'}</p>
          <p className="text-gray-400 text-sm mt-1">{q ? 'Try a different term.' : 'New leads land here as they come in from the website.'}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                <th className="px-4 py-3 font-bold">Name</th>
                <th className="px-4 py-3 font-bold">Contact</th>
                <th className="px-4 py-3 font-bold">Vehicle</th>
                <th className="px-4 py-3 font-bold">Credit</th>
                <th className="px-4 py-3 font-bold">Location</th>
                <th className="px-4 py-3 font-bold">Received</th>
                <th className="px-4 py-3 font-bold text-right">Assign to</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <tr key={l.id} className="border-b border-gray-50 last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-brand-primary whitespace-nowrap">{nameOf(l)}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{[l.phone, l.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{[l.lookingFor, l.budget].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{l.creditSelfRating || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{[l.city, l.province].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmt(l.addTime)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {assigning === l.id ? (
                      <Loader2 className="h-4 w-4 animate-spin inline text-gray-400" />
                    ) : (
                      <div className="inline-flex items-center gap-1.5">
                        <ArrowRight className="h-3.5 w-3.5 text-gray-300" />
                        <select defaultValue="" onChange={(e) => { const r = reps.find((x) => x.id === e.target.value); if (r) assign(l, r.id, r.name); }}
                          className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-[13px] font-semibold text-brand-primary cursor-pointer">
                          <option value="" disabled>Assign to…</option>
                          {reps.map((r) => <option key={r.id} value={r.id}>{r.name}{r.quoNumber ? '' : ' (no Quo)'}</option>)}
                        </select>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
