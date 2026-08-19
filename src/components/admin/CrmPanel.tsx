import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type FC, type ChangeEvent } from 'react';
import { auth } from '@/lib/firebase';
import { Loader2, User, X, Circle, Users, Filter, Search, Power, LayoutGrid, List, Send, Pencil, Phone, ArrowUp, ArrowDown, ArrowUpDown, ImagePlus, Plus, Mail, Trash2, Car } from 'lucide-react';

// A crmLeads record — our own copy of a Pipedrive lead (clean schema).
type CrmLead = {
  id: string;
  pipedriveLeadId?: string;
  title?: string;
  ownerId?: number | null;
  addTime?: string | null;
  stage?: string | null;
  lostReason?: string | null;     // why a lead was lost (only when stage === 'lost')
  owner?: string | null;          // uid of the assigned rep, or null = master pool
  ownerName?: string | null;
  assignedAt?: string | null;
  lastAttemptAt?: string | null;
  activityLog?: { text: string; by?: string; at?: string; [k: string]: any }[];
  leadSource?: string;
  applicationId?: string;
  firstName?: string; lastName?: string; dob?: string; phone?: string; email?: string;
  street?: string; suite?: string; city?: string; province?: string; postal?: string;
  rentOrOwn?: string; monthlyPayment?: string; timeAtAddress?: string;
  employmentStatus?: string; employer?: string; jobTitle?: string;
  hourlyWage?: string; monthlyIncome?: string; hoursPerWeek?: string; timeOnJob?: string;
  creditSelfRating?: string; validLicense?: string; citizenOrPR?: string; hasTradeIn?: string;
  lookingFor?: string; budget?: string; downPayment?: string;
  notes?: { content: string; addTime?: string; byName?: string }[];
};
type Stage = { key: string; label: string };
type Rep = { id: string; name: string; quoNumber?: string | null; active?: boolean; uid?: string | null };

const MASTER = 'Vehicle Approval Centre';

// Per-stage dot colour — active journey in colour, the two exits muted.
const STAGE_DOT: Record<string, string> = {
  new_lead: '#3b82f6',
  attempting_contact: '#f59e0b',
  dealertrack: '#6366f1',
  approved: '#10b981',
  signed: '#16a34a',
  lost: '#9ca3af',
  free_to_call: '#f97316',
};

// ---- Attempting-Contact aging ---------------------------------------------
// A lead may sit in Attempting Contact for at most FREE_TO_CALL_BDAYS BUSINESS
// days (Mon–Fri) since it entered the stage. Hit the limit and the server's
// tick auto-releases it to the Free-to-Call pool. Colour = how close it is.
// The clock does NOT reset on notes/texts — it's a stage-dwell limit, so a
// rep either moves the lead forward or loses it. Must match server's rule.
export const FREE_TO_CALL_BDAYS = 3;
type AgeTier = { key: string; label: string; hint: string; from: number; bg: string; border: string; text: string; dot: string };
export const AGE_TIERS: AgeTier[] = [
  { key: 'day1', label: 'Day 1',        hint: 'just moved in — reach out today',        from: 0, bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-700', dot: '#22c55e' },
  { key: 'day2', label: 'Day 2',        hint: 'one business day left after today',       from: 1, bg: 'bg-yellow-50', border: 'border-yellow-300',  text: 'text-yellow-700', dot: '#eab308' },
  { key: 'day3', label: 'Day 3 — last', hint: 'releases to Free-to-Call end of day',     from: 2, bg: 'bg-red-50',    border: 'border-red-400',     text: 'text-red-700',    dot: '#ef4444' },
  { key: 'released', label: 'Free to call', hint: `${FREE_TO_CALL_BDAYS}+ business days — back in the pool`, from: FREE_TO_CALL_BDAYS, bg: 'bg-gray-100', border: 'border-gray-400 border-dashed', text: 'text-gray-600', dot: '#6b7280' },
];
// Business days (Mon–Fri) elapsed AFTER the entry day, through today (local time).
// Entered Mon: Mon=0, Tue=1, Wed=2, Thu=3(released). Entered Fri: Mon=1, Tue=2, Wed=3.
const businessDaysBetween = (from: Date, to: Date): number => {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  let n = 0;
  const d = new Date(a); d.setDate(d.getDate() + 1);
  for (; d <= b; d.setDate(d.getDate() + 1)) { const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++; }
  return n;
};
// Business days since the lead FIRST entered Attempting Contact (stage-dwell, not
// last touch — and bouncing out and back doesn't reset it).
const ageDays = (l: CrmLead): number | null => {
  if ((l.stage || 'new_lead') !== 'attempting_contact') return null;
  const hist = (l as any).stageHistory as { to?: string; at?: string }[] | undefined;
  const firstEntered = hist ? hist.find((h) => h.to === 'attempting_contact')?.at : undefined;
  const base = (l as any).attemptingSince || firstEntered || l.addTime;
  if (!base) return null;
  return businessDaysBetween(new Date(base), new Date());
};
const ageTier = (l: CrmLead): AgeTier | null => {
  const d = ageDays(l);
  if (d == null) return null;
  return [...AGE_TIERS].reverse().find((t) => d >= t.from) || AGE_TIERS[0];
};

// Why a lead is dropped into "Lost" — captured on drop so declines stay
// re-marketable and you can see where deals fall through.
const LOST_REASONS = ['Not approved', 'Bought elsewhere', 'Not interested', 'Bad / wrong number', 'Other'];
// Lost = "not now". Default wake-up (days) per reason → the lead sleeps in Nurture, then
// resurfaces in the Free-to-Call pool. null = no default (Other must be set by the rep; Bad number = dead).
const NURTURE_DEFAULT_DAYS: Record<string, number | null> = {
  'Not approved': 180, 'Bought elsewhere': 365, 'Not interested': 90, 'Bad / wrong number': null, 'Other': null,
};
const NURTURE_WHY: Record<string, string> = {
  'Not approved': 'credit/income often changes in ~6 months',
  'Bought elsewhere': 'trade-in / upgrade window in ~a year',
  'Not interested': 'situations change — a soft check-in in ~3 months',
  'Bad / wrong number': 'dead unless a new number turns up',
  'Other': 'set when it\'s worth calling back — or no follow-up',
};

// Colour spine per thread entry type — makes the activity feed scannable.
const KIND_ACCENT: Record<string, string> = {
  text: '#7380FF',        // brand periwinkle
  call: '#3b82f6',        // blue
  recording: '#6366f1',   // indigo
  note: '#94a3b8',        // slate
  application: '#a78bfa', // light purple
  email: '#0ea5e9',       // sky
};

const nameOf = (l: CrmLead) => [l.firstName, l.lastName].filter(Boolean).join(' ') || l.title || '—';
const initialsOf = (l: CrmLead) => (nameOf(l).split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('') || '?').toUpperCase();
const money = (x: any) => (x ? `$${String(x).replace(/[^0-9.]/g, '')}` : '');
const fmt = (iso?: string | null) => { try { return iso ? new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; } catch { return iso || ''; } };
const fmtDT = (iso?: string | null) => { try { return iso ? new Date(iso).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; } catch { return iso || ''; } };
const stripHtml = (s?: string) => (s || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');

async function token() { return (await auth.currentUser?.getIdToken()) || ''; }

// Email attachment chip/thumbnail — fetched with the user's token (img src can't carry auth).
type AttRef = { id: string; filename: string; mimeType: string; size: number; messageId: string; mailbox: string; url?: string };
const attUrlCache = new Map<string, string>();   // object URLs, reused across the lightbox
async function fetchAttachmentUrl(a: AttRef): Promise<string | null> {
  if (a.url) return a.url;   // direct (public, tokened) URL — e.g. trade-in photos in Storage
  const key = `${a.mailbox}|${a.messageId}|${a.id}`;
  const hit = attUrlCache.get(key); if (hit) return hit;
  const qs = new URLSearchParams({ mailbox: a.mailbox, messageId: a.messageId, attachmentId: a.id, filename: a.filename, mimeType: a.mimeType });
  const res = await fetch(`/api/crm/email-attachment?${qs}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) return null;
  const u = URL.createObjectURL(await res.blob()); attUrlCache.set(key, u); return u;
}
const EmailAttachment: FC<{ att: AttRef; onOpen: (att: AttRef) => void }> = ({ att, onOpen }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const isImg = /^image\//.test(att.mimeType);
  useEffect(() => { if (isImg) fetchAttachmentUrl(att).then((u) => (u ? setUrl(u) : setErr(true))); }, [isImg, att]);
  if (isImg) {
    return (
      <button onClick={() => onOpen(att)} title={`${att.filename} — click to view`} className="block rounded-lg overflow-hidden border border-gray-200 hover:border-brand-accent transition bg-white">
        {url ? <img src={url} alt={att.filename} className="h-24 w-24 object-cover" /> : <div className="h-24 w-24 flex items-center justify-center text-gray-300">{err ? <X className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}</div>}
      </button>
    );
  }
  return (
    <button onClick={async () => { const u = await fetchAttachmentUrl(att); if (u) window.open(u, '_blank', 'noopener'); }}
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-brand-primary hover:border-brand-accent transition">
      📎 {att.filename} <span className="text-gray-400 font-normal">({Math.max(1, Math.round(att.size / 1024))} KB)</span>
    </button>
  );
};

// Lightbox — view an image attachment full-size; ◀ ▶ / arrow keys flip through every image in the thread; Esc / ✕ / click-outside closes.
const Lightbox: FC<{ items: AttRef[]; index: number; onClose: () => void; onIndex: (i: number) => void }> = ({ items, index, onClose, onIndex }) => {
  const [url, setUrl] = useState<string | null>(null);
  const cur = items[index];
  useEffect(() => { setUrl(null); if (cur) fetchAttachmentUrl(cur).then((u) => setUrl(u)); }, [cur]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);
  if (!cur) return null;
  return (
    <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="absolute top-4 right-4 h-10 w-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center" title="Close (Esc)"><X className="h-5 w-5" /></button>
      <div className="absolute top-4 left-4 text-white/80 text-sm font-semibold truncate max-w-[60vw]">{cur.filename}{items.length > 1 && <span className="ml-2 text-white/50">{index + 1} / {items.length}</span>}</div>
      {items.length > 1 && index > 0 && (
        <button onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }} className="absolute left-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center text-2xl" title="Previous (←)">‹</button>
      )}
      {items.length > 1 && index < items.length - 1 && (
        <button onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }} className="absolute right-4 top-1/2 -translate-y-1/2 h-12 w-12 rounded-full bg-white/10 hover:bg-white/25 text-white flex items-center justify-center text-2xl" title="Next (→)">›</button>
      )}
      <div className="max-w-[92vw] max-h-[88vh]" onClick={(e) => e.stopPropagation()}>
        {url ? <img src={url} alt={cur.filename} className="max-w-[92vw] max-h-[88vh] object-contain rounded-lg shadow-2xl" /> : <Loader2 className="h-8 w-8 animate-spin text-white/70" />}
      </div>
      {url && <a href={url} download={cur.filename} onClick={(e) => e.stopPropagation()} className="absolute bottom-5 right-5 text-[12px] font-bold text-white/80 hover:text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg">Download</a>}
    </div>
  );
};

// "Trade-in link" — unique link tied to this lead (no App ID). Text it to the customer in one tap, or copy it.
const TradeLinkButton: FC<{ lead: CrmLead; onLogged: (entry: any) => void }> = ({ lead, onLogged }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'sms' | 'copy' | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const call = async (send?: 'sms') => {
    const res = await fetch('/api/crm/trade-link', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ leadId: lead.id, send }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { window.alert(j.error || 'Failed.'); return null; }
    return j as { link: string; sent: boolean };
  };
  const sendSms = async () => {
    setBusy('sms');
    try {
      const j = await call('sms');
      if (j?.sent) { onLogged({ text: `💬 Text sent: trade-in link → ${lead.phone}`, by: 'you', at: new Date().toISOString(), kind: 'text', direction: 'outbound' }); setOpen(false); }
    } finally { setBusy(null); }
  };
  const copy = async () => {
    setBusy('copy');
    try { const j = await call(); if (j?.link) { setLink(j.link); try { await navigator.clipboard.writeText(j.link); } catch {} } }
    finally { setBusy(null); }
  };
  const submitted = !!(lead as any).tradeSubmittedAt;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} title={submitted ? 'Trade-in submitted — see thread' : 'Send the customer a trade-in appraisal link (no App ID needed)'}
        className={`h-9 px-3 rounded-xl text-sm font-bold inline-flex items-center gap-1.5 transition border ${submitted ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-brand-primary hover:border-brand-accent'}`}>
        <Car className="h-4 w-4" />{submitted ? 'Trade-in ✓' : 'Trade-in link'}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-20 w-72 rounded-2xl border border-gray-100 bg-white shadow-xl p-3" onClick={(e) => e.stopPropagation()}>
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-1">Trade-in appraisal link</p>
          <p className="text-[12px] text-gray-500 mb-3">Unique to {lead.firstName || 'this lead'} — opens the appraisal page already connected to their application. They just add photos + details.</p>
          <button onClick={sendSms} disabled={busy !== null || !lead.phone}
            className="w-full h-10 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:brightness-110 disabled:opacity-40 inline-flex items-center justify-center gap-2">
            {busy === 'sms' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Text it to {lead.phone || '(no phone)'}
          </button>
          <button onClick={copy} disabled={busy !== null}
            className="w-full h-9 mt-2 rounded-xl border border-gray-200 text-brand-primary text-[13px] font-bold hover:border-brand-accent disabled:opacity-40">
            {busy === 'copy' ? 'Copying…' : link ? 'Copied ✓ — click to copy again' : 'Copy link'}
          </button>
          {link && <p className="mt-2 text-[10px] text-gray-400 break-all">{link}</p>}
        </div>
      )}
    </div>
  );
};

// Click-to-edit field row — a rep can correct a customer's typo in place.
const EditableRow: FC<{ label: string; value: any; field: string; money?: boolean; locked?: boolean; onSave: (field: string, value: string) => void }> = ({ label, value, field, money: isMoney, locked, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const raw = value == null ? '' : String(value);
  const start = () => { setVal(raw); setEditing(true); };
  const commit = () => { setEditing(false); if (val !== raw) onSave(field, val); };
  const display = raw === '' ? '' : (isMoney ? money(value) : value);
  if (locked) {
    return (
      <div className="flex justify-between items-center gap-3 py-1.5 border-b border-gray-50 last:border-0" title="Income can only be changed by a manager">
        <span className="text-gray-500 text-sm shrink-0 inline-flex items-center gap-1">{label} <span className="text-[10px] text-gray-300">🔒</span></span>
        {display ? <span className="text-brand-primary font-semibold text-sm text-right">{display}</span> : <span className="text-gray-300 text-sm italic">—</span>}
      </div>
    );
  }
  return (
    <div className="flex justify-between items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500 text-sm shrink-0">{label}</span>
      {editing ? (
        <input autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          className="text-sm text-right text-brand-primary font-semibold border border-brand-accent rounded-md px-2 py-0.5 w-3/5 outline-none focus:ring-2 focus:ring-brand-accent/20 bg-white" />
      ) : (
        <button onClick={start} className="group text-right text-sm font-semibold rounded px-1 -mx-1 transition hover:bg-brand-accent/5 flex items-center gap-1 min-w-0">
          {display ? <span className="text-brand-primary truncate">{display}</span> : <span className="text-gray-300 font-normal italic">Add</span>}
          <Pencil className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100 shrink-0" />
        </button>
      )}
    </div>
  );
};

function Detail({ lead, stages, reps, onClose, onUpdate, onSendText, onSendEmail, onEmailsImported, onClaim, myRepId, isRep, onDelete }: {
  lead: CrmLead; stages: Stage[]; reps: Rep[];
  onClose: () => void;
  onUpdate: (patch: { stage?: string; owner?: string | null; ownerName?: string | null; note?: string; fields?: Record<string, string | null> }) => Promise<void>;
  onSendText: (text: string) => Promise<void>;
  onSendEmail: (subject: string, body: string, files?: File[]) => Promise<boolean>;
  onEmailsImported: (entries: any[]) => void;
  onClaim?: (repId?: string) => Promise<void>;
  myRepId?: string | null;
  isRep?: boolean;
  onDelete?: () => void;
}) {
  const onEdit = (field: string, value: string) => { onUpdate({ fields: { [field]: value } }); };
  // Draft persistence: an unsaved note/text is kept per-lead so an accidental close
  // doesn't lose it. Cleared automatically once it's logged/sent.
  const draftKey = `crm-draft-${lead.id}`;
  const readDraft = () => { try { return JSON.parse(localStorage.getItem(draftKey) || '{}'); } catch { return {}; } };
  const [note, setNote] = useState<string>(() => readDraft().text || '');
  const [subject, setSubject] = useState<string>(() => readDraft().subject || '');
  const [saving, setSaving] = useState(false);
  type Mode = 'note' | 'text' | 'email';
  const [mode, setMode] = useState<Mode>(() => { const m = readDraft().mode; return m === 'text' || m === 'email' ? m : 'note'; });
  useEffect(() => {
    try {
      if (note.trim() || subject.trim()) localStorage.setItem(draftKey, JSON.stringify({ text: note, subject, mode }));
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [note, subject, mode, draftKey]);

  // Email templates — shared, editable by everyone. {{firstName}} etc. filled per lead.
  const [templates, setTemplates] = useState<{ id: string; name: string; subject: string; body: string }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch('/api/crm/email-templates', { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json(); if (res.ok) setTemplates(j.templates || []);
    } catch {}
  }, []);
  useEffect(() => { if (mode === 'email') loadTemplates(); }, [mode, loadTemplates]);
  const fillTemplate = (s: string) => s
    .replace(/\{\{\s*firstName\s*\}\}/gi, lead.firstName || '')
    .replace(/\{\{\s*lastName\s*\}\}/gi, lead.lastName || '')
    .replace(/\{\{\s*name\s*\}\}/gi, nameOf(lead))
    .replace(/\{\{\s*lookingFor\s*\}\}/gi, lead.lookingFor || 'a vehicle')
    .replace(/\{\{\s*budget\s*\}\}/gi, lead.budget || '')
    .replace(/\{\{\s*repName\s*\}\}/gi, lead.ownerName || auth.currentUser?.displayName || '')
    .replace(/\{\{\s*city\s*\}\}/gi, lead.city || '');
  const applyTemplate = (t: { subject: string; body: string }) => { setSubject(fillTemplate(t.subject)); setNote(fillTemplate(t.body)); };
  // Email attachments (files/photos) — real MIME attachments via Gmail.
  const [emailFiles, setEmailFiles] = useState<File[]>([]);
  const emailFileRef = useRef<HTMLInputElement | null>(null);
  // Auto-grow the compose box so every typed line stays visible (up to a max).
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const el = taRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; }
  }, [note]);

  // Photos: Quo's send API is text-only (no MMS), so photos go via the Quo app —
  // an sms: link opens the customer's conversation in OpenPhone (same mechanism as Call).
  const smsHref = (() => {
    if (!lead.phone) return null;
    const d = String(lead.phone).replace(/\D/g, '');
    return 'sms:+' + (d.length === 10 ? '1' + d : d);
  })();
  // Slide-in on open, slide-out on close.
  const [shown, setShown] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(id); }, []);
  // On open: if we've emailed this lead, pull any new replies right now (don't wait for the sweep).
  const [emailRefreshing, setEmailRefreshing] = useState(false);
  useEffect(() => {
    if (!(lead as any).emailThread?.threadId) return;
    let cancelled = false;
    (async () => {
      setEmailRefreshing(true);
      try {
        const res = await fetch('/api/crm/email-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ leadId: lead.id }) });
        const j = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(j.entries) && j.entries.length) onEmailsImported(j.entries);
      } catch {} finally { if (!cancelled) setEmailRefreshing(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);
  const handleClose = () => { setShown(false); setTimeout(onClose, 250); };
  const Row = ({ l, v }: { l: string; v: any }) => (v === undefined || v === null || v === '' ? null : (
    <div className="flex justify-between gap-4 py-1.5 border-b border-gray-50 last:border-0">
      <span className="text-gray-500 text-sm">{l}</span><span className="text-brand-primary font-semibold text-sm text-right">{v}</span>
    </div>
  ));
  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <div className="mb-4">
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-2">{title}</h4>
      <div className="rounded-xl border border-gray-100 bg-white px-3.5 py-0.5 shadow-[0_1px_3px_rgba(20,21,45,0.04)]">{children}</div>
    </div>
  );
  const submit = async () => {
    if (!note.trim()) return;
    if (mode === 'email' && !subject.trim()) { window.alert('Add a subject line.'); return; }
    setSaving(true);
    try {
      if (mode === 'text') await onSendText(note.trim());
      else if (mode === 'email') { const ok = await onSendEmail(subject.trim(), note.trim(), emailFiles); if (!ok) return; setSubject(''); setEmailFiles([]); }
      else await onUpdate({ note: note.trim() });
      setNote('');
    } finally { setSaving(false); }
  };
  // One combined thread: logged activity + the original application note(s), newest first.
  const [lightbox, setLightbox] = useState<{ items: AttRef[]; index: number } | null>(null);
  // Chat behaviour: keep the latest message in view (scroll to bottom on open + when new entries land).
  const threadRef = useRef<HTMLDivElement | null>(null);
  const threadLen = (lead.activityLog || []).length + (lead.notes || []).length;
  useEffect(() => { const el = threadRef.current; if (el) el.scrollTop = el.scrollHeight; }, [lead.id, threadLen]);
  const thread = [
    ...(lead.activityLog || []).map((a: any) => ({ kind: (a.kind as string) || 'note', direction: (a.direction as string) || '', text: a.text, by: a.by || 'Staff', at: a.at || '', media: (a.media as string[]) || [], mediaLabels: (a.mediaLabels as string[]) || [], attachments: (Array.isArray(a.attachments) ? a.attachments.filter((x: any) => x && typeof x === 'object' && x.id) : []) as { id: string; filename: string; mimeType: string; size: number }[], gmailId: a.gmailId as string | undefined, mailbox: a.mailbox as string | undefined })),
    ...(lead.notes || []).map((n) => ({ kind: 'application', direction: '', text: stripHtml(n.content), by: n.byName || 'Website', at: n.addTime || '', media: [] as string[], mediaLabels: [] as string[], attachments: [] as { id: string; filename: string; mimeType: string; size: number }[], gmailId: undefined as string | undefined, mailbox: undefined as string | undefined })),
  ].sort((a, b) => String(a.at).localeCompare(String(b.at)));   // oldest → newest (chat order; compose sits at the bottom)

  // Every image attachment in this thread, oldest → newest, so the lightbox can flip through them.
  const galleryItems: AttRef[] = thread.flatMap((t: any) => [
    ...(t.gmailId && t.mailbox && Array.isArray(t.attachments) ? t.attachments : [])
      .filter((a: any) => /^image\//.test(a.mimeType))
      .map((a: any) => ({ ...a, messageId: t.gmailId, mailbox: t.mailbox })),
    ...((t.media || []) as string[]).map((u: string, i: number) => ({ id: u, filename: (t.mediaLabels || [])[i] || 'photo', mimeType: 'image/jpeg', size: 0, messageId: '', mailbox: '', url: u })),
  ]);
  const openAttachment = (att: AttRef) => {
    const idx = galleryItems.findIndex((g) => g.id === att.id && g.messageId === att.messageId);
    setLightbox({ items: galleryItems.length ? galleryItems : [att], index: Math.max(0, idx) });
  };
  // Auto-calc gross income for hourly earners: wage × hours/week (→ /mo, /yr).
  const wageN = parseFloat(String(lead.hourlyWage || '').replace(/[^0-9.]/g, ''));
  const hrsN = parseFloat(String(lead.hoursPerWeek || '').replace(/[^0-9.]/g, ''));
  const estWeekly = wageN > 0 && hrsN > 0 ? wageN * hrsN : 0;
  const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString('en-CA')}`;
  return (
    <div className={`fixed inset-0 z-50 flex justify-end bg-black/40 transition-opacity duration-300 ${shown ? 'opacity-100' : 'opacity-0'}`} onClick={handleClose}>
      <div className={`w-full max-w-6xl h-full bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-out ${shown ? 'translate-x-0' : 'translate-x-full'}`} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100 shrink-0 bg-gradient-to-r from-brand-accent/10 via-brand-accent/[0.03] to-transparent">
          <div className="flex items-center gap-3 min-w-0">
            <span className="h-11 w-11 rounded-2xl bg-gradient-to-br from-brand-accent to-brand-primary text-white flex items-center justify-center font-bold text-sm shrink-0 shadow-md shadow-brand-accent/30">{initialsOf(lead)}</span>
            <div className="min-w-0">
              <h3 className="text-xl font-display font-bold text-brand-primary leading-tight truncate">{nameOf(lead)}</h3>
              <p className="text-gray-400 text-xs mt-0.5">Pipedrive #{lead.pipedriveLeadId} · {fmt(lead.addTime)}{emailRefreshing && <span className="ml-2 inline-flex items-center gap-1 text-sky-600"><Loader2 className="h-3 w-3 animate-spin" />checking email…</span>}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <TradeLinkButton lead={lead} onLogged={(entry) => onEmailsImported([entry])} />
            {lead.stage === 'free_to_call' && onClaim && (() => {
              const wasMine = !!myRepId && (lead as any).releasedFrom === myRepId;
              return (
                <div className="flex items-center gap-2">
                  {!isRep && (
                    <select id="claim-rep-select" defaultValue={myRepId || ''} className="h-9 rounded-xl border border-orange-300 bg-white px-2.5 text-[12px] font-bold text-brand-primary outline-none cursor-pointer">
                      <option value="">Assign to…</option>
                      {reps.map((r) => <option key={r.id} value={r.id} disabled={(lead as any).releasedFrom === r.id}>{r.name}{(lead as any).releasedFrom === r.id ? ' (had it)' : ''}</option>)}
                    </select>
                  )}
                  <button disabled={isRep && wasMine}
                    title={isRep && wasMine ? "You had this lead — it's in the pool for someone else to try" : 'Take this lead: you become the owner and it moves to Attempting Contact'}
                    onClick={() => { const sel = document.getElementById('claim-rep-select') as HTMLSelectElement | null; onClaim(!isRep && sel?.value ? sel.value : undefined); }}
                    className="h-9 px-3.5 rounded-xl bg-orange-500 text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-orange-600 transition shadow-sm shadow-orange-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
                    <Power className="h-4 w-4" />{isRep ? 'Claim & work' : 'Assign & move to Attempting'}
                  </button>
                </div>
              );
            })()}
            {lead.phone && (() => {
              const digits = String(lead.phone).replace(/\D/g, '');
              const tel = 'tel:+' + (digits.length === 10 ? '1' + digits : digits);
              return (
                <a href={tel} title={`Call ${lead.phone} via Quo`}
                  className="h-9 px-3.5 rounded-xl bg-emerald-500 text-white text-sm font-bold inline-flex items-center gap-1.5 hover:bg-emerald-600 transition shadow-sm shadow-emerald-500/30">
                  <Phone className="h-4 w-4" />Call
                </a>
              );
            })()}
            {onDelete && !isRep && (
              <button onClick={onDelete} title="Delete this lead (junk / test / duplicate)" className="h-9 w-9 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition"><Trash2 className="h-4 w-4" /></button>
            )}
            <button onClick={handleClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* LEFT — lead details (compact fixed column), scrolls in place */}
          <div className="w-[420px] shrink-0 overflow-y-auto p-6">
            <div className="mb-4">
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-2">Pipeline</h4>
              <div className="rounded-2xl border border-brand-accent/20 bg-brand-accent/[0.05] p-3.5 space-y-3 shadow-[0_1px_3px_rgba(115,128,255,0.08)]">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Stage</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full pointer-events-none z-10" style={{ background: STAGE_DOT[lead.stage || 'new_lead'] || '#9ca3af' }} />
                    <select value={lead.stage || 'new_lead'} onChange={(e) => onUpdate({ stage: e.target.value })}
                      className="w-full h-11 rounded-xl border border-gray-200 bg-white pl-8 pr-3 text-sm font-bold text-brand-primary outline-none transition cursor-pointer focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20">
                      {stages.filter((s) => s.key !== 'free_to_call').map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Owner</label>
                  <div className="relative">
                    <span className={`absolute left-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold pointer-events-none z-10 ${lead.owner ? 'bg-gradient-to-br from-brand-accent to-brand-primary text-white' : 'bg-gray-200 text-gray-400'}`}>
                      {lead.owner ? ((lead.ownerName || '').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?') : <User className="h-3.5 w-3.5" />}
                    </span>
                    <select value={lead.owner || ''} onChange={(e) => {
                      const id = e.target.value;
                      onUpdate({ owner: id || null, ownerName: id ? (reps.find((r) => r.id === id)?.name || null) : null });
                    }} className="w-full h-11 rounded-xl border border-gray-200 bg-white pl-11 pr-3 text-sm font-bold text-brand-primary outline-none transition cursor-pointer focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20">
                      <option value="">{MASTER} (pool)</option>
                      {reps.map((r) => <option key={r.id} value={r.id}>{r.name}{r.quoNumber ? '' : ' (no Quo)'}</option>)}
                    </select>
                  </div>
                </div>
                {lead.stage === 'lost' && lead.lostReason && (
                  <p className="text-[11px] text-rose-600 font-semibold">Lost reason: {lead.lostReason}</p>
                )}
              </div>
            </div>

            <Section title="Contact">
              <EditableRow label="First name" value={lead.firstName} field="firstName" onSave={onEdit} />
              <EditableRow label="Last name" value={lead.lastName} field="lastName" onSave={onEdit} />
              <EditableRow label="Phone" value={lead.phone} field="phone" onSave={onEdit} />
              <EditableRow label="Email" value={lead.email} field="email" onSave={onEdit} />
              <EditableRow label="Date of birth" value={lead.dob} field="dob" onSave={onEdit} />
              <EditableRow label="Street" value={lead.street} field="street" onSave={onEdit} />
              <EditableRow label="Suite / Apt" value={lead.suite} field="suite" onSave={onEdit} />
              <EditableRow label="City" value={lead.city} field="city" onSave={onEdit} />
              <EditableRow label="Province" value={lead.province} field="province" onSave={onEdit} />
              <EditableRow label="Postal code" value={lead.postal} field="postal" onSave={onEdit} />
            </Section>
            <Section title="Vehicle">
              <EditableRow label="Looking for" value={lead.lookingFor} field="lookingFor" onSave={onEdit} />
              <EditableRow label="Budget" value={lead.budget} field="budget" onSave={onEdit} />
              <EditableRow label="Down payment" value={lead.downPayment} field="downPayment" money onSave={onEdit} />
              <EditableRow label="Has trade-in" value={lead.hasTradeIn} field="hasTradeIn" onSave={onEdit} />
              {(lead as any).tradeIn && (() => { const t = (lead as any).tradeIn; return (
                <div className="-mx-3.5 mt-1.5 px-3.5 py-2.5 bg-emerald-50 border-t border-emerald-200 rounded-b-xl">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 mb-1">🚗 Trade-in submitted {t.submittedAt ? `· ${fmt(t.submittedAt)}` : ''}</p>
                  <p className="text-sm font-bold text-brand-primary">{[t.year, t.make, t.model, t.trim].filter(Boolean).join(' ') || 'Vehicle'}</p>
                  <p className="text-[12px] text-gray-600 mt-0.5">{[t.kilometers ? `${t.kilometers} km` : '', t.vin ? `VIN ${t.vin}` : '', t.inspectionExpiry ? `Safety sticker expires: ${t.inspectionExpiry}` : '', t.photos != null ? `${t.photos} photos` : ''].filter(Boolean).join(' · ')}</p>
                  {t.notes && <p className="text-[12px] text-gray-500 mt-1 italic">“{t.notes}”</p>}
                  {Array.isArray(t.photoUrls) && t.photoUrls.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {t.photoUrls.map((p: any) => (
                        <button key={p.url} title={p.label} onClick={() => openAttachment({ id: p.url, filename: p.label || 'photo', mimeType: 'image/jpeg', size: 0, messageId: '', mailbox: '', url: p.url })}
                          className="h-14 w-14 rounded-md overflow-hidden border border-emerald-200 hover:border-brand-accent"><img src={p.url} alt={p.label} className="h-full w-full object-cover" /></button>
                      ))}
                    </div>
                  )}
                </div>
              ); })()}
            </Section>
            <Section title="Credit & eligibility">
              <EditableRow label="Credit self-rating" value={lead.creditSelfRating} field="creditSelfRating" onSave={onEdit} />
              <EditableRow label="Valid licence" value={lead.validLicense} field="validLicense" onSave={onEdit} />
              <EditableRow label="Citizen/PR" value={lead.citizenOrPR} field="citizenOrPR" onSave={onEdit} />
            </Section>
            <Section title="Employment & income">
              <EditableRow label="Status" value={lead.employmentStatus} field="employmentStatus" onSave={onEdit} />
              <EditableRow label="Employer" value={lead.employer} field="employer" onSave={onEdit} />
              <EditableRow label="Job title" value={lead.jobTitle} field="jobTitle" onSave={onEdit} />
              <EditableRow label="Hourly wage" value={lead.hourlyWage} field="hourlyWage" money locked={isRep} onSave={onEdit} />
              <EditableRow label="Monthly income" value={lead.monthlyIncome} field="monthlyIncome" money locked={isRep} onSave={onEdit} />
              <EditableRow label="Hours/week" value={lead.hoursPerWeek} field="hoursPerWeek" locked={isRep} onSave={onEdit} />
              <EditableRow label="Time on job" value={lead.timeOnJob} field="timeOnJob" onSave={onEdit} />
              {estWeekly > 0 && (
                <div className="-mx-3.5 mt-1.5 px-3.5 py-2.5 bg-brand-accent/[0.06] border-t border-brand-accent/15 rounded-b-xl">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-brand-accent mb-1.5">Est. gross income</p>
                  <div className="flex justify-between gap-2">
                    <span className="text-brand-primary font-bold text-sm">{fmtMoney(estWeekly)}<span className="text-gray-400 font-medium text-[11px]"> /wk</span></span>
                    <span className="text-brand-primary font-bold text-sm">{fmtMoney(estWeekly * 52 / 12)}<span className="text-gray-400 font-medium text-[11px]"> /mo</span></span>
                    <span className="text-brand-primary font-bold text-sm">{fmtMoney(estWeekly * 52)}<span className="text-gray-400 font-medium text-[11px]"> /yr</span></span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1.5">Auto-calculated from {money(lead.hourlyWage)}/hr × {lead.hoursPerWeek} hrs/week.</p>
                </div>
              )}
            </Section>
            <Section title="Housing">
              <EditableRow label="Own/Rent" value={lead.rentOrOwn} field="rentOrOwn" onSave={onEdit} />
              <EditableRow label="Monthly payment" value={lead.monthlyPayment} field="monthlyPayment" money onSave={onEdit} />
              <EditableRow label="Time at address" value={lead.timeAtAddress} field="timeAtAddress" onSave={onEdit} />
            </Section>
            <Section title="Meta">
              <Row l="Lead source" v={lead.leadSource} /><Row l="Application ID" v={lead.applicationId} />
            </Section>
          </div>

          {/* RIGHT — activity + notes thread (takes the rest), scrolls independently */}
          <div className="flex-1 min-w-0 border-l border-gray-100 bg-slate-50 flex flex-col min-h-0">
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-2.5">
              {thread.length === 0 ? <p className="text-xs text-gray-400">Nothing logged yet.</p> : thread.map((t, i) => {
                // Conversation layout: customer (inbound) on the RIGHT in colour, us on the LEFT in white,
                // system/notes/calls/application as neutral centre cards.
                const isMsg = t.kind === 'text' || t.kind === 'email';
                const inbound = isMsg && t.direction === 'inbound';
                const outbound = isMsg && !inbound;
                // Strip the legacy "💬 Text sent:" / "📧 Email received — Subject" prefixes — the bubble says it.
                let body = t.text || '';
                let subj = '';
                if (t.kind === 'text') body = body.replace(/^💬\s*Text (sent|received):\s*/i, '');
                if (t.kind === 'email') {
                  const m = body.match(/^📧\s*Email (sent|received) — ([^\n]*)\n?([\s\S]*)$/);
                  if (m) { subj = m[2]; body = m[3].replace(/\n📎 .*$/s, ''); }
                }
                const customerName = nameOf(lead);
                const who = inbound ? customerName : t.by;
                const media = (t.media || []) as string[];
                const atts = (t.attachments && t.gmailId && t.mailbox) ? t.attachments : [];
                const hasAnyMedia = media.length > 0 || atts.length > 0;

                if (isMsg) {
                  return (
                    <div key={i} className={`flex ${inbound ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[86%] min-w-[240px] rounded-2xl px-3.5 py-2.5 shadow-sm ${inbound
                        ? (t.kind === 'text' ? 'bg-emerald-500 text-white rounded-br-sm' : 'bg-sky-500 text-white rounded-br-sm')
                        : 'bg-white border border-gray-200 text-brand-primary rounded-bl-sm'}`}>
                        <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-1 ${inbound ? 'text-white/80' : (t.kind === 'email' ? 'text-sky-700' : 'text-emerald-700')}`}>
                          {t.kind === 'email' ? <Mail className="h-3 w-3" /> : <Send className="h-3 w-3" />}
                          {t.kind === 'email' ? (inbound ? 'Email from customer' : 'Email') : (inbound ? 'Text from customer' : 'Text')}
                          {subj && <span className={`normal-case tracking-normal font-semibold ${inbound ? 'text-white' : 'text-brand-primary'}`}>· {subj}</span>}
                        </div>
                        {body && <p className={`text-[13px] whitespace-pre-wrap leading-snug break-words ${inbound ? 'text-white' : 'text-brand-primary'}`}>{body}</p>}
                        {hasAnyMedia && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {atts.map((a: any) => <EmailAttachment key={a.id} att={{ ...a, messageId: t.gmailId!, mailbox: t.mailbox! }} onOpen={openAttachment} />)}
                            {media.map((u: string, mi: number) => {
                              const label = (t.mediaLabels || [])[mi];
                              return (
                                <button key={u} onClick={() => openAttachment({ id: u, filename: label || 'photo', mimeType: 'image/jpeg', size: 0, messageId: '', mailbox: '', url: u })} title={label || 'View photo'}
                                  className="block rounded-lg overflow-hidden border border-white/40 bg-white/10 text-left">
                                  <img src={u} alt={label || 'photo'} className="h-24 w-24 object-cover" />
                                  {label && <span className="block w-24 px-1 py-0.5 text-[9px] font-semibold truncate bg-black/20">{label}</span>}
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <p className={`text-[10px] mt-1.5 ${inbound ? 'text-white/70' : 'text-gray-400'}`}>{who} · {fmtDT(t.at)}</p>
                      </div>
                    </div>
                  );
                }

                // System / note / call / application card (neutral, full width)
                return (
                  <div key={i} className="relative rounded-xl bg-white border border-gray-100 p-3 pl-4 shadow-[0_1px_3px_rgba(20,21,45,0.05)]">
                    <span className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-full" style={{ background: KIND_ACCENT[t.kind] || '#94a3b8' }} />
                    {t.kind === 'application' && <span className="inline-block mb-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-brand-accent/10 text-brand-accent">Application</span>}
                    {t.kind === 'call' && <span className="inline-block mb-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-blue-50 text-blue-600">Call</span>}
                    {t.kind === 'recording' && <span className="inline-block mb-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-indigo-50 text-indigo-600">Recording</span>}
                    {t.kind === 'note' && <span className="inline-block mb-1 text-[9px] font-bold uppercase tracking-wide px-1.5 py-[2px] rounded bg-slate-100 text-slate-500">Note</span>}
                    <p className="text-[13px] text-brand-primary whitespace-pre-wrap leading-snug break-words">{body}</p>
                    {media.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {media.map((u: string, mi: number) => {
                          const label = (t.mediaLabels || [])[mi];
                          return (
                            <button key={u} onClick={() => openAttachment({ id: u, filename: label || 'photo', mimeType: 'image/jpeg', size: 0, messageId: '', mailbox: '', url: u })} title={label || 'View photo'}
                              className="block rounded-lg overflow-hidden border border-gray-200 hover:border-brand-accent transition bg-white text-left">
                              <img src={u} alt={label || 'photo'} className="h-24 w-24 object-cover" />
                              {label && <span className="block w-24 px-1 py-0.5 text-[9px] font-semibold text-gray-500 truncate bg-slate-50">{label}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400 mt-1.5">{t.by} · {fmtDT(t.at)}</p>
                  </div>
                );
              })}
            </div>
            <div className="p-3 shrink-0 border-t border-gray-100 bg-slate-50">
              <div className={`rounded-2xl border p-3 transition ${mode === 'text' ? 'border-emerald-400 bg-emerald-50 shadow-[0_3px_14px_rgba(16,185,129,0.18)]' : mode === 'email' ? 'border-sky-400 bg-sky-50 shadow-[0_3px_14px_rgba(14,165,233,0.18)]' : 'border-brand-accent/25 bg-white shadow-[0_3px_14px_rgba(115,128,255,0.13)]'}`}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className={`text-[11px] font-bold uppercase tracking-widest ${mode === 'text' ? 'text-emerald-700' : mode === 'email' ? 'text-sky-700' : 'text-brand-accent'}`}>
                    {mode === 'text' ? `Texting ${lead.firstName || 'customer'}` : mode === 'email' ? `Emailing ${lead.firstName || 'customer'}` : 'Activity & notes'}
                  </h4>
                  <div className="inline-flex rounded-full bg-slate-100 p-0.5 text-[11px] font-bold">
                    <button onClick={() => setMode('note')} className={`px-3 py-1 rounded-full transition ${mode === 'note' ? 'bg-brand-accent text-white shadow-sm' : 'text-gray-500 hover:text-brand-primary'}`}>Note</button>
                    <button onClick={() => setMode('text')} className={`px-3 py-1 rounded-full transition ${mode === 'text' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-500 hover:text-brand-primary'}`}>Text</button>
                    <button onClick={() => setMode('email')} className={`px-3 py-1 rounded-full transition ${mode === 'email' ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-500 hover:text-brand-primary'}`}>Email</button>
                  </div>
                </div>
                {mode === 'text' && (
                  <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold text-emerald-800 bg-emerald-100 rounded-lg px-2.5 py-1.5">
                    <Send className="h-3 w-3 shrink-0" />
                    Real SMS to {lead.phone || 'this lead'} — the customer receives this. Not a private note.
                  </div>
                )}
                {mode === 'email' && (
                  <>
                    <div className="flex items-center gap-1.5 mb-2 text-[11px] font-bold text-sky-800 bg-sky-100 rounded-lg px-2.5 py-1.5">
                      <Mail className="h-3 w-3 shrink-0" />
                      {lead.email ? <>Real email to <b>{lead.email}</b> from your own @drivevac.ca — the customer receives this.</> : <>This lead has no email address — add one in Contact first.</>}
                    </div>
                    <div className="flex gap-2 mb-2">
                      <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject"
                        className="flex-1 h-9 rounded-xl border border-sky-300 bg-white px-3 text-sm font-semibold outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25" />
                      <select value="" onChange={(e) => { const t = templates.find((x) => x.id === e.target.value); if (t) applyTemplate(t); }}
                        className="h-9 max-w-[180px] rounded-xl border border-sky-300 bg-white px-2.5 text-[12px] font-bold text-sky-700 outline-none cursor-pointer">
                        <option value="">{templates.length ? 'Use template…' : 'No templates yet'}</option>
                        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <button onClick={() => setShowTemplates(true)} title="Create / edit templates"
                        className="h-9 w-9 rounded-xl border border-sky-300 bg-white text-sky-600 flex items-center justify-center hover:bg-sky-100 transition"><Pencil className="h-4 w-4" /></button>
                      <input ref={emailFileRef} type="file" multiple className="hidden" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                        onChange={(e) => { const fs = Array.from(e.target.files || []); if (fs.length) setEmailFiles((p) => [...p, ...fs].slice(0, 5)); e.target.value = ''; }} />
                      <button onClick={() => emailFileRef.current?.click()} title="Attach files or photos (up to 5, 20MB each)"
                        className="h-9 w-9 rounded-xl border border-sky-300 bg-white text-sky-600 flex items-center justify-center hover:bg-sky-100 transition"><ImagePlus className="h-4 w-4" /></button>
                    </div>
                    {emailFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {emailFiles.map((f, i) => (
                          <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-white border border-sky-300 text-sky-800 rounded-lg px-2 py-1">
                            📎 {f.name} <span className="text-gray-400">({Math.round(f.size / 1024)} KB)</span>
                            <button onClick={() => setEmailFiles((p) => p.filter((_, j) => j !== i))} className="ml-0.5 text-gray-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-[10px] text-sky-700/80 mb-2">Your Vehicle Approval Centre signature is added automatically.</p>
                  </>
                )}
                <div className="flex gap-2 items-end">
                  {mode === 'text' && smsHref && (
                    <a href={smsHref} title="Photos can't be sent through the Quo API — this opens the conversation in the Quo app so you can attach one there"
                      className="h-10 px-3 shrink-0 rounded-xl border border-emerald-300 bg-white text-emerald-700 text-[12px] font-bold inline-flex items-center gap-1.5 hover:bg-emerald-50 transition whitespace-nowrap">
                      <ImagePlus className="h-4 w-4" />Photo via Quo
                    </a>
                  )}
                  <textarea ref={taRef} value={note} onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && mode !== 'email') { e.preventDefault(); submit(); } }}
                    rows={mode === 'email' ? 5 : 1}
                    placeholder={mode === 'text' ? `Message ${lead.firstName || 'the customer'}…  (Shift+Enter = new line)` : mode === 'email' ? `Write your email to ${lead.firstName || 'the customer'}…` : 'Log a call / text / note…  (Shift+Enter for a new line)'}
                    className={`flex-1 min-h-[40px] ${mode === 'email' ? 'max-h-[360px]' : 'max-h-[200px]'} overflow-y-auto py-2 rounded-xl border bg-white px-3.5 text-sm leading-snug outline-none transition resize-none ${mode === 'text' ? 'border-emerald-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25' : mode === 'email' ? 'border-sky-300 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25' : 'border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20'}`} />
                  <button onClick={submit} disabled={saving || !note.trim() || (mode === 'email' && (!lead.email || !subject.trim()))}
                    className={`h-10 px-4 rounded-xl text-white text-sm font-bold shrink-0 shadow-sm hover:brightness-110 disabled:opacity-40 inline-flex items-center gap-1.5 justify-center transition ${mode === 'text' ? 'bg-emerald-600 shadow-emerald-600/30' : mode === 'email' ? 'bg-sky-600 shadow-sky-600/30' : 'bg-brand-accent shadow-brand-accent/30'}`}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'text' ? <><Send className="h-3.5 w-3.5" />Send SMS</> : mode === 'email' ? <><Mail className="h-3.5 w-3.5" />Send email</> : 'Log'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {showTemplates && <TemplatesModal templates={templates} onClose={() => setShowTemplates(false)} onChanged={loadTemplates} onUse={applyTemplate} />}
      {lightbox && <Lightbox items={lightbox.items} index={lightbox.index} onClose={() => setLightbox(null)} onIndex={(i) => setLightbox({ ...lightbox, index: i })} />}
    </div>
  );
}

// ---- Free to Call Pool view -------------------------------------------------
// Server-paginated + server-searched so it stays fast with 35k+ imported leads.
// Rows are light (no threads); opening one fetches the full lead for the drawer.
type PoolRow = {
  id: string; firstName?: string | null; lastName?: string | null; title?: string | null;
  phone?: string | null; email?: string | null; city?: string | null; province?: string | null;
  lookingFor?: string | null; budget?: string | null; creditSelfRating?: string | null;
  releasedAt?: string | null; releasedFromName?: string | null; releaseStats?: any; poolNote?: string | null;
  addTime?: string | null; source?: string | null;
};
const PROVINCES = ['NL', 'NS', 'NB', 'PE', 'QC', 'ON', 'MB', 'SK', 'AB', 'BC', 'YT', 'NT', 'NU'];
const PoolView: FC<{
  reps: Rep[]; myRepId: string | null; isRep: boolean; stages: Stage[];
  onClaim: (id: string, repId?: string) => Promise<void>;
  onDelete?: (id: string, name: string) => Promise<void>;
  updateLead: (id: string, patch: any) => Promise<void>;
  sendText: (id: string, text: string) => Promise<void>;
  sendEmail: (id: string, subject: string, body: string, files?: File[]) => Promise<boolean>;
}> = ({ reps, myRepId, isRep, stages, onClaim, onDelete, updateLead, sendText, sendEmail }) => {
  const [rows, setRows] = useState<PoolRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [province, setProvince] = useState('');
  const [lookingFor, setLookingFor] = useState('');
  const [credit, setCredit] = useState('');
  const [openLead, setOpenLead] = useState<CrmLead | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const fetchPage = useCallback(async (reset: boolean, cur?: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (cur) params.set('cursor', cur);
      if (q.trim()) params.set('q', q.trim());
      if (province) params.set('province', province);
      if (lookingFor) params.set('lookingFor', lookingFor);
      if (credit) params.set('credit', credit);
      const res = await fetch(`/api/crm/pool?${params}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { window.alert(j.error || 'Failed to load the pool.'); return; }
      setRows((prev) => (reset ? j.rows || [] : [...prev, ...(j.rows || [])]));
      setCursor(j.nextCursor || null); setHasMore(!!j.hasMore);
    } finally { setLoading(false); }
  }, [q, province, lookingFor, credit]);

  // Debounced search / filter changes reset the list.
  useEffect(() => { const t = setTimeout(() => fetchPage(true, null), 350); return () => clearTimeout(t); }, [fetchPage]);

  const open = async (id: string) => {
    setOpeningId(id);
    try {
      const res = await fetch(`/api/crm/lead?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${await token()}` } });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.lead) setOpenLead(j.lead);
    } finally { setOpeningId(null); }
  };
  const claim = async (id: string, repId?: string) => {
    await onClaim(id, repId);
    setOpenLead(null);
    setRows((prev) => prev.filter((r) => r.id !== id));   // it's someone's lead now — drop it from the pool list
  };
  const nm = (r: PoolRow) => [r.firstName, r.lastName].filter(Boolean).join(' ') || r.title || '—';
  const daysIn = (r: PoolRow) => { const at = r.releasedAt; return at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000)) : null; };
  const sel = 'h-10 rounded-full border border-gray-200 bg-white px-3 text-[13px] font-semibold text-brand-primary cursor-pointer shadow-sm outline-none focus:border-brand-accent';

  return (
    <div>
      <header className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="shrink-0">
          <h1 className="text-2xl font-display font-bold text-brand-primary leading-none tracking-tight flex items-center gap-2"><Power className="h-5 w-5 text-orange-500" />Free to Call Pool</h1>
          <p className="text-[13px] text-gray-500 mt-1.5">Unassigned leads anyone can claim — reach the customer and it's yours.</p>
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-accent/70" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, city…"
            className="w-full h-10 rounded-full border border-gray-200 bg-white pl-10 pr-4 text-sm text-brand-primary shadow-sm outline-none transition focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20" />
        </div>
        <select value={province} onChange={(e) => setProvince(e.target.value)} className={sel}>
          <option value="">All provinces</option>{PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={lookingFor} onChange={(e) => setLookingFor(e.target.value)} className={sel}>
          <option value="">Any vehicle</option>{['SUV & Crossover', 'Truck', 'Sedan', 'Minivan', 'SUV', 'Car'].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <select value={credit} onChange={(e) => setCredit(e.target.value)} className={sel}>
          <option value="">Any credit</option>{['Excellent', 'Very good', 'Good', 'Fair', 'Poor', 'No credit / unsure'].map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </header>

      {loading && rows.length === 0 ? (
        <div className="py-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500 font-medium">Nothing matches.</p>
          <p className="text-gray-400 text-sm mt-1">Try a different search, or clear the filters.</p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-3 font-bold">Name</th>
                  <th className="px-4 py-3 font-bold">Vehicle</th>
                  <th className="px-4 py-3 font-bold">Credit</th>
                  <th className="px-4 py-3 font-bold">Phone</th>
                  <th className="px-4 py-3 font-bold">Location</th>
                  <th className="px-4 py-3 font-bold">Previously with</th>
                  <th className="px-4 py-3 font-bold">In pool</th>
                  <th className="px-4 py-3 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mine = !!myRepId && (r as any).releasedFrom === myRepId;
                  const d = daysIn(r);
                  return (
                    <tr key={r.id} onClick={() => open(r.id)} className="border-b border-gray-50 last:border-0 hover:bg-orange-50/40 cursor-pointer">
                      <td className="px-4 py-3 font-bold text-brand-primary whitespace-nowrap">
                        {openingId === r.id ? <Loader2 className="h-4 w-4 animate-spin inline mr-1.5" /> : null}{nm(r)}
                        {r.poolNote && <span className="block text-[11px] font-semibold text-amber-700 mt-0.5 whitespace-normal max-w-[440px] leading-snug">{r.poolNote}</span>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[r.lookingFor, r.budget].filter(Boolean).join(' · ') || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.creditSelfRating || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.phone || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[r.city, r.province].filter(Boolean).join(', ') || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-600">{r.releasedFromName || '—'}{mine && <span className="ml-1.5 text-[9.5px] font-bold uppercase px-1.5 py-[2px] rounded bg-gray-100 text-gray-500">you</span>}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-gray-500">{d == null ? '—' : d === 0 ? 'today' : d >= 60 ? `${Math.round(d / 30)} mo` : `${d}d`}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                        <button disabled={isRep && mine} onClick={() => (isRep ? claim(r.id) : open(r.id))}
                          title={isRep && mine ? "You had this lead — it's here for someone else" : 'Claim'}
                          className="h-8 px-3 rounded-lg bg-orange-500 text-white text-[12px] font-bold hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed">
                          {isRep ? 'Claim' : 'Assign…'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-center gap-3 mt-4">
            {hasMore ? (
              <button onClick={() => fetchPage(false, cursor)} disabled={loading}
                className="h-10 px-5 rounded-xl border border-gray-200 bg-white text-sm font-bold text-brand-primary hover:border-brand-accent disabled:opacity-40 inline-flex items-center gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Load 50 more
              </button>
            ) : <p className="text-[12px] text-gray-400">Showing all {rows.length} matching leads.</p>}
          </div>
        </>
      )}

      {openLead && (
        <Detail lead={openLead} stages={stages} reps={reps} onClose={() => setOpenLead(null)}
          onUpdate={async (patch) => { await updateLead(openLead.id, patch); }}
          onSendText={(t) => sendText(openLead.id, t)}
          onSendEmail={(sj, b, files) => sendEmail(openLead.id, sj, b, files)}
          onClaim={(repId) => claim(openLead.id, repId)}
          myRepId={myRepId} isRep={isRep}
          onDelete={onDelete ? () => { onDelete(openLead.id, nameOf(openLead)); setOpenLead(null); setRows((p) => p.filter((r) => r.id !== openLead.id)); } : undefined}
          onEmailsImported={(entries) => setOpenLead((l) => (l ? { ...l, activityLog: [...(l.activityLog || []), ...entries] } : l))} />
      )}
    </div>
  );
};

// "+ New lead" — quick manual entry for walk-ins / phone-ins / referrals.
const NewLeadModal: FC<{
  reps: Rep[]; myRepId: string | null; isRep: boolean;
  onClose: () => void; onCreated: (lead: CrmLead) => void; onOpenExisting: (id: string) => void;
}> = ({ reps, myRepId, isRep, onClose, onCreated, onOpenExisting }) => {
  const [f, setF] = useState<Record<string, string>>({ owner: myRepId || '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dupe, setDupe] = useState<{ id: string; name: string } | null>(null);
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const inp = 'w-full h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20';
  const lbl = 'block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1';
  const create = async () => {
    setErr(null); setDupe(null);
    const em = (f.email || '').trim();
    if (em && !/^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(em)) { setErr(`"${em}" doesn't look like a valid email — check for typos (e.g. a comma instead of a dot).`); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/crm/lead-create', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(f),
      });
      const j = await res.json().catch(() => ({}));
      if (res.status === 409 && j.existingId) { setDupe({ id: j.existingId, name: j.existingName || 'this customer' }); return; }
      if (!res.ok) { setErr(j.error || 'Failed to create lead.'); return; }
      onCreated(j.lead as CrmLead);
    } catch { setErr('Failed to create lead.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-brand-accent/10 to-transparent">
          <div>
            <h3 className="text-lg font-display font-bold text-brand-primary">New lead</h3>
            <p className="text-[12px] text-gray-500">Walk-in, phone-in, or referral. Only a name + phone/email are required.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-2">Contact</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>First name *</label><input autoFocus className={inp} value={f.firstName || ''} onChange={set('firstName')} /></div>
              <div><label className={lbl}>Last name</label><input className={inp} value={f.lastName || ''} onChange={set('lastName')} /></div>
              <div><label className={lbl}>Phone *</label><input className={inp} type="tel" placeholder="(709) 555-1234" value={f.phone || ''} onChange={set('phone')} /></div>
              <div><label className={lbl}>Email</label><input className={inp} type="email" value={f.email || ''} onChange={set('email')} /></div>
              <div className="col-span-2"><label className={lbl}>Street address</label>
                <div className="grid grid-cols-4 gap-2">
                  <input className={`${inp} col-span-3`} placeholder="67 Oceanic Drive" value={f.street || ''} onChange={set('street')} />
                  <input className={inp} placeholder="Apt / Suite" value={f.suite || ''} onChange={set('suite')} />
                </div>
              </div>
              <div className="col-span-2"><label className={lbl}>City / Province / Postal</label>
                <div className="grid grid-cols-5 gap-2">
                  <input className={`${inp} col-span-2`} placeholder="City" value={f.city || ''} onChange={set('city')} />
                  <select className={inp} value={f.province || ''} onChange={set('province')}>
                    <option value="">Prov.</option>
                    {['NL', 'NS', 'NB', 'PE', 'QC', 'ON', 'MB', 'SK', 'AB', 'BC', 'YT', 'NT', 'NU'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input className={`${inp} col-span-2`} placeholder="Postal code" value={f.postal || ''} onChange={set('postal')} />
                </div>
              </div>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-2">Vehicle &amp; credit</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Looking for</label>
                <select className={inp} value={f.lookingFor || ''} onChange={set('lookingFor')}>
                  <option value="">—</option>
                  {['SUV & Crossover', 'Truck', 'Sedan', 'Minivan', 'Sports car', 'Not sure yet'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Budget</label>
                <select className={inp} value={f.budget || ''} onChange={set('budget')}>
                  <option value="">—</option>
                  {['Under $400 / mo', '$400–500 / mo', '$500–600 / mo', '$600–800 / mo', '$800+ / mo'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Credit self-rating</label>
                <select className={inp} value={f.creditSelfRating || ''} onChange={set('creditSelfRating')}>
                  <option value="">—</option>
                  {['Excellent', 'Good', 'Fair', 'Poor', 'No credit / unsure'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Has trade-in</label>
                <select className={inp} value={f.hasTradeIn || ''} onChange={set('hasTradeIn')}>
                  <option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-accent mb-2">Assignment &amp; source</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Owner</label>
                <select className={inp} value={f.owner || ''} onChange={set('owner')} disabled={isRep}>
                  {!isRep && <option value="">Unassigned (Inbox)</option>}
                  {reps.filter((r) => !r.archived).map((r) => <option key={r.id} value={r.id}>{r.id === myRepId ? `${r.name} (you)` : r.name}</option>)}
                </select>
              </div>
              <div><label className={lbl}>Lead source</label>
                <select className={inp} value={f.leadSource || ''} onChange={set('leadSource')}>
                  <option value="">Manual entry</option>
                  {['Walk-in', 'Phone call', 'Referral', 'Facebook', 'Kijiji', 'Repeat customer', 'Other'].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className="col-span-2"><label className={lbl}>Note (optional)</label>
                <textarea className={`${inp} h-auto py-2 min-h-[64px] resize-none`} placeholder="Anything worth remembering — what they asked about, when to follow up…" value={f.note || ''} onChange={set('note')} />
              </div>
            </div>
          </div>
          {dupe && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
              <b>Already in the CRM:</b> a lead with this phone number exists ({dupe.name}).
              <button onClick={() => onOpenExisting(dupe.id)} className="ml-2 font-bold text-brand-accent hover:underline">Open it →</button>
            </div>
          )}
          {err && <p className="text-[13px] font-semibold text-rose-600">{err}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-slate-50/60 rounded-b-2xl">
          <button onClick={onClose} className="h-10 px-4 rounded-xl text-sm font-bold text-gray-500 hover:text-gray-800">Cancel</button>
          <button onClick={create} disabled={saving || !(f.firstName || f.lastName) || !(f.phone || f.email)}
            className="h-10 px-5 rounded-xl bg-brand-accent text-white text-sm font-bold shadow-sm shadow-brand-accent/30 hover:brightness-110 disabled:opacity-40 inline-flex items-center gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Create lead
          </button>
        </div>
      </div>
    </div>
  );
};

// Shared email templates — anyone on staff can add / edit / delete.
const TemplatesModal: FC<{ templates: { id: string; name: string; subject: string; body: string }[]; onClose: () => void; onChanged: () => void; onUse: (t: { subject: string; body: string }) => void }> = ({ templates, onClose, onChanged, onUse }) => {
  const [editing, setEditing] = useState<{ id?: string; name: string; subject: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const inp = 'w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25';
  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch('/api/crm/email-templates', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(editing) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { window.alert(j.error || 'Failed to save.'); return; }
      setEditing(null); onChanged();
    } finally { setSaving(false); }
  };
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Delete the "${name}" template for everyone?`)) return;
    await fetch('/api/crm/email-templates', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify({ id, remove: true }) });
    onChanged();
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-sky-100 to-transparent">
          <div>
            <h3 className="text-lg font-display font-bold text-brand-primary flex items-center gap-2"><Mail className="h-4 w-4 text-sky-600" />Email templates</h3>
            <p className="text-[12px] text-gray-500">Shared with the whole team. Placeholders: <code className="bg-gray-100 px-1 rounded">{'{{firstName}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{lastName}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{lookingFor}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{budget}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{repName}}'}</code> <code className="bg-gray-100 px-1 rounded">{'{{city}}'}</code></p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="p-6">
          {editing ? (
            <div className="space-y-3">
              <div><label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Template name</label><input autoFocus className={`${inp} h-10`} placeholder="e.g. First intro" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
              <div><label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Subject</label><input className={`${inp} h-10`} placeholder="e.g. Your {{lookingFor}} application with Vehicle Approval Centre" value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></div>
              <div><label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">Body</label><textarea className={`${inp} py-2 min-h-[200px] resize-y`} placeholder={'Hi {{firstName}},\n\nThanks for applying…\n\n{{repName}}\nVehicle Approval Centre'} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={save} disabled={saving || !editing.name.trim() || !editing.subject.trim() || !editing.body.trim()} className="h-10 px-4 rounded-xl bg-sky-600 text-white text-sm font-bold disabled:opacity-40 hover:brightness-110 inline-flex items-center gap-2">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Save template</button>
                <button onClick={() => setEditing(null)} className="h-10 px-4 rounded-xl text-sm font-bold text-gray-500 hover:text-gray-800">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <button onClick={() => setEditing({ name: '', subject: '', body: '' })} className="h-10 px-4 rounded-xl bg-sky-600 text-white text-sm font-bold hover:brightness-110 inline-flex items-center gap-1.5 mb-4"><Plus className="h-4 w-4" />New template</button>
              {templates.length === 0 ? <p className="text-sm text-gray-400">No templates yet — create the first one.</p> : (
                <div className="space-y-2">
                  {templates.map((t) => (
                    <div key={t.id} className="rounded-xl border border-gray-100 p-3 flex items-start gap-3 hover:border-sky-200 transition">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-brand-primary text-sm">{t.name}</p>
                        <p className="text-[12px] text-gray-600 truncate"><b>Subject:</b> {t.subject}</p>
                        <p className="text-[12px] text-gray-400 line-clamp-2 mt-0.5 whitespace-pre-wrap">{t.body}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => { onUse(t); onClose(); }} className="h-8 px-3 rounded-lg bg-sky-50 text-sky-700 text-[12px] font-bold hover:bg-sky-100">Use</button>
                        <button onClick={() => setEditing({ id: t.id, name: t.name, subject: t.subject, body: t.body })} className="h-8 w-8 rounded-lg text-gray-400 hover:text-sky-600 flex items-center justify-center" title="Edit"><Pencil className="h-4 w-4" /></button>
                        <button onClick={() => remove(t.id, t.name)} className="h-8 w-8 rounded-lg text-gray-300 hover:text-red-500 flex items-center justify-center" title="Delete"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const Card: FC<{ lead: CrmLead; onClick: () => void; onDragStart: () => void }> = ({ lead, onClick, onDragStart }) => {
  const tier = ageTier(lead);
  const days = ageDays(lead);
  return (
    <div draggable onDragStart={onDragStart} onClick={onClick}
      className={`group rounded-lg border p-2.5 cursor-pointer transition hover:border-brand-accent/60 hover:shadow-md shadow-[0_1px_2px_rgba(20,21,45,0.04)] ${tier ? `${tier.bg} ${tier.border}` : 'bg-white border-gray-200/70'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-brand-primary text-[13px] leading-snug">{nameOf(lead)}</p>
        {tier && days != null && (
          <span title={`${tier.label} — ${tier.hint}`} className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-[2px] rounded-md ${tier.text} bg-white/70 border ${tier.border}`}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: tier.dot }} />{days}d
          </span>
        )}
      </div>
      <p className="text-[11px] text-gray-500 mt-0.5 leading-snug truncate">{[lead.lookingFor, lead.budget].filter(Boolean).join(' · ') || '—'}</p>
      {lead.lostReason && (
        <span className="inline-block mt-1.5 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded-md bg-rose-50 text-rose-600">{lead.lostReason}</span>
      )}
      {(lead as any).tradeSubmittedAt && (
        <span className="inline-block mt-1.5 mr-1 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded-md bg-emerald-50 text-emerald-700" title="Customer submitted their trade-in appraisal">🚗 trade-in</span>
      )}
      {(lead as any).bouncedAt && (lead.stage || 'new_lead') === 'new_lead' && (
        <span className="inline-block mt-1.5 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded-md bg-orange-50 text-orange-600" title={`Bounced from ${(lead as any).bouncedFromName || 'another rep'} after sitting 30 min — call now`}>⚡ bounced</span>
      )}
      {lead.stage === 'lost' && (lead as any).nurtureAt && (
        <span className="inline-block mt-1.5 ml-1 text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded-md bg-amber-50 text-amber-700" title="Sleeps in Nurture, then returns to the Free-to-Call pool">⏰ {fmt((lead as any).nurtureAt)}</span>
      )}
      <div className="flex items-center justify-between gap-2 mt-2">
        {lead.creditSelfRating
          ? <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-[3px] rounded-md bg-gray-100 text-gray-600 shrink-0">{lead.creditSelfRating}</span>
          : <span />}
        {lead.owner
          ? <span className="text-[11px] text-gray-500 flex items-center gap-1 truncate"><User className="h-3 w-3 shrink-0" />{lead.ownerName || 'Assigned'}</span>
          : <span className="text-[9.5px] font-bold uppercase tracking-wide text-amber-600 flex items-center gap-1 shrink-0"><Circle className="h-1.5 w-1.5 fill-amber-500 text-amber-500" />Pool</span>}
      </div>
    </div>
  );
};

export default function CrmPanel({ role, mode = 'crm' }: { role?: string; mode?: 'crm' | 'pool' | 'inbox' }) {
  const isRep = role === 'sales_rep';
  const [leads, setLeads] = useState<CrmLead[] | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [myRepId, setMyRepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CrmLead | null>(null);
  const [ownerFilter, setOwnerFilter] = useState<string>('all'); // 'all' | a rep id
  const [q, setQ] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [lostPrompt, setLostPrompt] = useState<{ id: string; reason?: string; date?: string; noFollowUp?: boolean; note?: string } | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  // List-view column sort — click a header to sort by it, click again to flip direction.
  type SortKey = 'name' | 'stage' | 'owner' | 'credit' | 'vehicle' | 'phone' | 'location' | 'added';
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'added' ? 'desc' : 'asc'); }
  };

  // Deep link: /admin?tab=crm&lead=<id> opens that lead on load (used by rep SMS heads-ups).
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current || !leads) return;
    const id = new URLSearchParams(window.location.search).get('lead');
    if (!id) { deepLinkDone.current = true; return; }
    const l = leads.find((x) => x.id === id);
    if (l) { setSelected(l); deepLinkDone.current = true;
      try { const u = new URL(window.location.href); u.searchParams.delete('lead'); window.history.replaceState({}, '', u.toString()); } catch {} }
  }, [leads]);

  const load = useCallback(async () => {
    const res = await fetch('/api/crm/leads', { headers: { Authorization: `Bearer ${await token()}` } });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || 'Failed to load CRM leads.');
    setLeads(j.leads || []);
    setStages(j.stages || []);
    setReps(j.reps || []);
    setMyRepId(j.myRepId || null);
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message || 'Failed to load.')); }, [load]);

  // Optimistic local patch + server write.
  const updateLead = useCallback(async (id: string, patch: { stage?: string; owner?: string | null; ownerName?: string | null; note?: string; lostReason?: string; nurtureAt?: string | null; lostNote?: string; fields?: Record<string, string | null> }) => {
    // Moving to "Lost" always needs a reason — pop the picker first.
    if (patch.stage === 'lost' && patch.lostReason === undefined) { setLostPrompt({ id }); return; }
    const apply = (l: CrmLead): CrmLead => ({
      ...l,
      ...(patch.stage !== undefined ? { stage: patch.stage, ...(patch.stage !== 'lost' ? { lostReason: null } : {}), ...(patch.stage === 'attempting_contact' && l.stage !== 'attempting_contact' ? { lastAttemptAt: new Date().toISOString(), ...(!(l as any).attemptingSince ? { attemptingSince: new Date().toISOString() } : {}) } : {}) } : {}),
      ...(patch.note ? { lastAttemptAt: new Date().toISOString() } : {}),
      ...(patch.lostReason !== undefined ? { lostReason: patch.lostReason } : {}),
      ...(patch.owner !== undefined ? { owner: patch.owner, ownerName: patch.ownerName ?? null } : {}),
      ...(patch.note ? { activityLog: [...(l.activityLog || []), { text: patch.note, by: auth.currentUser?.displayName || 'you', at: new Date().toISOString(), kind: 'note' }] } : {}),
      ...(patch.fields || {}),
    });
    setLeads((prev) => prev && prev.map((l) => (l.id === id ? apply(l) : l)));
    setSelected((s) => (s && s.id === id ? apply(s) : s));
    const res = await fetch('/api/crm/lead-update', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); window.alert(j.error || 'Update failed.'); await load(); }
  }, [load]);

  // Send an SMS to the lead through Quo, then show it in the thread immediately.
  const sendText = useCallback(async (id: string, text: string) => {
    const res = await fetch('/api/crm/send-text', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ leadId: id, text }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { window.alert(j.error || 'Failed to send text.'); return; }
    const entry = j.entry || { text: `💬 Text sent: ${text}`, by: 'you', at: new Date().toISOString() };
    setLeads((prev) => prev && prev.map((l) => (l.id === id ? { ...l, activityLog: [...(l.activityLog || []), entry] } : l)));
    setSelected((s) => (s && s.id === id ? { ...s, activityLog: [...(s.activityLog || []), entry] } : s));
  }, []);

  // Send an email as the signed-in rep (Gmail delegation), then show it in the thread.
  const sendEmail = useCallback(async (id: string, subject: string, body: string, files?: File[]): Promise<boolean> => {
    const fd = new FormData();
    fd.append('leadId', id); fd.append('subject', subject); fd.append('body', body);
    for (const f of files || []) fd.append('files', f, f.name);
    const res = await fetch('/api/crm/send-email', {
      method: 'POST', headers: { Authorization: `Bearer ${await token()}` },
      body: fd,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { window.alert(j.error || 'Failed to send email.'); return false; }
    const entry = j.entry || { text: `📧 Email sent — ${subject}`, by: 'you', at: new Date().toISOString(), kind: 'email' };
    setLeads((prev) => prev && prev.map((l) => (l.id === id ? { ...l, activityLog: [...(l.activityLog || []), entry] } : l)));
    setSelected((s) => (s && s.id === id ? { ...s, activityLog: [...(s.activityLog || []), entry] } : s));
    return true;
  }, []);

  // Free-to-Call pool: claim a released lead (rep → self; admin → chosen rep).
  const claimLead = useCallback(async (id: string, repId?: string) => {
    const res = await fetch('/api/crm/claim', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ leadId: id, repId }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { window.alert(j.error || 'Failed to claim lead.'); return; }
    setSelected(null);
    await load();
  }, [load]);

  // Delete a lead outright (admins only; junk/test/dupes). Confirms first.
  const deleteLead = useCallback(async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" permanently?\n\nThis is for junk/test/duplicate leads. If it's a real customer who said no, mark them Lost instead so they come back via Nurture.`)) return;
    const res = await fetch('/api/crm/lead-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ leadId: id }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { window.alert(j.error || 'Failed to delete.'); return; }
    setSelected(null);
    setLeads((prev) => prev && prev.filter((l) => l.id !== id));
  }, []);

  const toggleRep = async (r: Rep) => {
    if (!r.id) return;
    const next = !r.active;
    setReps((prev) => prev.map((x) => (x.id === r.id ? { ...x, active: next } : x)));
    const res = await fetch('/api/crm/rep-active', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` },
      body: JSON.stringify({ repId: r.id, active: next }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); window.alert(j.error || 'Failed to update rep status.'); await load(); }
  };

  // Board = live pipeline only. Lost leads park in Nurture (managers) and resurface via the Free-to-Call pool;
  // free_to_call has its own tab. Neither is a board column.
  const boardStages = useMemo(() => stages.filter((st) => st.key !== 'free_to_call' && st.key !== 'lost'), [stages]);
  const byStage = useMemo(() => {
    const s = q.trim().toLowerCase();
    const matchesQ = (l: CrmLead) => !s || [nameOf(l), l.phone, l.email, l.city, l.province, l.postal, l.employer, l.jobTitle, l.lookingFor, l.budget, l.creditSelfRating]
      .filter(Boolean).join(' ').toLowerCase().includes(s);
    const map: Record<string, CrmLead[]> = {};
    stages.forEach((st) => (map[st.key] = []));
    (leads || [])
      .filter((l) => !!l.owner && l.stage !== 'free_to_call' && l.stage !== 'lost')   // board = assigned, live leads only
      .filter((l) => (ownerFilter === 'all' ? true : (l.owner || '') === ownerFilter))
      .filter(matchesQ)
      .forEach((l) => { const k = l.stage || 'new_lead'; (map[k] = map[k] || []).push(l); });
    return map;
  }, [leads, stages, ownerFilter, q]);

  // Flat, filtered — newest-first by default; the list view lets you sort any column.
  const sortValue = (l: CrmLead, key: SortKey): string => {
    switch (key) {
      case 'name': return nameOf(l).toLowerCase();
      case 'stage': return (stages.find((s) => s.key === (l.stage || 'new_lead'))?.label || l.stage || '').toLowerCase();
      case 'owner': return (l.ownerName || '').toLowerCase();
      case 'credit': return (l.creditSelfRating || '').toLowerCase();
      case 'vehicle': return [l.lookingFor, l.budget].filter(Boolean).join(' ').toLowerCase();
      case 'phone': return (l.phone || '').replace(/\D/g, '');
      case 'location': return [l.city, l.province].filter(Boolean).join(' ').toLowerCase();
      case 'added': default: return l.addTime || '';
    }
  };
  const visibleLeads = useMemo(() => {
    const s = q.trim().toLowerCase();
    const matchesQ = (l: CrmLead) => !s || [nameOf(l), l.phone, l.email, l.city, l.province, l.postal, l.employer, l.jobTitle, l.lookingFor, l.budget, l.creditSelfRating]
      .filter(Boolean).join(' ').toLowerCase().includes(s);
    return (leads || [])
      .filter((l) => !!l.owner && l.stage !== 'free_to_call' && l.stage !== 'lost')
      .filter((l) => (ownerFilter === 'all' ? true : (l.owner || '') === ownerFilter))
      .filter(matchesQ)
      .sort((a, b) => {
        if (view !== 'list') return String(b.addTime || '').localeCompare(String(a.addTime || ''));
        const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
        const cmp = av.localeCompare(bv, undefined, { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [leads, ownerFilter, q, view, sortKey, sortDir, stages]);

  const activeCount = reps.filter((r) => r.active).length;
  const myRep: Rep = reps.find((r) => r.id === myRepId) || { id: myRepId || '', name: auth.currentUser?.displayName || 'You', active: false };
  const myActive = !!myRep.active;

  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-red-700"><p className="font-bold">Couldn’t load CRM</p><p className="text-sm mt-1">{error}</p></div>;
  if (!leads) return <div className="py-20 text-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>;

  // ---- Inbox (admins): unassigned new leads waiting to be dispersed. Same drawer; Assign + Delete. ----
  if (mode === 'inbox') {
    const s = q.trim().toLowerCase();
    const inboxLeads = (leads || [])
      .filter((l) => !l.owner && (l.stage || 'new_lead') === 'new_lead')
      .filter((l) => !s || [nameOf(l), l.phone, l.email, l.city, l.province, l.lookingFor, l.budget].filter(Boolean).join(' ').toLowerCase().includes(s))
      .sort((a, b) => String(b.addTime || '').localeCompare(String(a.addTime || '')));
    const assign = async (l: CrmLead, repId: string) => {
      const r = reps.find((x) => x.id === repId); if (!r) return;
      await updateLead(l.id, { owner: r.id, ownerName: r.name });
    };
    return (
      <div>
        <header className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="shrink-0">
            <h1 className="text-2xl font-display font-bold text-brand-primary leading-none tracking-tight flex items-center gap-2">Inbox <span className="text-[12px] font-bold text-white bg-brand-accent rounded-full px-2 py-0.5">{inboxLeads.length}</span></h1>
            <p className="text-[13px] text-gray-500 mt-1.5">New website leads waiting to be assigned. Reps don't see these until you disperse them (active reps get them automatically in rotation).</p>
          </div>
          <div className="relative flex-1 min-w-[160px] max-w-xl mx-auto">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-accent/70" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email, city…"
              className="w-full h-10 rounded-full border border-gray-200 bg-white pl-10 pr-4 text-sm text-brand-primary shadow-sm outline-none transition focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20" />
          </div>
        </header>
        {inboxLeads.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
            <p className="text-gray-500 font-medium">Inbox is clear.</p>
            <p className="text-gray-400 text-sm mt-1">New applications land here and go to active reps automatically.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                  <th className="px-4 py-3 font-bold">Name</th>
                  <th className="px-4 py-3 font-bold">Contact</th>
                  <th className="px-4 py-3 font-bold">Vehicle</th>
                  <th className="px-4 py-3 font-bold">Credit</th>
                  <th className="px-4 py-3 font-bold">Location</th>
                  <th className="px-4 py-3 font-bold">Received</th>
                  <th className="px-4 py-3 font-bold text-right">Assign to</th>
                  <th className="px-4 py-3 font-bold"></th>
                </tr>
              </thead>
              <tbody>
                {inboxLeads.map((l) => (
                  <tr key={l.id} onClick={() => setSelected(l)} className="border-b border-gray-50 last:border-0 hover:bg-slate-50/70 cursor-pointer">
                    <td className="px-4 py-3 font-bold text-brand-primary whitespace-nowrap">{nameOf(l)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[l.phone, l.email].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[l.lookingFor, l.budget].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{l.creditSelfRating || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[l.city, l.province].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{fmt(l.addTime)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      <select defaultValue="" onChange={(e) => { if (e.target.value) assign(l, e.target.value); }}
                        className="h-9 rounded-xl border border-gray-200 bg-white px-2.5 text-[13px] font-semibold text-brand-primary outline-none cursor-pointer focus:border-brand-accent">
                        <option value="" disabled>Assign to…</option>
                        {reps.filter((r) => !(r as any).archived).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-right" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => deleteLead(l.id, nameOf(l))} title="Delete (junk / test / duplicate)" className="h-9 w-9 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 inline-flex items-center justify-center transition"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {selected && (
          <Detail lead={selected} stages={stages} reps={reps} onClose={() => setSelected(null)}
            onUpdate={(patch) => updateLead(selected.id, patch)}
            onSendText={(t) => sendText(selected.id, t)}
            onSendEmail={(sj, b, files) => sendEmail(selected.id, sj, b, files)}
            myRepId={myRepId}
            isRep={isRep}
            onDelete={() => deleteLead(selected.id, nameOf(selected))}
            onEmailsImported={(entries) => {
              const id = selected.id;
              setLeads((prev) => prev && prev.map((l) => (l.id === id ? { ...l, activityLog: [...(l.activityLog || []), ...entries] } : l)));
              setSelected((s2) => (s2 && s2.id === id ? { ...s2, activityLog: [...(s2.activityLog || []), ...entries] } : s2));
            }} />
        )}
      </div>
    );
  }

  // ---- Free to Call Pool: server-paginated + server-side search (scales to 35k+ archive leads) ----
  if (mode === 'pool') {
    return (
      <PoolView
        reps={reps} myRepId={myRepId} isRep={isRep} stages={stages}
        onClaim={claimLead} onDelete={!isRep ? deleteLead : undefined}
        updateLead={updateLead} sendText={sendText} sendEmail={sendEmail} />
    );
  }

  return (
    <div>
      <header className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="shrink-0">
          <h1 className="text-2xl font-display font-bold text-brand-primary leading-none tracking-tight">CRM</h1>
          <p className="text-[13px] text-gray-500 mt-1.5">One board, every lead — your own pipeline.</p>
        </div>
        <div className="relative flex-1 min-w-[160px] max-w-xl mx-auto">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-brand-accent/70" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads…"
            className="w-full h-10 rounded-full border border-gray-200 bg-white pl-10 pr-4 text-sm text-brand-primary shadow-sm outline-none transition focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setShowNewLead(true)}
            className="h-10 px-4 rounded-full bg-brand-accent text-white text-[13px] font-bold inline-flex items-center gap-1.5 shadow-sm shadow-brand-accent/30 hover:brightness-110 transition shrink-0">
            <Plus className="h-4 w-4" />New lead
          </button>
          <div className="inline-flex rounded-full border border-gray-200 overflow-hidden shrink-0 shadow-sm">
            <button onClick={() => setView('board')} title="Board view"
              className={`h-10 w-10 flex items-center justify-center transition ${view === 'board' ? 'bg-brand-accent text-white' : 'bg-white text-gray-400 hover:text-brand-primary'}`}><LayoutGrid className="h-4 w-4" /></button>
            <button onClick={() => setView('list')} title="List view"
              className={`h-10 w-10 flex items-center justify-center transition ${view === 'list' ? 'bg-brand-accent text-white' : 'bg-white text-gray-400 hover:text-brand-primary'}`}><List className="h-4 w-4" /></button>
          </div>
          <Filter className="h-4 w-4 text-brand-accent/70 shrink-0" />
          <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-10 max-w-[180px] shrink-0 rounded-full border border-gray-200 bg-white px-3.5 text-[13px] font-semibold text-brand-primary cursor-pointer shadow-sm outline-none transition focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20">
            <option value="all">Everyone’s leads</option>
            {myRepId && reps.some((r) => r.id === myRepId) && <option value={myRepId}>My leads</option>}
            <option disabled>──────────</option>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>{r.id === myRepId ? `${r.name} (you)` : r.name}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Presence. A rep gets a big, unmissable Go-Active switch; admins get the full team bar. */}
      {isRep ? (
        <div className={`mb-4 rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${myActive ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
          <div className="flex items-center gap-3">
            <span className={`h-11 w-11 rounded-full flex items-center justify-center shrink-0 ${myActive ? 'bg-emerald-500' : 'bg-amber-400'}`}>
              <Power className="h-5 w-5 text-white" />
            </span>
            <div>
              <p className="font-bold text-brand-primary text-base leading-tight">{myActive ? 'You’re active — receiving leads' : 'You’re not receiving leads'}</p>
              <p className="text-[13px] text-gray-600 mt-0.5">{myActive ? 'New leads are being routed to you in the rotation.' : 'Go active at the start of your shift to join the lead rotation.'}</p>
            </div>
          </div>
          <button onClick={() => toggleRep(myRep)}
            className={`h-11 px-5 rounded-xl font-bold text-sm shrink-0 transition ${myActive ? 'bg-white border border-emerald-300 text-emerald-700 hover:bg-emerald-100' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/30'}`}>
            {myActive ? 'Go inactive' : 'Go Active'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 flex-wrap mb-4 rounded-xl border border-gray-200/70 bg-white px-3 py-2">
          <span className="text-[12px] font-bold text-brand-primary flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-brand-accent" />Sales team</span>
          <span className="text-[11px] text-gray-400">{activeCount} active</span>
          <span className="h-4 w-px bg-gray-200" />
          {reps.length === 0 && <span className="text-[11px] text-gray-400">No reps found.</span>}
          {reps.map((r) => {
            const on = !!r.active;
            return (
              <button key={r.id} onClick={() => toggleRep(r)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${on ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-200 bg-white text-gray-400 hover:text-gray-600'}`}>
                <Circle className={`h-2 w-2 ${on ? 'fill-emerald-500 text-emerald-500' : 'fill-gray-300 text-gray-300'}`} />
                {r.name}
              </button>
            );
          })}
          <span className="text-[11px] text-gray-400 ml-auto hidden xl:block">Only active reps get leads · idle leads pool under {MASTER}</span>
        </div>
      )}

      {leads.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center">
          <p className="text-gray-500 font-medium">No leads yet.</p>
          <p className="text-gray-400 text-sm mt-1">New applications will appear here automatically.</p>
        </div>
      ) : view === 'list' ? (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-x-auto">
          <table className="w-full text-sm min-w-[920px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-widest text-gray-400 border-b border-gray-100">
                {([
                  ['name', 'Name'], ['stage', 'Stage'], ['owner', 'Owner'], ['credit', 'Credit'],
                  ['vehicle', 'Vehicle'], ['phone', 'Phone'], ['location', 'Location'], ['added', 'Created'],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <th key={key} className="px-4 py-3 font-bold select-none">
                    <button onClick={() => toggleSort(key)} className="inline-flex items-center gap-1 hover:text-brand-primary transition">
                      {label}
                      {sortKey === key
                        ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-brand-accent" /> : <ArrowDown className="h-3 w-3 text-brand-accent" />)
                        : <ArrowUpDown className="h-3 w-3 text-gray-300" />}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleLeads.map((l) => {
                const st = stages.find((s) => s.key === (l.stage || 'new_lead'));
                return (
                  <tr key={l.id} onClick={() => setSelected(l)} className="border-b border-gray-50 last:border-0 hover:bg-slate-50/70 cursor-pointer">
                    <td className="px-4 py-3 font-bold text-brand-primary whitespace-nowrap">{nameOf(l)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand-primary">
                        <span className="h-2 w-2 rounded-full" style={{ background: STAGE_DOT[l.stage || 'new_lead'] || '#9ca3af' }} />{st?.label || l.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{l.ownerName || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{l.creditSelfRating || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[l.lookingFor, l.budget].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{l.phone || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{[l.city, l.province].filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-500">{fmt(l.addTime)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
          {boardStages.map((s) => {
            const count = byStage[s.key]?.length || 0;
            return (
              <div key={s.key}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId) { updateLead(dragId, { stage: s.key }); setDragId(null); } }}
                className="flex-shrink-0 w-[272px] rounded-2xl bg-slate-50 border border-gray-200/70 flex flex-col shadow-sm">
                <div className="rounded-t-2xl bg-white border-b border-gray-200/50">
                  <div className="flex items-center gap-2 px-3.5 py-3">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: STAGE_DOT[s.key] || '#9ca3af' }} />
                    <h3 className="text-[13px] font-bold text-brand-primary tracking-tight">{s.label}</h3>
                    <span className="ml-auto min-w-[22px] text-center text-[11px] font-bold text-brand-accent bg-brand-accent/10 rounded-full px-1.5 py-0.5">{count}</span>
                  </div>
                  {s.key === 'attempting_contact' && (
                    <div className="flex items-center gap-2 px-3.5 pb-2 -mt-1" title={`Cards colour by business days here. After ${FREE_TO_CALL_BDAYS} business days a lead goes back to the pool.`}>
                      {AGE_TIERS.filter((t) => t.key !== 'released').map((t, i) => (
                        <span key={t.key} title={`${t.label} — ${t.hint}`} className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-gray-600 cursor-default">
                          <span className="h-3 w-3 rounded-full shadow-sm" style={{ background: t.dot }} />
                          Day {i + 1}
                        </span>
                      ))}
                      <span className="ml-auto text-[10px] text-gray-400 whitespace-nowrap" title="After 3 business days the lead moves to the Free to Call Pool tab">→ Free to Call</span>
                    </div>
                  )}
                </div>
                <div className="px-2 pb-2.5 space-y-2 flex-1 min-h-[64vh]">
                  {(byStage[s.key] || []).map((l: CrmLead) => (
                    <Card key={l.id} lead={l} onClick={() => setSelected(l)} onDragStart={() => setDragId(l.id)} />
                  ))}
                </div>
              </div>
            );
          })}
          {/* Drop zone: drag a card here to mark it Lost (it leaves the board → Nurture). */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId) { updateLead(dragId, { stage: 'lost' }); setDragId(null); } }}
            className={`flex-shrink-0 w-[200px] rounded-2xl border-2 border-dashed flex flex-col transition ${dragId ? 'border-rose-400 bg-rose-50' : 'border-gray-300 bg-slate-50'}`}>
            <div className="flex items-center gap-2 px-3.5 py-3 border-b border-dashed border-gray-200">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: STAGE_DOT.lost }} />
              <h3 className="text-[13px] font-bold text-brand-primary tracking-tight">Lost</h3>
            </div>
            <div className={`flex-1 min-h-[64vh] flex flex-col items-center justify-center text-center px-4 ${dragId ? 'text-rose-600' : 'text-gray-400'}`}>
              <p className="text-[12px] font-semibold">{dragId ? 'Drop to mark lost' : 'Drag a lead here'}</p>
              <p className="text-[11px] mt-1.5 leading-snug">It leaves the board, sleeps in Nurture, and comes back via the Free-to-Call pool.</p>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <Detail lead={selected} stages={stages} reps={reps} onClose={() => setSelected(null)}
          onUpdate={(patch) => updateLead(selected.id, patch)}
          onSendText={(t) => sendText(selected.id, t)}
          onSendEmail={(sj, b, files) => sendEmail(selected.id, sj, b, files)}
          onClaim={(repId) => claimLead(selected.id, repId)}
          myRepId={myRepId}
          isRep={isRep}
          onDelete={!isRep ? () => deleteLead(selected.id, nameOf(selected)) : undefined}
          onEmailsImported={(entries) => {
            const id = selected.id;
            setLeads((prev) => prev && prev.map((l) => (l.id === id ? { ...l, activityLog: [...(l.activityLog || []), ...entries] } : l)));
            setSelected((s) => (s && s.id === id ? { ...s, activityLog: [...(s.activityLog || []), ...entries] } : s));
          }} />
      )}

      {showNewLead && (
        <NewLeadModal reps={reps} myRepId={myRepId} isRep={isRep} onClose={() => setShowNewLead(false)}
          onCreated={(lead) => {
            setShowNewLead(false);
            setLeads((prev) => [lead, ...(prev || [])]);
            setSelected(lead);
          }}
          onOpenExisting={(id) => {
            setShowNewLead(false);
            const ex = (leads || []).find((l) => l.id === id);
            if (ex) setSelected(ex);
          }} />
      )}
      {lostPrompt && (() => {
        const reason = lostPrompt.reason;
        const def = reason ? NURTURE_DEFAULT_DAYS[reason] : undefined;
        const toISODate = (d: Date) => d.toISOString().slice(0, 10);
        const pick = (r: string) => {
          const dd = NURTURE_DEFAULT_DAYS[r];
          const date = dd ? toISODate(new Date(Date.now() + dd * 86_400_000)) : '';
          setLostPrompt({ ...lostPrompt, reason: r, date, noFollowUp: dd === null && r === 'Bad / wrong number' });
        };
        const confirm = () => {
          const id = lostPrompt.id;
          const nurtureAt = lostPrompt.noFollowUp || !lostPrompt.date ? null : new Date(lostPrompt.date + 'T14:00:00').toISOString();
          setLostPrompt(null);
          updateLead(id, { stage: 'lost', lostReason: reason, nurtureAt, lostNote: (lostPrompt.note || '').trim() || undefined });
        };
        const needsDate = reason === 'Other' && !lostPrompt.noFollowUp && !lostPrompt.date;
        const needsNote = reason === 'Other' && !(lostPrompt.note || '').trim();
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4" onClick={() => setLostPrompt(null)}>
            <div className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-brand-primary">Why is this lead lost?</h3>
              <p className="text-[12px] text-gray-500 mt-0.5 mb-3">It won't be deleted — it sleeps in Nurture and comes back to the Free-to-Call pool on the wake-up date.</p>
              <div className="space-y-2">
                {LOST_REASONS.map((r) => (
                  <button key={r} onClick={() => pick(r)}
                    className={`w-full text-left px-3 py-2 rounded-lg border text-[13px] font-semibold transition ${reason === r ? 'border-brand-accent bg-brand-accent/10 text-brand-primary' : 'border-gray-200 text-brand-primary hover:border-brand-accent hover:bg-brand-accent/5'}`}>
                    {r}
                  </button>
                ))}
              </div>
              {reason && (
                <div className="mt-3">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
                    What happened? {reason === 'Other' ? <span className="text-rose-500">(required)</span> : <span className="text-gray-300">(optional — helps whoever calls next)</span>}
                  </label>
                  <textarea autoFocus={reason === 'Other'} value={lostPrompt.note || ''} onChange={(e) => setLostPrompt({ ...lostPrompt, note: e.target.value })}
                    placeholder={reason === 'Other' ? 'e.g. moving out of province in June — call back after' : reason === 'Not approved' ? 'e.g. needs a co-signer, income too low right now' : reason === 'Bought elsewhere' ? 'e.g. got a 2021 RAV4 at Steele — trade-in candidate' : reason === 'Not interested' ? 'e.g. said "not right now", tax return in April' : 'e.g. number goes to a pizza place'}
                    className={`w-full min-h-[64px] rounded-xl border bg-white px-3 py-2 text-sm outline-none resize-none transition ${needsNote ? 'border-rose-400 focus:ring-2 focus:ring-rose-300' : 'border-gray-200 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20'}`} />
                </div>
              )}
              {reason && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700">⏰ Wake up &amp; retry</p>
                  <p className="text-[11px] text-amber-800/80 mt-0.5 mb-2">{NURTURE_WHY[reason]}</p>
                  {!lostPrompt.noFollowUp && (
                    <input type="date" value={lostPrompt.date || ''} min={toISODate(new Date())}
                      onChange={(e) => setLostPrompt({ ...lostPrompt, date: e.target.value })}
                      className={`w-full h-9 rounded-lg border bg-white px-2.5 text-sm outline-none ${needsDate ? 'border-rose-400 focus:ring-2 focus:ring-rose-300' : 'border-amber-300 focus:border-brand-accent focus:ring-2 focus:ring-brand-accent/20'}`} />
                  )}
                  {needsDate && <p className="text-[11px] text-rose-600 font-semibold mt-1">Pick a wake-up date — or tick “no follow-up”.</p>}
                  <label className="flex items-center gap-2 mt-2 text-[12px] text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={!!lostPrompt.noFollowUp} onChange={(e) => setLostPrompt({ ...lostPrompt, noFollowUp: e.target.checked })} />
                    No follow-up — this lead is dead
                  </label>
                </div>
              )}
              <div className="flex items-center justify-between mt-4">
                <button onClick={() => setLostPrompt(null)} className="text-[12px] text-gray-400 hover:text-gray-600 font-semibold">Cancel</button>
                <button onClick={confirm} disabled={!reason || needsDate || needsNote}
                  className="h-9 px-4 rounded-xl bg-brand-primary text-white text-[13px] font-bold disabled:opacity-40 hover:brightness-110">
                  Mark lost
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
