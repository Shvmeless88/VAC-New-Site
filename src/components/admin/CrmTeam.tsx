import { useCallback, useEffect, useState, type FC } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, UserPlus, Circle, Trash2, RotateCcw, Users, Pencil, Check, X } from 'lucide-react';

type Rep = {
  id: string; name: string; quoNumber?: string | null; email?: string | null; title?: string | null;
  active?: boolean; archived?: boolean; uid?: string | null; pipedriveOwnerId?: string | null;
};

async function token() { return (await auth.currentUser?.getIdToken()) || ''; }

// Job titles — shown in the email signature. Consistent wording across the team.
const JOB_TITLES = ['Founder', 'Admin', 'Finance Manager', 'Front/Back', 'Sales', 'Logistics'];

export default function CrmTeam() {
  const [reps, setReps] = useState<Rep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [quo, setQuo] = useState('');
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/crm/reps', { headers: { Authorization: `Bearer ${await token()}` } });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Failed to load team.');
    setReps(j.reps || []);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message || 'Failed to load.')); }, [load]);

  const addRep = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/crm/rep-save', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || null, quoNumber: quo.trim() || null, title: title.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to add rep.');
      setName(''); setEmail(''); setQuo(''); setTitle('');
      await load();
      if (j.invited) window.alert(`Invite sent to ${email.trim()}. They'll set up their account when they sign in.`);
    } catch (e: any) { window.alert(e.message || 'Failed to add rep.'); }
    finally { setSaving(false); }
  };

  // Inline edit of an existing rep (name / email / Quo number).
  const [editing, setEditing] = useState<{ id: string; name: string; email: string; quo: string; title: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return;
    setEditSaving(true);
    try {
      const res = await fetch('/api/crm/rep-save', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ id: editing.id, name: editing.name.trim(), email: editing.email.trim() || null, quoNumber: editing.quo.trim() || null, title: editing.title.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Failed to save.');
      setEditing(null);
      await load();
      if (j.invited) window.alert(`Invite sent to ${editing.email.trim()}.`);
    } catch (e: any) { window.alert(e.message || 'Failed to save.'); }
    finally { setEditSaving(false); }
  };

  const setArchived = async (r: Rep, restore: boolean) => {
    if (!restore && !window.confirm(`Remove ${r.name} from the sales team? Their history stays, but they'll stop receiving leads and drop out of all dropdowns.`)) return;
    const res = await fetch('/api/crm/rep-remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ id: r.id, restore }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); window.alert(j.error || 'Failed.'); return; }
    await load();
  };

  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700"><p className="font-bold">Couldn’t load the team</p><p className="text-sm mt-1">{error}</p></div>;
  if (!reps) return <div className="py-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;

  const active = reps.filter((r) => !r.archived);
  const archived = reps.filter((r) => r.archived);

  const inp = 'h-9 rounded-lg border border-gray-200 px-2.5 text-sm outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 w-full';
  const RepRow: FC<{ r: Rep }> = ({ r }) => {
    if (editing && editing.id === r.id) {
      return (
        <div className="px-4 py-3 border-b border-gray-100 last:border-0 bg-brand-accent/[0.04]">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Full name" className={inp} autoFocus />
            <select value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} className={`${inp} bg-white cursor-pointer`}>
              <option value="">Job title…</option>
              {JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
              {editing.title && !JOB_TITLES.includes(editing.title) && <option value={editing.title}>{editing.title} (custom)</option>}
            </select>
            <input value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} placeholder="Work email (@drivevac.ca)" type="email" className={inp} />
            <input value={editing.quo} onChange={(e) => setEditing({ ...editing, quo: e.target.value })} placeholder="Quo number, e.g. +19025551234" className={inp}
              onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(null); }} />
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={saveEdit} disabled={editSaving || !editing.name.trim()}
              className="h-8 px-3 rounded-lg bg-brand-accent text-white text-[12px] font-bold disabled:opacity-40 hover:brightness-110 inline-flex items-center gap-1">
              {editSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Save
            </button>
            <button onClick={() => setEditing(null)} className="h-8 px-3 rounded-lg text-[12px] font-bold text-gray-500 hover:text-gray-800 inline-flex items-center gap-1"><X className="h-3.5 w-3.5" />Cancel</button>
            <span className="text-[11px] text-gray-400 ml-auto">Adding an email to a rep who hasn't signed in yet sends them an invite.</span>
          </div>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100 last:border-0 ${r.archived ? 'opacity-60' : ''}`}>
        <span className={`h-8 w-8 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 ${r.active ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-accent/10 text-brand-accent'}`}>
          {r.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-brand-primary text-sm truncate">{r.name}</p>
          <p className="text-[12px] text-gray-500 truncate">{r.title ? `${r.title} · ` : ''}{r.email || 'no email'} · {r.quoNumber || 'no Quo line'}{r.uid ? ' · ✓ signed in' : r.email ? ' · invite pending' : ''}</p>
        </div>
        {!r.archived && (
          <span className={`text-[11px] font-bold uppercase tracking-wide flex items-center gap-1 ${r.active ? 'text-emerald-600' : 'text-gray-400'}`}>
            <Circle className={`h-2 w-2 ${r.active ? 'fill-emerald-500 text-emerald-500' : 'fill-gray-300 text-gray-300'}`} />{r.active ? 'Active' : 'Off'}
          </span>
        )}
        {!r.archived && (
          <button onClick={() => setEditing({ id: r.id, name: r.name, email: r.email || '', quo: r.quoNumber || '', title: r.title || '' })}
            className="text-gray-300 hover:text-brand-accent transition" title="Edit name / title / email / Quo number"><Pencil className="h-4 w-4" /></button>
        )}
        {r.archived
          ? <button onClick={() => setArchived(r, true)} className="text-[12px] font-bold text-brand-accent hover:underline flex items-center gap-1"><RotateCcw className="h-3.5 w-3.5" />Restore</button>
          : <button onClick={() => setArchived(r, false)} className="text-gray-300 hover:text-red-500 transition" title="Remove from team"><Trash2 className="h-4 w-4" /></button>}
      </div>
    );
  };

  return (
    <div className="max-w-3xl">
      <header className="mb-5">
        <h1 className="text-2xl font-display font-bold text-brand-primary leading-none tracking-tight flex items-center gap-2">
          <Users className="h-5 w-5 text-brand-accent" /> Sales Team
        </h1>
        <p className="text-[13px] text-gray-500 mt-1.5">Onboard and offboard reps. Removing someone keeps their history but stops leads routing to them.</p>
      </header>

      {/* Add rep */}
      <div className="rounded-2xl border border-gray-200/70 bg-white p-4 mb-5 shadow-sm">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-3">Onboard a rep</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name"
            className="h-10 rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20" />
          <select value={title} onChange={(e) => setTitle(e.target.value)}
            className={`h-10 rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20 bg-white cursor-pointer ${title ? 'text-brand-primary' : 'text-gray-400'}`}>
            <option value="">Job title (for email signature)</option>
            {JOB_TITLES.map((t) => <option key={t} value={t} className="text-brand-primary">{t}</option>)}
          </select>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Work email (@drivevac.ca)" type="email"
            className="h-10 rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20" />
          <input value={quo} onChange={(e) => setQuo(e.target.value)} placeholder="Quo number (optional, e.g. +19025551234)"
            className="h-10 rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20" />
          <button onClick={addRep} disabled={saving || !name.trim()}
            className="h-10 px-4 rounded-xl bg-brand-accent text-white text-sm font-bold disabled:opacity-40 hover:brightness-110 inline-flex items-center gap-2 justify-center">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Add &amp; invite
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Add their <b>@drivevac.ca email</b> and they get an <b>invite email</b> to sign in and set their PIN — their login auto-links to this record. A Quo number lets them text from their own line (else the shared line).</p>
      </div>

      {/* Active team */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-5">
        <div className="px-4 py-2.5 border-b border-gray-100 bg-slate-50 flex items-center gap-2">
          <h3 className="text-sm font-bold text-brand-primary">Team</h3>
          <span className="text-[11px] font-bold text-brand-accent bg-brand-accent/10 rounded-full px-2 py-0.5">{active.length}</span>
        </div>
        {active.length === 0 ? <p className="p-4 text-sm text-gray-400">No reps yet.</p> : active.map((r) => <RepRow key={r.id} r={r} />)}
      </div>

      {/* Archived */}
      {archived.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 bg-slate-50">
            <h3 className="text-sm font-bold text-gray-500">Removed ({archived.length})</h3>
          </div>
          {archived.map((r) => <RepRow key={r.id} r={r} />)}
        </div>
      )}
    </div>
  );
}
