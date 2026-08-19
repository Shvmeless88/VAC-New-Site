import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

const PIPEDRIVE_BASE = 'https://api.pipedrive.com/v1';
const APP_ID_FIELD_KEY =
  process.env.PIPEDRIVE_APPLICATION_ID_FIELD_KEY ||
  '43a9d5f5592e07c8b7fb771e4df6a767f188130f';

export interface AppraisalPhoto {
  /** Slug identifying which shot this is, e.g. "front", "vin", "damage-1". */
  slot: string;
  originalName: string;
  mimetype: string;
  buffer: Buffer;
}

export interface AppraisalDetails {
  applicationId: string;
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  /** Exact odometer reading, digits only — the appraisal is booked on this. */
  kilometers?: string;
  /**
   * Safety-inspection sticker EXPIRY (e.g. "March 2027"), not the inspection
   * date. The expiry is what's printed on the sticker, so it's the only one a
   * customer can read off their own windshield without guessing.
   */
  inspectionExpiry?: string;
  vin?: string;
  notes?: string;
}

/**
 * Pipedrive renders note content as HTML, so anything a customer typed has to be
 * escaped before it goes in. Without this, a submission containing markup would
 * store executable HTML inside our own sales team's CRM.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Strip anything that isn't safe in a filename we hand to Pipedrive. */
function safeSegment(value: string, max = 40): string {
  const cleaned = String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '');
  return cleaned.slice(0, max) || 'photo';
}

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);

/**
 * Verify the bytes really are an image. The MIME type on an upload is supplied
 * by the client and can say anything, so it proves nothing on its own.
 */
export function isRealImage(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) return false;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.subarray(0, 8).equals(PNG)) return true;

  // GIF87a / GIF89a
  const head6 = buffer.subarray(0, 6).toString('ascii');
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return true;

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return true;
  }

  // HEIC/HEIF (iPhone default): an "ftyp" box at offset 4
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return true;

  return false;
}

function formatKm(km?: string): string {
  if (!km) return '—';
  const n = Number(String(km).replace(/\D/g, ''));
  return Number.isFinite(n) && n > 0 ? `${n.toLocaleString('en-CA')} km` : '—';
}

const MONTH_INDEX: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/**
 * Render the sticker expiry, calling out an already-expired sticker — that's a
 * cost the appraiser has to price in, so it shouldn't be buried in a date.
 */
export function formatInspection(expiry?: string): string {
  if (!expiry) return '—';

  const match = expiry.trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return expiry; // "Unknown / no sticker found"

  const month = MONTH_INDEX[match[1].toLowerCase()];
  const year = Number(match[2]);
  if (month === undefined || !Number.isFinite(year)) return expiry;

  // A sticker is good through the end of its expiry month.
  const expiresEndOf = new Date(year, month + 1, 0, 23, 59, 59);
  const expired = expiresEndOf.getTime() < Date.now();

  return expired ? `${expiry} — ⚠️ EXPIRED` : `${expiry} (valid)`;
}

export interface MatchedDeal {
  id: number;
  title: string;
  applicationId: string;
}

/**
 * Resolve an Application ID to a single Pipedrive deal.
 *
 * Pipedrive's search matches across every custom field, so a hit is only a
 * candidate — we re-read each deal and require an exact Application ID match
 * before returning it. Attaching a customer's photos to the wrong deal would be
 * worse than failing to match at all.
 */
export async function findDealByApplicationId(
  applicationId: string
): Promise<MatchedDeal | null> {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN is not configured.');

  const term = applicationId.trim();
  if (!term) return null;

  const searchUrl = `${PIPEDRIVE_BASE}/deals/search?term=${encodeURIComponent(
    term
  )}&fields=custom_fields&api_token=${token}`;

  const searchRes = await fetch(searchUrl);
  const searchBody: any = await searchRes.json();
  if (!searchBody?.success) {
    throw new Error(`Pipedrive search failed: ${searchBody?.error || searchRes.status}`);
  }

  const items: any[] = searchBody?.data?.items || [];
  if (items.length === 0) return null;

  const wanted = term.toLowerCase();
  const confirmed: any[] = [];

  for (const entry of items.slice(0, 10)) {
    const dealId = entry?.item?.id;
    if (!dealId) continue;

    const dealRes = await fetch(`${PIPEDRIVE_BASE}/deals/${dealId}?api_token=${token}`);
    const dealBody: any = await dealRes.json();
    const deal = dealBody?.data;
    if (!deal) continue;

    const dealAppId = String(deal[APP_ID_FIELD_KEY] ?? '').trim().toLowerCase();
    if (dealAppId && dealAppId === wanted) confirmed.push(deal);
  }

  if (confirmed.length === 0) return null;

  // Duplicates happen (a customer re-applies). Prefer an open deal, then the
  // most recently updated one, so photos land on the deal the rep is working.
  confirmed.sort((a, b) => {
    const aOpen = a.status === 'open' ? 1 : 0;
    const bOpen = b.status === 'open' ? 1 : 0;
    if (aOpen !== bOpen) return bOpen - aOpen;
    return new Date(b.update_time).getTime() - new Date(a.update_time).getTime();
  });

  const deal = confirmed[0];
  return {
    id: deal.id,
    title: deal.title,
    applicationId: String(deal[APP_ID_FIELD_KEY] ?? '').trim(),
  };
}

/** Upload one photo as a file attachment on a deal. */
async function uploadPhotoToDeal(
  dealId: number,
  photo: AppraisalPhoto,
  applicationId: string
): Promise<{ slot: string; ok: boolean; error?: string }> {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN is not configured.');

  // Every part of this name is attacker-influenced, so none of it is trusted.
  const rawExt = (photo.originalName.split('.').pop() || '').toLowerCase();
  const ext = ALLOWED_EXTENSIONS.has(rawExt) ? rawExt : 'jpg';
  const filename = `${safeSegment(applicationId, 24)}-${safeSegment(photo.slot, 24)}.${ext}`;

  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(photo.buffer)], { type: photo.mimetype || 'image/jpeg' }),
      filename
    );
    form.append('deal_id', String(dealId));

    const res = await fetch(`${PIPEDRIVE_BASE}/files?api_token=${token}`, {
      method: 'POST',
      body: form,
    });
    const body: any = await res.json();

    if (!body?.success) {
      return { slot: photo.slot, ok: false, error: body?.error || `HTTP ${res.status}` };
    }
    return { slot: photo.slot, ok: true };
  } catch (err: any) {
    return { slot: photo.slot, ok: false, error: err?.message || 'upload failed' };
  }
}

const SLOT_LABELS: Record<string, string> = {
  vin: 'VIN plate',
  registration: 'Vehicle registration',
  front: 'Front',
  right: 'Right side',
  left: 'Left side',
  back: 'Back',
  'interior-front': 'Interior — front',
  'interior-back': 'Interior — back',
  dash: 'Dash (engine running, showing km)',
  tire: 'Tire close-up',
};

function labelForSlot(slot: string): string {
  if (SLOT_LABELS[slot]) return SLOT_LABELS[slot];
  if (slot.startsWith('damage')) return 'Damage photo';
  return slot;
}

/** Post a formatted note with the vehicle details onto the deal. */
async function addNoteToDeal(
  dealId: number,
  details: AppraisalDetails,
  uploads: { slot: string; ok: boolean; error?: string }[]
): Promise<void> {
  const token = process.env.PIPEDRIVE_API_TOKEN;
  if (!token) throw new Error('PIPEDRIVE_API_TOKEN is not configured.');

  const vehicle = [details.year, details.make, details.model, details.trim]
    .filter(Boolean)
    .join(' ');

  const succeeded = uploads.filter((u) => u.ok);
  const failed = uploads.filter((u) => !u.ok);

  // Everything interpolated below is customer-supplied and MUST be escaped —
  // Pipedrive renders this as HTML.
  const lines: string[] = [
    '<b>🚗 Trade-In Appraisal Submitted</b>',
    '',
    `<b>Vehicle:</b> ${escapeHtml(vehicle) || '—'}`,
    `<b>Odometer:</b> ${escapeHtml(formatKm(details.kilometers))}`,
    `<b>Safety sticker expires:</b> ${escapeHtml(formatInspection(details.inspectionExpiry))}`,
    `<b>VIN:</b> ${details.vin ? escapeHtml(details.vin.toUpperCase()) : '— (see VIN photo)'}`,
    `<b>Application ID:</b> ${escapeHtml(details.applicationId)}`,
  ];

  if (details.notes && details.notes.trim()) {
    lines.push('', `<b>Customer notes:</b> ${escapeHtml(details.notes.trim())}`);
  }

  lines.push('', `<b>Photos attached (${succeeded.length}):</b>`);
  lines.push(escapeHtml(succeeded.map((u) => labelForSlot(u.slot)).join(', ')) || '—');

  if (failed.length > 0) {
    lines.push(
      '',
      `<b>⚠️ ${failed.length} photo(s) failed to upload:</b> ${escapeHtml(
        failed.map((u) => `${labelForSlot(u.slot)} (${u.error})`).join(', ')
      )}`
    );
  }

  lines.push('', `<i>Submitted ${new Date().toLocaleString('en-CA', { timeZone: 'America/Halifax' })} via vehicleapprovalcentre.com/appraisal</i>`);

  const res = await fetch(`${PIPEDRIVE_BASE}/notes?api_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: lines.join('<br>'), deal_id: dealId }),
  });

  const body: any = await res.json();
  if (!body?.success) {
    throw new Error(`Pipedrive note failed: ${body?.error || res.status}`);
  }
}

/**
 * Mirror the submission to Google Sheets. Best-effort: a Sheets outage must
 * never cost us a submission that already landed in Pipedrive.
 */
async function mirrorToSheet(
  details: AppraisalDetails,
  deal: MatchedDeal | null,
  photoCount: number
): Promise<void> {
  const sheetId = process.env.APPRAISAL_SHEET_ID;
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY;

  if (!sheetId || !clientEmail || !rawKey) {
    console.log('[APPRAISAL] Sheets mirror skipped (not configured).');
    return;
  }

  const tab = process.env.APPRAISAL_SHEET_TAB || 'Appraisals';
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: rawKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    new Date().toISOString(),
    details.applicationId,
    deal ? String(deal.id) : 'NO MATCH',
    deal ? deal.title : '',
    details.year || '',
    details.make || '',
    details.model || '',
    details.trim || '',
    details.kilometers || '',
    details.inspectionExpiry || '',
    details.vin || '',
    String(photoCount),
    details.notes || '',
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tab}!A:M`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  console.log(`[APPRAISAL] Mirrored to Google Sheets (${tab}).`);
}

/**
 * Run best-effort side tasks (Sheets mirror, team ping) without ever letting one
 * fail the submission, but log any failure loudly — a silent safety net is
 * worse than none, because you trust it without knowing it's broken.
 */
async function runBestEffort(labels: string[], tasks: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(tasks);
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.error(`[APPRAISAL] ${labels[i]} failed:`, r.reason?.message || r.reason);
    }
  });
}

/** Ping the team's Google Chat space. Best-effort. */
async function notifyTeam(text: string): Promise<void> {
  const webhook = process.env.GOOGLE_CHAT_WEBHOOK_URL;
  if (!webhook) return;
  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export interface AppraisalResult {
  matched: boolean;
  dealId?: number;
  dealTitle?: string;
  photosUploaded: number;
  photosFailed: number;
}

/**
 * Handle a full appraisal submission: match the deal, attach the photos, write
 * the note, mirror to Sheets, alert the team.
 *
 * If no deal matches we still record the submission and alert the team rather
 * than rejecting it — the customer has just photographed their whole car and we
 * are not making them do it twice over a mistyped application number.
 */
export async function processAppraisal(
  details: AppraisalDetails,
  photos: AppraisalPhoto[]
): Promise<AppraisalResult> {
  // The declared MIME type is client-controlled. Trust the bytes, not the label.
  const realPhotos = photos.filter((p) => {
    if (isRealImage(p.buffer)) return true;
    console.warn(
      `[APPRAISAL] Rejected "${p.originalName}" — content is not a valid image ` +
        `(claimed ${p.mimetype}).`
    );
    return false;
  });

  const deal = await findDealByApplicationId(details.applicationId);

  if (!deal) {
    console.warn(`[APPRAISAL] No deal matched Application ID "${details.applicationId}".`);

    await runBestEffort(
      ['Sheets mirror', 'Team notification'],
      [
        mirrorToSheet(details, null, realPhotos.length),
        notifyTeam(
          `⚠️ *Trade-in appraisal with NO matching deal*\n` +
            `Application ID entered: *${details.applicationId}*\n` +
            `Vehicle: ${[details.year, details.make, details.model].filter(Boolean).join(' ') || '—'}\n` +
            `${realPhotos.length} photo(s) submitted but NOT attached — the customer may have mistyped their application number. Please follow up.`
        ),
      ]
    );

    return { matched: false, photosUploaded: 0, photosFailed: realPhotos.length };
  }

  const uploads: { slot: string; ok: boolean; error?: string }[] = [];
  for (const photo of realPhotos) {
    uploads.push(await uploadPhotoToDeal(deal.id, photo, deal.applicationId));
  }

  const uploaded = uploads.filter((u) => u.ok).length;
  const failed = uploads.length - uploaded;

  await addNoteToDeal(deal.id, details, uploads);

  const vehicle = [details.year, details.make, details.model].filter(Boolean).join(' ');
  await runBestEffort(
    ['Sheets mirror', 'Team notification'],
    [
      mirrorToSheet(details, deal, uploaded),
      notifyTeam(
        `🚗 *Trade-in appraisal received*\n` +
          `*${deal.title}* (app ${deal.applicationId}, deal #${deal.id})\n` +
          `${vehicle || 'Vehicle'} · ${formatKm(details.kilometers)} · ` +
          `sticker: ${formatInspection(details.inspectionExpiry)}\n` +
          `${uploaded} photo(s) attached` +
          (failed > 0 ? `\n⚠️ ${failed} photo(s) failed to upload.` : '')
      ),
    ]
  );

  console.log(
    `[APPRAISAL] Deal #${deal.id} (${deal.title}) — ${uploaded} photo(s) attached, ${failed} failed.`
  );

  return {
    matched: true,
    dealId: deal.id,
    dealTitle: deal.title,
    photosUploaded: uploaded,
    photosFailed: failed,
  };
}
