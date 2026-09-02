import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { syncInventoryToGoogleSheets } from './src/lib/googleSheets';
import { findDealByApplicationId, processAppraisal, isRealImage, formatInspection, type AppraisalPhoto } from './src/lib/appraisal';
import multer from 'multer';
import crypto from 'node:crypto';
import { sendAs as gmailSendAs, gmailAs, vacSignatureHtml } from './src/lib/gmailDelegate';

dotenv.config();

// Diagnostic logging on boot to verify the platform is injecting keys properly
{
  const pipedriveKey = process.env.PIPEDRIVE_API_TOKEN?.trim();
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const carfaxClientId = process.env.CARFAX_CLIENT_ID?.trim();
  const carfaxAccountNumber = process.env.CARFAX_ACCOUNT_NUMBER?.trim();
  
  console.log(`[BOOT] Server starting at ${new Date().toISOString()}`);
  console.log(`[BOOT] PIPEDRIVE_API_TOKEN: ${pipedriveKey ? 'OK (' + pipedriveKey.length + ' chars)' : 'MISSING'}`);
  console.log(`[BOOT] RESEND_API_KEY: ${resendKey ? 'OK' : 'MISSING'}`);
  console.log(`[BOOT] CARFAX_CLIENT_ID: ${carfaxClientId ? 'OK' : 'MISSING'}`);
  console.log(`[BOOT] CARFAX_ACCOUNT_NUMBER: ${carfaxAccountNumber ? 'OK' : 'MISSING'}`);
  
  if (!pipedriveKey) {
    console.warn("[WARN] Pipedrive API token is missing. Some features may not work.");
  }
}

async function fetchWithTimeout(url: string, options: any = {}, timeout = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

function normalizePhone(phone?: string) {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

function normalizeDate(date?: string) {
  if (!date) return undefined;
  // If already YYYY-MM-DD, return as is
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  // If MM/DD/YYYY, convert to YYYY-MM-DD
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const [_, month, day, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return date;
}

function getLeadSource(utm_source?: string, utm_medium?: string) {
  const source = (utm_source || "").toLowerCase();
  const medium = (utm_medium || "").toLowerCase();
  
  if (source.includes('facebook') || source.includes('fb')) return 'Facebook';
  if (source.includes('instagram') || source.includes('ig')) return 'Instagram';
  if (source.includes('tiktok')) return 'TikTok';
  if (source.includes('google') || source.includes('gmb') || source.includes('adwords')) return 'Google';
  
  if (source) return source.charAt(0).toUpperCase() + source.slice(1);
  return null;
}

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

function getFeedBaseUrl(req: any): string {
  const host = req.get('host') || '';
  if (!host || host.includes('localhost') || host.includes('127.0.0.1') || host.includes('ais-dev') || host.includes('ais-pre') || host.includes('run.app')) {
    return 'https://vehicleapprovalcentre.com';
  }
  return `https://${host}`;
}

// Firebase Admin initialization helper
async function getFirestoreAdmin() {
  const admin = await import('firebase-admin');
  const { getFirestore } = await import('firebase-admin/firestore');
  let databaseId: string | undefined = undefined;
  if (!admin.apps.length) {
    try {
      // Import the config. In tsx/ESM, the default export of a JSON import is the JSON object itself.
      const configModule = await import('./firebase-applet-config.json', { assert: { type: 'json' } });
      const config = configModule.default;
      databaseId = config.firestoreDatabaseId || undefined;
      admin.initializeApp({
        projectId: config.projectId
      });
    } catch (e) {
      console.warn("[FIREBASE] Could not load local config, falling back to default initialization:", e);
      admin.initializeApp();
    }
  } else {
    try {
      const configModule = await import('./firebase-applet-config.json', { assert: { type: 'json' } });
      databaseId = configModule.default.firestoreDatabaseId || undefined;
    } catch (e) {
      // Ignore
    }
  }
  return { admin, db: getFirestore(databaseId) };
}

// Carfax State Management
let carfaxToken: string | null = null;
let carfaxTokenExpiry: number = 0;

async function getCarfaxToken() {
  const now = Date.now();
  if (carfaxToken && now < carfaxTokenExpiry) {
    return carfaxToken;
  }

  const clientId = process.env.CARFAX_CLIENT_ID;
  const clientSecret = process.env.CARFAX_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('CARFAX_CLIENT_ID and CARFAX_CLIENT_SECRET environment variables are required');
  }

  try {
    const response = await fetchWithTimeout('https://identity.carfax.ca/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Carfax] Token error: ${response.status} ${errorText}`);
      throw new Error(`Failed to get Carfax token: ${response.status}`);
    }

    const data = await response.json();
    carfaxToken = data.access_token;
    // Buffer for expiry
    carfaxTokenExpiry = now + (data.expires_in * 1000) - 60000;
    console.log(`[Carfax] Successfully refreshed access token. Expires in ${data.expires_in}s.`);
    return carfaxToken;
  } catch (err: any) {
    console.error("[Carfax] Authentication failed:", err.message);
    throw err;
  }
}

async function findPipedrivePerson(apiToken: string, email?: string, phone?: string) {
  if (!email && !phone) return null;
  
  // Try searching by email first
  if (email) {
    try {
      const response = await fetchWithTimeout(`https://api.pipedrive.com/v1/persons/search?term=${encodeURIComponent(email)}&api_token=${apiToken}&fields=email`);
      const data = await response.json();
      if (data.success && data.data.items && data.data.items.length > 0) {
        return data.data.items[0].item.id;
      }
    } catch (err) {
      console.error("Error searching Pipedrive person by email:", err);
    }
  }

  // Then try searching by phone
  if (phone) {
    const normalized = normalizePhone(phone);
    if (normalized) {
      try {
        const response = await fetchWithTimeout(`https://api.pipedrive.com/v1/persons/search?term=${encodeURIComponent(normalized)}&api_token=${apiToken}&fields=phone`);
        const data = await response.json();
        if (data.success && data.data.items && data.data.items.length > 0) {
          return data.data.items[0].item.id;
        }
      } catch (err) {
        console.error("Error searching Pipedrive person by phone:", err);
      }
    }
  }
  
  return null;
}

async function findRecentOpenPipedriveLead(apiToken: string, personId: number) {
  try {
    // Specifically search for leads belonging to this person to be more accurate and handle high volume
    const response = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads?person_id=${personId}&api_token=${apiToken}&limit=10`);
    const data = await response.json();
    if (data.success && data.data && data.data.length > 0) {
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
      
      // Still check the date even though we filtered by person
      return data.data.find((l: any) => {
        return new Date(l.add_time) >= fourDaysAgo;
      });
    }
  } catch (err) {
    console.error("Error fetching Pipedrive leads for person:", personId, err);
  }
  return null;
}

async function findRecentOpenPipedriveDeal(apiToken: string, personId: number) {
  try {
    const response = await fetchWithTimeout(`https://api.pipedrive.com/v1/persons/${personId}/deals?status=open&api_token=${apiToken}`);
    const data = await response.json();
    if (data.success && data.data && data.data.length > 0) {
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);
      
      // Filter and sort to find the most recent open deal within 4 days
      const recentOpenDeals = data.data.filter((d: any) => {
        return new Date(d.add_time) >= fourDaysAgo;
      });
      
      if (recentOpenDeals.length > 0) {
        // Sort descending by add_time
        recentOpenDeals.sort((a: any, b: any) => {
          return new Date(b.add_time).getTime() - new Date(a.add_time).getTime();
        });
        return recentOpenDeals[0];
      }
    }
  } catch (err) {
    console.error("Error fetching Pipedrive deals for person:", personId, err);
  }
  return null;
}

let resendClient: Resend | null = null;

function getResendClient() {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is missing. Please set it in the AI Studio settings.");
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

// --- Meta Conversions API (server-side) -------------------------------------
// Sends a reliable server-to-server "Lead" event to Meta so ad optimization and
// reporting aren't limited by browser pixel loss (iOS, ad blockers, cookies).
// Inert until META_CAPI_ACCESS_TOKEN is set — safe to ship before it's configured.
function hashSha256(value: string) {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function readCookie(req: any, name: string): string | undefined {
  const raw = req?.headers?.cookie;
  if (!raw) return undefined;
  const found = raw.split(';').map((c: string) => c.trim()).find((c: string) => c.startsWith(name + '='));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : undefined;
}

async function sendMetaLeadEvent(req: any, opts: { email?: string; phone?: string; eventId: string; sourceUrl?: string }) {
  const pixelId = process.env.META_PIXEL_ID || process.env.VITE_FB_PIXEL_ID;
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!pixelId || !token) return; // not configured yet — no-op

  try {
    const userData: any = {};
    if (opts.email) userData.em = [hashSha256(opts.email)];
    if (opts.phone) {
      let digits = opts.phone.replace(/\D/g, '');
      if (digits.length === 10) digits = '1' + digits; // default to Canada/US country code
      if (digits) userData.ph = [crypto.createHash('sha256').update(digits).digest('hex')];
    }
    const fbp = readCookie(req, '_fbp'); if (fbp) userData.fbp = fbp;
    const fbc = readCookie(req, '_fbc'); if (fbc) userData.fbc = fbc;
    const ip = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() || req.ip;
    if (ip) userData.client_ip_address = ip;
    const ua = req.headers['user-agent']; if (ua) userData.client_user_agent = ua;

    const payload = {
      data: [{
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'website',
        event_id: opts.eventId,
        ...(opts.sourceUrl ? { event_source_url: opts.sourceUrl } : {}),
        user_data: userData,
      }],
    };

    const resp = await fetchWithTimeout(
      `https://graph.facebook.com/v21.0/${pixelId}/events?access_token=${token}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    if (!resp.ok) {
      console.error('[META CAPI] Non-OK response:', resp.status, await resp.text());
    } else {
      console.log('[META CAPI] Lead event sent:', opts.eventId);
    }
  } catch (err) {
    console.error('[META CAPI] Failed to send Lead event:', err);
  }
}

// --- TikTok Events API (server-side) ----------------------------------------
// Mirror of the Meta CAPI helper: sends a reliable server-side "SubmitForm"
// (lead) event to TikTok. Inert until TIKTOK_ACCESS_TOKEN is set.
async function sendTikTokLeadEvent(req: any, opts: { email?: string; phone?: string; eventId: string; sourceUrl?: string }) {
  const pixelCode = process.env.TIKTOK_PIXEL_ID || 'CN57RK3C77UBB5H8V0R0';
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!pixelCode || !token) return; // not configured yet — no-op

  try {
    const user: any = {};
    if (opts.email) user.email = hashSha256(opts.email);
    if (opts.phone) {
      let digits = opts.phone.replace(/\D/g, '');
      if (digits.length === 10) digits = '1' + digits;
      // TikTok expects E.164 (with +), hashed
      user.phone = crypto.createHash('sha256').update('+' + digits).digest('hex');
    }
    const ip = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() || req.ip;
    if (ip) user.ip = ip;
    const ua = req.headers['user-agent']; if (ua) user.user_agent = ua;
    const ttp = readCookie(req, '_ttp'); if (ttp) user.ttp = ttp;
    const ttclid = readCookie(req, 'ttclid'); if (ttclid) user.ttclid = ttclid;

    const payload = {
      event_source: 'web',
      event_source_id: pixelCode,
      data: [{
        event: 'SubmitForm',
        event_time: Math.floor(Date.now() / 1000),
        event_id: opts.eventId,
        user,
        ...(opts.sourceUrl ? { page: { url: opts.sourceUrl } } : {}),
      }],
    };

    const resp = await fetchWithTimeout('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': token },
      body: JSON.stringify(payload),
    });
    const body: any = await resp.json().catch(() => ({}));
    if (resp.ok && body.code === 0) {
      console.log('[TIKTOK EAPI] Lead event sent:', opts.eventId);
    } else {
      console.error('[TIKTOK EAPI] Non-OK response:', resp.status, JSON.stringify(body));
    }
  } catch (err) {
    console.error('[TIKTOK EAPI] Failed to send Lead event:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Redirect applynow.vehicleapprovalcentre.com to /financing
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (host.toLowerCase().startsWith("applynow.vehicleapprovalcentre.com")) {
      return res.redirect(301, "https://vehicleapprovalcentre.com/financing");
    }
    next();
  });

  // The appraisal form is an unlisted, rep-sent link — never a search result.
  // The page also sets a noindex <meta>, but that only counts if the crawler
  // runs our JS; this header is honoured unconditionally. Deliberately NOT
  // added to robots.txt: a Disallow rule would publicly advertise the URL to
  // anyone who reads the file.
  app.use((req, res, next) => {
    if (req.path.startsWith("/appraisal") || req.path.startsWith("/quick-add")) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, noimageindex");
    }
    next();
  });

  // --- Rate limiting ---
  // Application IDs are semi-guessable (surname + 4 digits), so an unthrottled
  // verify endpoint is a brute-forcer's dream: confirm a valid ID, then POST
  // junk onto that customer's real deal. Nothing here exposes customer data,
  // but vandalism is still worth locking out.
  //
  // In-memory is deliberate: we run min-instances=1 and low traffic, so a shared
  // store would be more moving parts than the threat warrants. If this ever
  // scales out, the limit becomes per-instance and should move to Redis.
  const rateBuckets = new Map<string, number[]>();

  const clientIp = (req: express.Request): string =>
    (
      req.get("cf-connecting-ip") || // Cloudflare sits in front of us
      req.get("x-forwarded-for")?.split(",")[0] ||
      req.socket.remoteAddress ||
      "unknown"
    ).trim();

  const rateLimit = (key: string, max: number, windowMs: number): boolean => {
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      rateBuckets.set(key, hits);
      return false;
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    return true;
  };

  // Keep the map from growing without bound.
  setInterval(() => {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const [key, hits] of rateBuckets) {
      const live = hits.filter((t) => t > cutoff);
      if (live.length === 0) rateBuckets.delete(key);
      else rateBuckets.set(key, live);
    }
  }, 10 * 60 * 1000).unref();

  /** Trim a customer-supplied field to something sane before it reaches the CRM. */
  const cap = (value: unknown, max: number): string =>
    typeof value === "string" ? value.trim().slice(0, max) : "";

  // --- Trade-in appraisal (replaces the Typeform → Sheets flow) ---
  // Photos are compressed in the browser before upload, so these ceilings are
  // generous headroom rather than an expected size.
  const appraisalUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024, files: 20 },
    fileFilter: (_req, file, cb) => {
      if (/^image\//.test(file.mimetype)) return cb(null, true);
      cb(new Error("Only image files are allowed."));
    },
  });

  // Lets the form confirm an application number BEFORE the customer photographs
  // their whole car. Deliberately returns only a boolean: application IDs are
  // semi-guessable (surname + digits), so echoing back the customer's name here
  // would turn this into a data-leak endpoint.
  app.get("/api/appraisal/verify", async (req, res) => {
    // A real customer types their number once; 30 lookups in 10 minutes is
    // generous for them and useless for a brute-forcer.
    if (!rateLimit(`verify:${clientIp(req)}`, 30, 10 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many attempts. Please try again shortly." });
    }

    const applicationId = cap(req.query.app, 32);
    if (!applicationId) return res.status(400).json({ error: "Missing application number." });

    try {
      const deal = await findDealByApplicationId(applicationId);
      return res.json({ found: Boolean(deal) });
    } catch (err: any) {
      console.error("[APPRAISAL] verify failed:", err?.message);
      // Fail open — never block a real customer because our lookup broke.
      return res.json({ found: null });
    }
  });

  app.post("/api/appraisal", appraisalUpload.any(), async (req, res) => {
    // A customer submits once, maybe twice if something goes wrong. Ten an hour
    // leaves plenty of room for a genuine retry while capping how much junk a
    // single source can push into the CRM.
    if (!rateLimit(`submit:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
      return res
        .status(429)
        .json({ error: "Too many submissions. Please try again later or call us." });
    }

    try {
      const b = req.body || {};
      const leadToken = cap(b.leadToken, 64);
      const applicationId = cap(b.applicationId, 32) || (leadToken ? "CRM-LINK" : "");

      if (!applicationId) {
        return res.status(400).json({ error: "Application number is required." });
      }

      const files = (req.files as Express.Multer.File[]) || [];
      const photos: AppraisalPhoto[] = files.map((f) => ({
        slot: f.fieldname.replace(/^photo_/, ""),
        originalName: f.originalname,
        mimetype: f.mimetype,
        buffer: f.buffer,
      }));

      const result = await processAppraisal(
        {
          applicationId,
          year: cap(b.year, 8),
          make: cap(b.make, 40),
          model: cap(b.model, 40),
          trim: cap(b.trim, 40),
          kilometers: cap(b.kilometers, 10),
          inspectionExpiry: cap(b.inspectionExpiry, 40),
          vin: cap(b.vin, 20),
          notes: cap(b.notes, 2000),
        },
        photos
      );

      // CRM path: attach the appraisal to the lead — photos go to Storage (labelled by slot), details +
      // thumbnails land in the thread, card gets a flag, owning rep gets a heads-up text.
      if (leadToken) {
        try {
          const { admin, db } = await getFirestoreAdmin();
          const q = await db.collection("crmLeads").where("tradeToken", "==", leadToken).limit(1).get();
          if (!q.empty) {
            const d = q.docs[0]; const now = new Date().toISOString();
            const SLOT_LABELS: Record<string, string> = { vin: "VIN plate", registration: "Vehicle registration", front: "Front", right: "Right side", left: "Left side", back: "Back", "interior-front": "Interior — front", "interior-back": "Interior — back", dash: "Dash (engine running, showing km)", tire: "Tire close-up" };
            const labelFor = (slot: string) => SLOT_LABELS[slot] || (slot.startsWith("damage") ? `Damage photo${slot.replace(/^damage-?/, "") ? ` ${slot.replace(/^damage-?/, "")}` : ""}` : slot);
            const bucket = admin.storage().bucket("gen-lang-client-0753805028.firebasestorage.app");
            const uploaded: { slot: string; label: string; url: string; name: string }[] = [];
            for (const ph of photos) {
              if (!isRealImage(ph.buffer)) continue;
              try {
                const ext = (ph.originalName.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
                const tokenId = crypto.randomUUID();
                const objectPath = `crm-tradeins/${d.id}/${Date.now()}_${ph.slot.replace(/[^a-z0-9-]/gi, "_")}.${ext}`;
                await bucket.file(objectPath).save(ph.buffer, { contentType: ph.mimetype || "image/jpeg", metadata: { metadata: { firebaseStorageDownloadTokens: tokenId } } });
                const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(objectPath)}?alt=media&token=${tokenId}`;
                uploaded.push({ slot: ph.slot, label: labelFor(ph.slot), url, name: `${labelFor(ph.slot)}.${ext}` });
              } catch (e: any) { console.error("[APPRAISAL] CRM photo upload failed:", ph.slot, e?.message || e); }
            }
            const veh = [cap(b.year, 8), cap(b.make, 40), cap(b.model, 40), cap(b.trim, 40)].filter(Boolean).join(" ");
            const kmNum = Number(String(cap(b.kilometers, 10) || "").replace(/[^0-9]/g, ""));
            const kmTxt = kmNum > 0 ? `${kmNum.toLocaleString("en-CA")} km` : "—";
            const noteLines = [
              "🚗 Trade-In Appraisal Submitted",
              "",
              `Vehicle: ${veh || "—"}`,
              `Odometer: ${kmTxt}`,
              `Safety sticker expires: ${formatInspection(cap(b.inspectionExpiry, 40)) || "—"}`,
              `VIN: ${cap(b.vin, 20) || "— (see VIN photo)"}`,
              ...(cap(b.notes, 2000) ? ["", `Customer notes: ${cap(b.notes, 2000)}`] : []),
              "",
              uploaded.length ? `Photos attached (${uploaded.length}):\n${uploaded.map((u) => u.label).join(", ")}` : "No photos uploaded.",
            ];
            const details = noteLines.join("\n");
            const photoList = "";
            await d.ref.update({
              hasTradeIn: "Yes",
              tradeIn: { year: cap(b.year, 8), make: cap(b.make, 40), model: cap(b.model, 40), trim: cap(b.trim, 40), kilometers: cap(b.kilometers, 10), vin: cap(b.vin, 20), inspectionExpiry: cap(b.inspectionExpiry, 40), notes: cap(b.notes, 2000), photos: uploaded.length, photoUrls: uploaded, submittedAt: now },
              tradeSubmittedAt: now, updatedAt: now,
              activityLog: admin.firestore.FieldValue.arrayUnion({ text: details, by: "Customer", at: now, kind: "note", tradeIn: true, media: uploaded.map((u) => u.url), mediaLabels: uploaded.map((u) => u.label) }),
            });
            if (d.get("owner")) notifyRepBySms(db, d.get("owner"), `🚗 ${[d.get("firstName"), d.get("lastName")].filter(Boolean).join(" ") || "A lead"} just submitted their trade-in (${veh || "vehicle"}, ${uploaded.length} photo${uploaded.length === 1 ? "" : "s"}).\nOpen: https://vehicleapprovalcentre.com/admin?tab=crm&lead=${d.id}`).catch(() => {});
          }
        } catch (e: any) { console.error("[APPRAISAL] CRM attach failed (non-fatal):", e?.message || e); }
      }

      // A submission that didn't match a deal is still captured and the team is
      // alerted, so we thank the customer rather than making them re-shoot.
      return res.json({
        success: true,
        matched: result.matched,
        photosUploaded: result.photosUploaded,
        photosFailed: result.photosFailed,
      });
    } catch (err: any) {
      console.error("[APPRAISAL] submission failed:", err?.message);
      return res.status(500).json({ error: "We couldn't submit your appraisal. Please try again." });
    }
  });

  // --- Quick-add delivery photo (logistics manager, mobile, PIN-gated) ---
  // Replaces the two-step "post in chat, then re-upload in admin" flow: one
  // mobile submission writes straight to the `deliveries` collection that the
  // VAC Family page reads. Photo is compressed in the browser before upload.
  const deliveryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (/^image\//.test(file.mimetype)) return cb(null, true);
      cb(new Error("Only image files are allowed."));
    },
  });

  // Only staff with a verified @drivevac.ca Google account may publish. We
  // verify the Firebase ID token server-side — a domain check in the browser
  // alone would be trivially bypassable by POSTing straight to this endpoint.
  const DELIVERY_ALLOWED_DOMAIN = "drivevac.ca";

  const verifyDriveVacUser = async (
    authHeader: string | undefined
  ): Promise<{ ok: true; email: string } | { ok: false; error: string }> => {
    const token = (authHeader || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return { ok: false, error: "Not signed in." };
    try {
      const { admin } = await getFirestoreAdmin();
      const decoded = await admin.auth().verifyIdToken(token);
      const email = (decoded.email || "").toLowerCase();
      if (!decoded.email_verified) return { ok: false, error: "Email not verified." };
      if (!email.endsWith(`@${DELIVERY_ALLOWED_DOMAIN}`)) {
        return { ok: false, error: `Must sign in with a @${DELIVERY_ALLOWED_DOMAIN} account.` };
      }
      return { ok: true, email };
    } catch (err: any) {
      console.warn("[DELIVERY] token verify failed:", err?.message);
      return { ok: false, error: "Sign-in expired. Please sign in again." };
    }
  };

  app.post("/api/delivery", deliveryUpload.single("photo"), async (req, res) => {
    if (!rateLimit(`delivery:${clientIp(req)}`, 30, 60 * 60 * 1000)) {
      return res.status(429).json({ error: "Too many submissions. Please try again later." });
    }

    const auth = await verifyDriveVacUser(req.get("authorization"));
    // "error" in auth, not !auth.ok — strictNullChecks is off, so the boolean discriminant doesn't narrow.
    if ("error" in auth) {
      return res.status(401).json({ error: auth.error });
    }

    const b = req.body || {};

    const firstName = cap(b.firstName, 40);
    const vehicle = cap(b.vehicle, 60);
    if (!firstName || !vehicle) {
      return res.status(400).json({ error: "First name and vehicle are required." });
    }

    const file = req.file;
    if (!file || !isRealImage(file.buffer)) {
      return res.status(400).json({ error: "A valid photo is required." });
    }

    try {
      const { admin, db } = await getFirestoreAdmin();
      const bucket = admin.storage().bucket("gen-lang-client-0753805028.firebasestorage.app");

      // Store like the other delivery photos, with a download token so the
      // resulting public URL behaves identically to admin-uploaded ones.
      const token = crypto.randomUUID();
      const objectPath = `deliveries/${Date.now()}_quickadd.jpg`;
      await bucket.file(objectPath).save(file.buffer, {
        contentType: "image/jpeg",
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
      });
      const photoUrl =
        `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
        `${encodeURIComponent(objectPath)}?alt=media&token=${token}`;

      await db.collection("deliveries").add({
        firstName,
        lastInitial: cap(b.lastInitial, 4),
        vehicle,
        city: cap(b.city, 60),
        province: cap(b.province, 40),
        photoUrl,
        addedBy: auth.email, // audit trail: which staff member published it
        createdAt: admin.firestore.Timestamp.now(),
      });

      console.log(`[DELIVERY] Quick-add published by ${auth.email}: ${firstName} — ${vehicle}`);
      return res.json({ success: true });
    } catch (err: any) {
      console.error("[DELIVERY] Quick-add failed:", err?.message);
      return res.status(500).json({ error: "Couldn't publish. Please try again." });
    }
  });

  // API Routes
  app.post("/api/check-availability", async (req, res) => {
    const { name, email, phone, vehicleId, vehicleName, message, utm_source, utm_medium, utm_campaign } = req.body;

    const apiToken = process.env.PIPEDRIVE_API_TOKEN;
    if (!apiToken) {
      return res.status(500).json({ error: "PIPEDRIVE_API_TOKEN is not configured." });
    }

    try {
      // 1. Find or Create Person in Pipedrive
      let personId = await findPipedrivePerson(apiToken, email, phone);

      if (!personId) {
        const personResponse = await fetchWithTimeout(`https://api.pipedrive.com/v1/persons?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: email ? [email] : undefined,
            phone: phone ? [phone] : undefined,
          }),
        });
        const personData = await personResponse.json();
        personId = personData.data?.id;
      } else {
        // Update person with latest contact info
        await fetchWithTimeout(`https://api.pipedrive.com/v1/persons/${personId}?api_token=${apiToken}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: email ? [email] : undefined,
            phone: phone ? [phone] : undefined,
          }),
        });
      }

      // 2. Check for recent open lead (within 4 days)
      const recentLead = personId ? await findRecentOpenPipedriveLead(apiToken, personId) : null;
      let leadId = recentLead ? recentLead.id : null;

      if (!recentLead) {
        // Create new lead
        const leadPayload: any = {
          title: `Check Availability: ${vehicleName}`,
          person_id: personId,
        };

        const sourceKey = process.env.PIPEDRIVE_LEAD_SOURCE_FIELD_KEY;
        const sourceValue = getLeadSource(utm_source, utm_medium);
        if (sourceKey && sourceValue) {
          leadPayload[sourceKey] = sourceValue;
        }

        // Map contact info into the lead/deal custom fields so it carries over
        // to the deal (leads and deals share custom fields in Pipedrive).
        const firstNameKey = process.env.PIPEDRIVE_LEAD_FIRST_NAME_FIELD_KEY;
        const lastNameKey = process.env.PIPEDRIVE_LEAD_LAST_NAME_FIELD_KEY;
        const emailKey = process.env.PIPEDRIVE_LEAD_EMAIL_FIELD_KEY;
        const phoneKey = process.env.PIPEDRIVE_LEAD_PHONE_FIELD_KEY;
        if (emailKey && emailKey.trim() && email) leadPayload[emailKey] = email;
        if (phoneKey && phoneKey.trim() && phone) leadPayload[phoneKey] = phone;
        if (name && name.trim()) {
          const parts = name.trim().split(' ');
          const fName = parts[0];
          const lName = parts.slice(1).join(' ');
          if (firstNameKey && firstNameKey.trim() && fName) leadPayload[firstNameKey] = fName;
          if (lastNameKey && lastNameKey.trim() && lName) leadPayload[lastNameKey] = lName;
        }

        const leadResponse = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadPayload),
        });
        const leadData = await leadResponse.json();
        leadId = leadData.data?.id;
      } else {
        // Update existing lead title to include latest vehicle
        await fetchWithTimeout(`https://api.pipedrive.com/v1/leads/${leadId}?api_token=${apiToken}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: `Check Availability: ${vehicleName}`
          }),
        });
      }

      // 3. Add Note
      if (leadId && (vehicleId || vehicleName)) {
        console.log(`Adding note to lead ${leadId} for vehicle: ${vehicleName}`);
        const notePrefix = recentLead ? '*** UPDATED INQUIRY (Existing Lead) ***\n' : '';
        const vehicleLink = req.body.vehicleUrl || `https://${req.get('host')}/inventory/${vehicleId}`;
        
        let noteContent = `${notePrefix}Customer Message: ${message || 'N/A'}\nVehicle: ${vehicleName || 'Unknown'}\nLink: ${vehicleLink}`;
        
        if (utm_source || utm_medium || utm_campaign) {
          noteContent += `\n\n--- SOURCE ---`;
          if (utm_source) noteContent += `\nSource: ${utm_source}`;
          if (utm_medium) noteContent += `\nMedium: ${utm_medium}`;
          if (utm_campaign) noteContent += `\nCampaign: ${utm_campaign}`;
        }
        
        await fetchWithTimeout(`https://api.pipedrive.com/v1/notes?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: noteContent,
            lead_id: leadId
          }),
        });
      }

      const convEventId1 = crypto.randomUUID();
      const convUrl1 = req.body.vehicleUrl || req.get('referer');
      await sendMetaLeadEvent(req, { email, phone, eventId: convEventId1, sourceUrl: convUrl1 });
      await sendTikTokLeadEvent(req, { email, phone, eventId: convEventId1, sourceUrl: convUrl1 });
      res.json({ success: true, isUpdate: !!recentLead });
    } catch (err: any) {
      console.error("Check availability error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/leads", async (req, res) => {
    const { 
      lead_id,
      title, 
      name,
      firstName,
      lastName,
      email,
      phone,
      person_id, 
      organization_id, 
      value, 
      expected_close_date,
      // Financing fields
      dateOfBirth,
      annualIncome,
      monthlyHousing,
      postalCode,
      fullAddress,
      streetAddress,
      suite,
      city,
      province,
      vehicleName,
      vehicleUrl,
      vehicleType,
      rep,
      isTradeIn,
      isFinal,
      notes: incomingNotes,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term
    } = req.body;

    const apiToken = process.env.PIPEDRIVE_API_TOKEN;
    if (!apiToken) {
      console.error("[PIPEDRIVE] Missing API Token for /api/leads request");
      return res.status(500).json({ error: "PIPEDRIVE_API_TOKEN is not configured." });
    }

    // DEBUG: Log Pipedrive field keys to identify invalid ID
    console.log("[DEBUG] Pipedrive field keys:", {
      PIPEDRIVE_APPLICATION_ID_FIELD_KEY: process.env.PIPEDRIVE_APPLICATION_ID_FIELD_KEY,
      PIPEDRIVE_LEAD_DOB_FIELD_KEY: process.env.PIPEDRIVE_LEAD_DOB_FIELD_KEY,
      PIPEDRIVE_LEAD_FIRST_NAME_FIELD_KEY: process.env.PIPEDRIVE_LEAD_FIRST_NAME_FIELD_KEY,
      PIPEDRIVE_LEAD_LAST_NAME_FIELD_KEY: process.env.PIPEDRIVE_LEAD_LAST_NAME_FIELD_KEY,
      PIPEDRIVE_LEAD_EMAIL_FIELD_KEY: process.env.PIPEDRIVE_LEAD_EMAIL_FIELD_KEY,
      PIPEDRIVE_LEAD_PHONE_FIELD_KEY: process.env.PIPEDRIVE_LEAD_PHONE_FIELD_KEY,
      PIPEDRIVE_INCOME_FIELD_KEY: process.env.PIPEDRIVE_INCOME_FIELD_KEY,
      PIPEDRIVE_HOUSING_FIELD_KEY: process.env.PIPEDRIVE_HOUSING_FIELD_KEY,
      PIPEDRIVE_POSTAL_FIELD_KEY: process.env.PIPEDRIVE_POSTAL_FIELD_KEY,
      PIPEDRIVE_STREET_FIELD_KEY: process.env.PIPEDRIVE_STREET_FIELD_KEY,
      PIPEDRIVE_SUITE_FIELD_KEY: process.env.PIPEDRIVE_SUITE_FIELD_KEY,
      PIPEDRIVE_CITY_FIELD_KEY: process.env.PIPEDRIVE_CITY_FIELD_KEY,
      PIPEDRIVE_PROVINCE_FIELD_KEY: process.env.PIPEDRIVE_PROVINCE_FIELD_KEY,
      PIPEDRIVE_INTERESTED_IN_FIELD_KEY: process.env.PIPEDRIVE_INTERESTED_IN_FIELD_KEY,
    });
    
    try {
      let finalPersonId = person_id;

      // If no person_id is provided, try to find by email/phone
      if (!finalPersonId && (email || phone)) {
        finalPersonId = await findPipedrivePerson(apiToken, email, phone);
      }

      // If person exists, update their record with the latest info
      if (finalPersonId) {
        console.log("Updating person in Pipedrive:", finalPersonId);
        const personDobKey = process.env.PIPEDRIVE_PERSON_DOB_FIELD_KEY;
        const personUpdatePayload: any = {
          name: name || firstName && lastName ? `${firstName} ${lastName}` : undefined,
          email: email ? [email] : undefined,
          phone: phone ? [phone] : undefined,
        };
        if (dateOfBirth && personDobKey) {
          personUpdatePayload[personDobKey] = normalizeDate(dateOfBirth);
        }

        await fetchWithTimeout(`https://api.pipedrive.com/v1/persons/${finalPersonId}?api_token=${apiToken}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(personUpdatePayload),
        });
      }

      // If still no person_id, create a person
      if (!finalPersonId && name) {
        console.log("Creating person in Pipedrive:", name);
        
        const personDobKey = process.env.PIPEDRIVE_PERSON_DOB_FIELD_KEY;
        const personPayload: any = {
          name,
          email: email ? [email] : undefined,
          phone: phone ? [phone] : undefined,
        };
        if (dateOfBirth && personDobKey) {
          personPayload[personDobKey] = normalizeDate(dateOfBirth);
        }

        const personResponse = await fetchWithTimeout(`https://api.pipedrive.com/v1/persons?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(personPayload),
        });

        const personData = await personResponse.json();
        if (personResponse.ok && personData.data && personData.data.id) {
          finalPersonId = personData.data.id;
          console.log("Created person with ID:", finalPersonId);
        } else {
          console.error("Failed to create person in Pipedrive:", personData);
        }
      }

      // Check for recent open lead (within 4 days)
      let recentLead = null;
      if (lead_id) {
        // If client provided a lead_id, try to use it
        try {
          const checkResp = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads/${lead_id}?api_token=${apiToken}`);
          const checkData = await checkResp.json();
          if (checkResp.ok && checkData.data) {
            recentLead = checkData.data;
          }
        } catch (err) {
          console.error("Error checking specific lead_id:", err);
        }
      }

      if (!recentLead && finalPersonId) {
        recentLead = await findRecentOpenPipedriveLead(apiToken, finalPersonId);
      }

      let recentDeal = null;
      if (!recentLead && finalPersonId) {
        recentDeal = await findRecentOpenPipedriveDeal(apiToken, finalPersonId);
      }

      const appIdKey = process.env.PIPEDRIVE_APPLICATION_ID_FIELD_KEY;

      // Generate Application ID or reuse existing
      let applicationId = '';
      if (recentLead && appIdKey && recentLead[appIdKey]) {
        applicationId = recentLead[appIdKey];
        console.log("Reusing Application ID from recent Lead:", applicationId);
      } else if (recentDeal && appIdKey && recentDeal[appIdKey]) {
        applicationId = recentDeal[appIdKey];
        console.log("Reusing Application ID from recent Deal:", applicationId);
      } else {
        if (name) {
          const nameParts = name.trim().split(' ');
          const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : nameParts[0];
          const shortLastName = lastName.substring(0, 4).toUpperCase();
          const randomNums = Math.floor(1000 + Math.random() * 9000);
          applicationId = `${shortLastName}${randomNums}`;
        } else {
          const randomNums = Math.floor(1000 + Math.random() * 9000);
          applicationId = `APP-${randomNums}`;
        }
        console.log("Generated fresh Application ID:", applicationId);
      }

      const leadPayload: any = {
        title: title // Always use the new title, but don't append history
      };

      if (finalPersonId) leadPayload.person_id = finalPersonId;
      if (organization_id) leadPayload.organization_id = organization_id;
      if (value) leadPayload.value = value;
      if (expected_close_date) leadPayload.expected_close_date = expected_close_date;

      // Application ID
      if (appIdKey) {
        leadPayload[appIdKey] = applicationId;
      }

      // Map custom financing fields to Pipedrive API keys
      const dobKey = process.env.PIPEDRIVE_LEAD_DOB_FIELD_KEY;
      const firstNameKey = process.env.PIPEDRIVE_LEAD_FIRST_NAME_FIELD_KEY;
      const lastNameKey = process.env.PIPEDRIVE_LEAD_LAST_NAME_FIELD_KEY;
      const emailKey = process.env.PIPEDRIVE_LEAD_EMAIL_FIELD_KEY;
      const phoneKey = process.env.PIPEDRIVE_LEAD_PHONE_FIELD_KEY;
      const incomeKey = process.env.PIPEDRIVE_INCOME_FIELD_KEY;
      const housingKey = process.env.PIPEDRIVE_HOUSING_FIELD_KEY;
      const postalKey = process.env.PIPEDRIVE_POSTAL_FIELD_KEY;
      const streetKey = process.env.PIPEDRIVE_STREET_FIELD_KEY;
      const suiteKey = process.env.PIPEDRIVE_SUITE_FIELD_KEY;
      const cityKey = process.env.PIPEDRIVE_CITY_FIELD_KEY;
      const provinceKey = process.env.PIPEDRIVE_PROVINCE_FIELD_KEY;
      const sourceKey = process.env.PIPEDRIVE_LEAD_SOURCE_FIELD_KEY;
      const sourceValue = getLeadSource(utm_source, utm_medium);

      if (dateOfBirth && dobKey && dobKey.trim()) leadPayload[dobKey] = normalizeDate(dateOfBirth);
      if (incomeKey && incomeKey.trim() && annualIncome) leadPayload[incomeKey] = annualIncome;
      if (housingKey && housingKey.trim() && monthlyHousing) leadPayload[housingKey] = monthlyHousing;
      if (postalKey && postalKey.trim() && postalCode) leadPayload[postalKey] = postalCode;
      if (streetKey && streetKey.trim() && streetAddress) leadPayload[streetKey] = streetAddress;
      if (suiteKey && suiteKey.trim() && suite) leadPayload[suiteKey] = suite;
      if (cityKey && cityKey.trim() && city) leadPayload[cityKey] = city;
      if (provinceKey && provinceKey.trim() && province) leadPayload[provinceKey] = province;
      if (sourceKey && sourceKey.trim() && sourceValue) leadPayload[sourceKey] = sourceValue;

      // Handle custom lead fields for identity
      if (firstNameKey && firstNameKey.trim() && firstName) leadPayload[firstNameKey] = firstName;
      if (lastNameKey && lastNameKey.trim() && lastName) leadPayload[lastNameKey] = lastName;
      if (emailKey && emailKey.trim() && email) leadPayload[emailKey] = email;
      if (phoneKey && phoneKey.trim() && phone) leadPayload[phoneKey] = phone;

      // If we don't have separate first/last name but have a 'name' field, split it if keys exist
      if (name && !firstName && !lastName) {
        const parts = name.trim().split(' ');
        if (parts.length > 0) {
          const fName = parts[0];
          const lName = parts.slice(1).join(' ');
          if (firstNameKey && firstNameKey.trim()) leadPayload[firstNameKey] = fName;
          if (lastNameKey && lastNameKey.trim() && lName) leadPayload[lastNameKey] = lName;
        }
      }
      
      // Map "What are you looking to drive?" to Pipedrive "Interested In" field
      const interestedInKey = process.env.PIPEDRIVE_INTERESTED_IN_FIELD_KEY;
      if (vehicleType && interestedInKey && interestedInKey.trim()) {
        leadPayload[interestedInKey] = vehicleType;
      }

      console.log("Sending payload to Pipedrive:", JSON.stringify(leadPayload, null, 2));

      let leadId = recentLead ? recentLead.id : null;
      let dealId = recentDeal ? recentDeal.id : null;

      if (recentLead) {
        // Update existing lead details (custom fields)
        const response = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads/${recentLead.id}?api_token=${apiToken}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadPayload),
        });
        
        if (!response.ok) {
          const data = await response.json();
          console.error("Pipedrive API Update Error:", JSON.stringify(data, null, 2));
        }
      } else if (recentDeal) {
        // Update existing deal details (custom fields) - minus the lead-only title field
        const dealPayload = { ...leadPayload };
        delete dealPayload.title;

        console.log(`Updating existing Deal ${recentDeal.id} with custom fields...`);
        const response = await fetchWithTimeout(`https://api.pipedrive.com/v1/deals/${recentDeal.id}?api_token=${apiToken}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dealPayload),
        });
        
        if (!response.ok) {
          const data = await response.json();
          console.error("Pipedrive API Deal Update Error:", JSON.stringify(data, null, 2));
        }
      } else {
        // Create new lead
        const response = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadPayload),
        });

        const data = await response.json();

        if (!response.ok) {
          console.error("Pipedrive API Error:", JSON.stringify(data, null, 2));
          return res.status(response.status).json({ error: data.error || "Failed to process lead in Pipedrive.", details: data });
        }

        leadId = data.data?.id;
      }

      // Only create a note if it's a NEW lead/deal OR if it's a final submission
      // This prevents "Note Spam" during the multi-step application process
      const existingRecordFound = !!recentLead || !!recentDeal;
      const shouldCreateNote = !existingRecordFound || isFinal;

      if ((leadId || dealId) && shouldCreateNote) {
        console.log("Creating note for (leadId:", leadId, "dealId:", dealId, "isUpdate:", existingRecordFound, "isFinal:", !!isFinal, ")");
        try {
          let notePrefix = '';
          if (isTradeIn) {
            notePrefix = existingRecordFound ? '*** COMPLETED TRADE-IN REQUEST ***\n' : '*** NEW TRADE-IN REQUEST ***\n';
          } else {
            notePrefix = existingRecordFound ? '*** COMPLETED FINANCING APPLICATION ***\n' : '*** NEW FINANCING APPLICATION (Started) ***\n';
          }

          if (isFinal) {
            notePrefix = notePrefix.replace('(Started)', '').replace('NEW', 'COMPLETED');
          }

          let noteContent = `${notePrefix}Application ID: ${applicationId}`;
          
          if (utm_source || utm_medium || utm_campaign) {
            noteContent += `\n\n--- MARKETING SOURCE ---`;
            if (utm_source) noteContent += `\nSource: ${utm_source}`;
            if (utm_medium) noteContent += `\nMedium: ${utm_medium}`;
            if (utm_campaign) noteContent += `\nCampaign: ${utm_campaign}`;
            if (utm_content) noteContent += `\nContent: ${utm_content}`;
            if (utm_term) noteContent += `\nTerm: ${utm_term}`;
          }

          if (incomingNotes) {
            noteContent += `\n\n${incomingNotes}`;
          }

          if (vehicleName) {
            noteContent += `\nInterested in vehicle: ${vehicleName}`;
          }
          if (vehicleUrl) {
            noteContent += `\nVehicle Link: ${vehicleUrl}`;
          }
          if (rep) {
            noteContent += `\nAssigned Rep: ${rep}`;
          }
          
          const notePayload: any = {
            content: noteContent
          };

          if (dealId) {
            notePayload.deal_id = dealId;
          } else if (leadId) {
            notePayload.lead_id = leadId;
          }

          await fetchWithTimeout(`https://api.pipedrive.com/v1/notes?api_token=${apiToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(notePayload),
          });
        } catch (noteErr) {
          console.error("Failed to create Pipedrive note:", noteErr);
        }
      }

      const convEventId2 = crypto.randomUUID();
      const convUrl2 = vehicleUrl || req.get('referer');
      await sendMetaLeadEvent(req, { email, phone, eventId: convEventId2, sourceUrl: convUrl2 });
      await sendTikTokLeadEvent(req, { email, phone, eventId: convEventId2, sourceUrl: convUrl2 });
      res.json({ success: true, isUpdate: existingRecordFound, personId: finalPersonId, leadId: leadId, dealId: dealId });
    } catch (err: any) {
      console.error("Lead creation error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/scout", async (req, res) => {
    const { name, email, phone, desiredVehicle, utm_source, utm_medium, utm_campaign } = req.body;

    const apiToken = process.env.PIPEDRIVE_API_TOKEN;
    if (!apiToken) {
      console.error("[PIPEDRIVE] Missing API Token for /api/scout request");
      return res.status(500).json({ error: "PIPEDRIVE_API_TOKEN is not configured." });
    }

    try {
      // 1. Find or Create Person in Pipedrive
      let personId = await findPipedrivePerson(apiToken, email, phone);

      if (!personId) {
        const personResponse = await fetchWithTimeout(`https://api.pipedrive.com/v1/persons?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: email ? [email] : undefined,
            phone: phone ? [phone] : undefined,
          }),
        });
        const personData = await personResponse.json();
        personId = personData.data?.id;
      } else {
        // Update person with latest contact info
        await fetchWithTimeout(`https://api.pipedrive.com/v1/persons/${personId}?api_token=${apiToken}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            email: email ? [email] : undefined,
            phone: phone ? [phone] : undefined,
          }),
        });
      }

      // 2. Check for recent open lead (within 4 days)
      const recentLead = personId ? await findRecentOpenPipedriveLead(apiToken, personId) : null;
      let leadId = recentLead ? recentLead.id : null;

      if (!recentLead) {
        // Create new lead
        const leadPayload: any = {
          title: `Vehicle Scout: ${name}`,
          person_id: personId,
        };

        const sourceKey = process.env.PIPEDRIVE_LEAD_SOURCE_FIELD_KEY;
        const sourceValue = getLeadSource(utm_source, utm_medium);
        if (sourceKey && sourceValue) {
          leadPayload[sourceKey] = sourceValue;
        }

        // Map contact info into the lead/deal custom fields so it carries over
        // to the deal (leads and deals share custom fields in Pipedrive).
        const firstNameKey = process.env.PIPEDRIVE_LEAD_FIRST_NAME_FIELD_KEY;
        const lastNameKey = process.env.PIPEDRIVE_LEAD_LAST_NAME_FIELD_KEY;
        const emailKey = process.env.PIPEDRIVE_LEAD_EMAIL_FIELD_KEY;
        const phoneKey = process.env.PIPEDRIVE_LEAD_PHONE_FIELD_KEY;
        if (emailKey && emailKey.trim() && email) leadPayload[emailKey] = email;
        if (phoneKey && phoneKey.trim() && phone) leadPayload[phoneKey] = phone;
        if (name && name.trim()) {
          const parts = name.trim().split(' ');
          const fName = parts[0];
          const lName = parts.slice(1).join(' ');
          if (firstNameKey && firstNameKey.trim() && fName) leadPayload[firstNameKey] = fName;
          if (lastNameKey && lastNameKey.trim() && lName) leadPayload[lastNameKey] = lName;
        }

        const leadResponse = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(leadPayload),
        });
        const leadData = await leadResponse.json();
        leadId = leadData.data?.id;
      }

      // 3. Add Note
      if (leadId && desiredVehicle) {
        const notePrefix = recentLead ? '*** UPDATED SCOUT REQUEST (Existing Lead) ***\n' : '';
        let noteContent = `${notePrefix}Desired Vehicle: ${desiredVehicle}`;
        
        if (utm_source || utm_medium || utm_campaign) {
          noteContent += `\n\n--- SOURCE ---`;
          if (utm_source) noteContent += `\nSource: ${utm_source}`;
          if (utm_medium) noteContent += `\nMedium: ${utm_medium}`;
          if (utm_campaign) noteContent += `\nCampaign: ${utm_campaign}`;
        }

        await fetchWithTimeout(`https://api.pipedrive.com/v1/notes?api_token=${apiToken}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: noteContent,
            lead_id: leadId
          }),
        });
      }

      // 4. Send Email Notification
      try {
        const resend = getResendClient();
        await resend.emails.send({
          from: 'VAC Scout <admin@drivevac.ca>',
          to: 'info@vehicleapprovalcentre.com',
          subject: 'New Vehicle Scout Request',
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h1 style="color: #1a1a1a;">New Vehicle Scout Request</h1>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              <p><strong>Phone:</strong> ${phone}</p>
              <p><strong>Desired Vehicle:</strong></p>
              <p style="background: #f9f9f9; padding: 15px; border-radius: 5px;">${desiredVehicle}</p>
              <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
              <p style="font-size: 12px; color: #666;">This lead has also been added to Pipedrive.</p>
            </div>
          `
        });
      } catch (emailErr) {
        console.error("Failed to send scout email notification:", emailErr);
      }

      const convEventId3 = crypto.randomUUID();
      const convUrl3 = req.get('referer');
      await sendMetaLeadEvent(req, { email, phone, eventId: convEventId3, sourceUrl: convUrl3 });
      await sendTikTokLeadEvent(req, { email, phone, eventId: convEventId3, sourceUrl: convUrl3 });
      res.json({ success: true });
    } catch (err: any) {
      console.error("Scout request error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/invite", async (req, res) => {
    const { email, invitedBy, appUrl } = req.body;

    if (!email || !email.endsWith('@drivevac.ca')) {
      return res.status(400).json({ error: "Invalid email domain. Access restricted to authorized accounts only." });
    }

    const finalAppUrl = appUrl || `https://${req.get('host')}`;

    try {
      const resend = getResendClient();
      const { data, error } = await resend.emails.send({
        from: 'VAC Admin <admin@drivevac.ca>',
        to: email,
        subject: "You've been invited to join the VAC Sales Team",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h1 style="color: #1a1a1a;">Welcome to VAC</h1>
            <p>Hi there,</p>
            <p>You've been invited by <strong>${invitedBy || 'an admin'}</strong> to join the VAC Sales Team.</p>
            <p>To get started, please sign in to the application using your authorized company Google account:</p>
            <div style="margin: 30px 0;">
              <a href="${finalAppUrl}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Sign In to VAC</a>
            </div>
            <p style="color: #666; font-size: 14px;">If you have any questions, please contact your administrator.</p>
          </div>
        `
      });

      if (error) {
        console.error("Resend API Error:", error);
        
        let errorMessage = error.message;
        
        // Handle the common "Sandbox" validation error
        if (error.name === 'validation_error' || (error as any).statusCode === 422) {
          errorMessage = "Resend Error: Please ensure your sending domain is fully verified in your Resend dashboard and that you are using a valid 'from' address.";
        }
        
        return res.status(500).json({ error: errorMessage });
      }

      res.json({ success: true, data });
    } catch (err: any) {
      console.error("Invite error:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sync-catalog", async (req, res) => {
    try {
      const result = await syncInventoryToGoogleSheets();
      res.json({ success: true, ...result });
    } catch (error: any) {
      console.error("Manual sync error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/vehicle-features/:vin", async (req, res) => {
    const { vin } = req.params;
    try {
      const response = await fetchWithTimeout(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
      const data = await response.json();
      const result = data.Results[0];

      if (!result) {
        return res.status(404).json({ error: "Vehicle not found" });
      }

      // Extract relevant features
      const features = [
        result.ABS,
        result.AirBagLocFront,
        result.AirBagLocSide,
        result.AirBagLocCurtain,
        result.AirBagLocKnee,
        result.BrakeSystemType,
        result.DaytimeRunningLight,
        result.ElectronicStabilityControl,
        result.TractionControl,
        result.AdaptiveCruiseControl,
        result.AdaptiveHeadlights,
        result.BlindSpotMonitoring,
        result.ForwardCollisionWarning,
        result.LaneDepartureWarning,
        result.ParkingAssist,
      ].filter(f => f && f !== 'Not Applicable' && f !== 'Other');

      res.json({ features });
    } catch (err: any) {
      console.error("Error fetching vehicle features:", err);
      res.status(500).json({ error: "Failed to fetch vehicle features" });
    }
  });

  app.get("/api/carfax/report/:vin", async (req, res) => {
    const { vin } = req.params;
    const accountNumber = process.env.CARFAX_ACCOUNT_NUMBER;

    if (!accountNumber) {
      return res.status(500).json({ error: "CARFAX_ACCOUNT_NUMBER is not configured" });
    }

    try {
      const token = await getCarfaxToken();
      // Report-info returns structured info about the report availability and URLs
      const response = await fetchWithTimeout(`https://api.carfax.ca/v1/partners/car-details/report-info?vin=${vin}&accountNumber=${accountNumber}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 404) {
          return res.status(404).json({ error: "Report not found" });
        }
        const errorText = await response.text();
        console.error(`[Carfax] Report-info error: ${response.status} ${errorText}`);
        return res.status(response.status).json({ error: "Carfax API Error" });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[Carfax] Service error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/decode-vin/:vin", async (req, res) => {
    const { vin } = req.params;
    const apiKey = process.env.MARKETCHECK_API_KEY;
    
    if (apiKey) {
      try {
        // Processing helper for both NeoVIN and Basic Specs
        const processMarketcheckData = (itemData: any) => {
          const featureBadges: string[] = [];
          const safetySuite: string[] = [];
          const comfortAndConvenience: string[] = [];
          const entertainmentAndMedia: string[] = [];
          const safetyAndSecurity: string[] = [];
          const extrasAndPackages: string[] = [];

          // Helper to map and categorize
          const mapCategory = (category: string, item: any) => {
            const cat = (category || "").toLowerCase();
            const desc = (typeof item === 'string' ? item : (item.description || item.item || item.name || item.value || "")).trim();
            if (!desc) return;
            const descLower = desc.toLowerCase();
            const catLower = cat.toLowerCase();

            // Strict Filter — drop specs noise AND non-feature labels that
            // MarketCheck mixes into high_value_features (body class, powertrain
            // type, vague autonomy tags) so shoppers see real features only.
            const ignoreList = ['vin', 'weights', 'dimensions', 'curb', 'chassis', 'suspension', 'warranty', 'axle', 'gvwr', 'capacities',
              'transmission', 'suv', 'sedan', 'coupe', 'hatchback', 'minivan', 'pickup', 'mid-size', 'upper medium', 'lower medium', 'compact car', 'full-size', 'autonomous drive'];
            if (ignoreList.some(term => descLower.includes(term) || catLower.includes(term))) return;
            
            // Categorization
            if (['heated', 'power', 'lumbar', 'climate', 'comfort', 'interior', 'convenience', 'seating', 'seat', 'steering wheel', 'mirrors', 'sunroof', 'moonroof', 'keyless', 'start', 'entry'].some(k => descLower.includes(k) || catLower.includes(k))) {
              comfortAndConvenience.push(desc);
            } else if (['speaker', 'apple', 'android', 'screen', 'entertainment', 'media', 'audio', 'infotainment', 'bluetooth', 'radio', 'usb', 'navigation', 'display'].some(k => descLower.includes(k) || catLower.includes(k))) {
              entertainmentAndMedia.push(desc);
            } else if (['led', 'sensor', 'camera', 'airbag', 'monitor', 'safety', 'driver assist', 'security', 'braking', 'abs', 'lane', 'blind spot', 'collision', 'stability', 'traction'].some(k => descLower.includes(k) || catLower.includes(k))) {
              safetyAndSecurity.push(desc);
              if (['lane', 'blind spot', 'collision', 'adaptive', 'emergency'].some(k => descLower.includes(k))) {
                safetySuite.push(desc);
              }
            } else {
              extrasAndPackages.push(desc);
            }
          };

          // Recursively find features in ANY object structure
          const traverse = (obj: any, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 5) return;
            
            Object.entries(obj).forEach(([key, value]) => {
              if (Array.isArray(value)) {
                // If weight/dimension key, skip
                if (['vin', 'weights', 'dimensions', 'curb', 'chassis', 'suspension', 'warranty', 'axle', 'gvwr', 'capacities'].some(k => key.toLowerCase().includes(k))) return;
                
                value.forEach(item => {
                  if (typeof item === 'string') {
                    mapCategory(key, { description: item });
                  } else if (item && typeof item === 'object') {
                    mapCategory(key, item);
                  }
                });
              } else if (typeof value === 'object') {
                traverse(value, depth + 1);
              }
            });
          };

          console.log(`[Marketcheck] Processing data for VIN: ${vin}. Keys found: ${Object.keys(itemData).join(', ')}`);

          // Only read MarketCheck's CURATED high-value features. The raw
          // `features`/`installed_equipment` lists carry 170+ granular entries
          // (every airbag, tire spec, head restraint) that buried the real
          // features and produced the messy output. high_value_features is the
          // shopper-relevant set MarketCheck already flags.
          const searchKeys = ['high_value_features'];
          
          searchKeys.forEach(key => {
            if (itemData[key]) {
              if (Array.isArray(itemData[key])) {
                itemData[key].forEach((item: any) => {
                  if (typeof item === 'string') {
                    mapCategory(key, { description: item });
                  } else {
                    mapCategory(item.category || key, item);
                  }
                });
              } else if (typeof itemData[key] === 'object') {
                 // Check build/extra sub-keys like std_features and opt_features
                 if (key === 'build' || key === 'extra') {
                    if (Array.isArray(itemData[key].std_features)) {
                      itemData[key].std_features.forEach((f: any) => mapCategory('standard', f));
                    }
                    if (Array.isArray(itemData[key].opt_features)) {
                      itemData[key].opt_features.forEach((f: any) => mapCategory('optional', f));
                    }
                    if (Array.isArray(itemData[key].equipment)) {
                      itemData[key].equipment.forEach((f: any) => mapCategory('equipment', f));
                    }
                 }
                 traverse(itemData[key]);
              }
            }
          });

          // (Intentionally NOT reading the root 170+ item `features` list —
          // high_value_features above is the curated, shopper-facing set.)

          let packages: { name: string; msrp?: number }[] = [];
          if (Array.isArray(itemData.installed_options_details)) {
            packages = itemData.installed_options_details.map((pkg: any) => ({
              name: pkg.name || pkg.description || "",
              msrp: pkg.msrp
            })).filter((pkg: any) => pkg.name);
          } else if (Array.isArray(itemData.options_packages)) {
            packages = itemData.options_packages.map((pkg: any) => ({
              name: typeof pkg === 'string' ? pkg : (pkg.name || pkg.description || ""),
              msrp: typeof pkg === 'string' ? undefined : pkg.msrp
            })).filter((pkg: any) => pkg.name);
          }

          return {
            ...itemData,
            featureBadges: Array.from(new Set(featureBadges)),
            packages,
            safetySuite: Array.from(new Set(safetySuite)),
            baseMsrp: itemData.msrp || itemData.base_msrp || itemData.baseMsrp,
            totalMsrp: itemData.combined_msrp || itemData.total_msrp || itemData.totalMsrp,
            manufacturerColor: itemData.exterior_color?.name || itemData.exterior_color || itemData.manufacturerColor,
            exteriorColorBase: itemData.exterior_color?.base || itemData.exterior_color || itemData.exteriorColor,
            interiorColor: itemData.interior_color?.name || itemData.interior_color || itemData.interiorColor,
            transmissionDescription: itemData.transmission_description || itemData.transmission || itemData.transmissionDescription,
            trimConfidence: itemData.trim_confidence,
            seats: itemData.seating_capacity || itemData.seatingCapacity,
            cityMpg: itemData.city_mpg || itemData.cityMpg,
            highwayMpg: itemData.highway_mpg || itemData.highwayMpg,
            engine: itemData.engine || itemData.engineDescription,
            drivetrain: itemData.drivetrain,
            fuelType: itemData.fuel_type || itemData.fuelType,
            bodyType: itemData.body_type || itemData.bodyType,
            comfortAndConvenience: Array.from(new Set(comfortAndConvenience)),
            entertainmentAndMedia: Array.from(new Set(entertainmentAndMedia)),
            safetyAndSecurity: Array.from(new Set(safetyAndSecurity)),
            extrasAndPackages: Array.from(new Set(extrasAndPackages)),
            width: itemData.width,
            height: itemData.height,
            length: itemData.length,
            wheelbase: itemData.wheelbase,
            curbWeight: itemData.weight || itemData.curb_weight,
            manufacturerCode: itemData.manufacturer_code,
            packageCode: itemData.package_code,
            // Market position from LIVE Canadian comparable listings (see below).
            marketPriceRating: itemData.market_comps?.rating,
            marketPriceDifference: itemData.market_comps?.difference,
            marketSampleSize: itemData.market_comps?.count,
            marketMedian: itemData.market_comps?.median,
          };
        };

        // NeoVIN full-specs endpoint (the /specs suffix is required — without it
        // the API 404s, which is why the decode used to silently fall back to
        // NHTSA and never populated features).
        const neoResponse = await fetchWithTimeout(`https://api.marketcheck.com/v2/decode/car/neovin/${vin}/specs?api_key=${apiKey}&include_generic=true&include_available_options=true`, {
          headers: {
            'Accept': 'application/json'
          }
        });
        let finalData: any = {};
        if (neoResponse.ok) {
          finalData = await neoResponse.json();
          console.log(`Successfully fetched NeoVIN for ${vin}`);
        } else {
          console.log(`Marketcheck NeoVIN status ${neoResponse.status}, falling back to basic specs`);
        }

        // (Dropped the extra /specs, /market/rank and /history calls: NeoVIN
        // already carries the features we use; the US-only /market/rank never
        // populated for Canadian cars; and vehicle history comes from Carfax.)

        // Market position from LIVE Canadian comparable listings. This is the
        // Canada-reliable replacement for /market/rank — we pull the median
        // asking price of the same year/make/model in a mileage band and rate
        // this car's price against it. Best-effort: never blocks the decode.
        try {
          const askingPrice = Number(req.query.price) || undefined;
          const km = Number(req.query.miles) || undefined;
          const yr = finalData.year, mk = finalData.make, md = finalData.model;
          if (yr && mk && md) {
            const compUrl = new URL('https://api.marketcheck.com/v2/search/car/active');
            compUrl.searchParams.set('api_key', apiKey);
            compUrl.searchParams.set('country', 'CA');
            compUrl.searchParams.set('year', String(yr));
            compUrl.searchParams.set('make', String(mk));
            compUrl.searchParams.set('model', String(md));
            if (km) compUrl.searchParams.set('miles_range', `${Math.max(0, km - 35000)}-${km + 35000}`);
            compUrl.searchParams.set('stats', 'price');
            compUrl.searchParams.set('rows', '0');
            const compRes = await fetchWithTimeout(compUrl.toString());
            if (compRes.ok) {
              const cj: any = await compRes.json();
              const st = cj?.data?.stats?.price || cj?.stats?.price;
              const median = st?.median, count = st?.count || 0;
              // Need a credible sample before showing any badge.
              if (median && count >= 12) {
                const comps: any = { median, count, low: st.min, high: st.max };
                if (askingPrice) {
                  const ratio = askingPrice / median;
                  comps.rating = ratio <= 0.94 ? 'Great Price'
                    : ratio <= 1.00 ? 'Good Price'
                    : ratio <= 1.08 ? 'Fair Price'
                    : 'High Price';
                  comps.difference = Math.round(median - askingPrice); // + = below market
                }
                finalData.market_comps = comps;
                console.log(`[Marketcheck] ${count} CA comps for ${yr} ${mk} ${md}, median $${median}`);
              } else {
                console.log(`[Marketcheck] Only ${count} CA comps — skipping price rating`);
              }
            }
          }
        } catch (compErr) {
          console.log("Marketcheck comps skip:", compErr);
        }

        if (Object.keys(finalData).length > 0) {
          console.log(`[Marketcheck] Successfully merged data for VIN: ${vin}`);
          const extendedData = processMarketcheckData(finalData);
          
          // Debug check for features
          const featureCount = (extendedData.comfortAndConvenience?.length || 0) + 
                               (extendedData.entertainmentAndMedia?.length || 0) + 
                               (extendedData.safetyAndSecurity?.length || 0) + 
                               (extendedData.extrasAndPackages?.length || 0);
          
          console.log(`[Marketcheck] Extracted ${featureCount} features for ${vin}`);
          
          return res.json({ source: 'marketcheck-merged', data: extendedData });
        }
        
        console.warn(`Marketcheck API failed, falling back to NHTSA vPIC`);
      } catch (err) {
        console.error("Error with Marketcheck API:", err);
      }
    }

    try {
      const response = await fetchWithTimeout(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`);
      const data = await response.json();
      res.json({ source: 'nhtsa', data });
    } catch (err: any) {
      console.error("Error decoding VIN with NHTSA:", err);
      res.status(500).json({ error: "Failed to decode VIN" });
    }
  });

  app.get("/api/test-raw-marketcheck/:vin", async (req, res) => {
    const { vin } = req.params;
    const apiKey = process.env.MARKETCHECK_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "No API Key" });
    try {
      const neoResponse = await fetchWithTimeout(`https://api.marketcheck.com/v2/decode/car/neovin/${vin}?api_key=${apiKey}`, {
        headers: {
          'Accept': 'application/json'
        }
      });
      const data = await neoResponse.json();
      res.json({ rawData: data });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/test-raw-marketcheck-specs/:vin", async (req, res) => {
    const { vin } = req.params;
    const apiKey = process.env.MARKETCHECK_API_KEY;
    if (!apiKey) return res.status(500).json({ error: "No API Key" });
    try {
      const response = await fetchWithTimeout(`https://mc-api.marketcheck.com/v2/decode/car/${vin}/specs?api_key=${apiKey}`);
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // Removed /api/chat endpoint to disable chat widget functionality

  // Google Chat Real-time Integration
  app.post("/api/chat/send", async (req, res) => {
    const { conversationId, text, userName } = req.body;
    const webhookUrl = process.env.GOOGLE_CHAT_WEBHOOK_URL;
    
    if (!webhookUrl) {
      console.warn("[CHAT] No GOOGLE_CHAT_WEBHOOK_URL configured");
      return res.json({ success: true, warning: 'No webhook configured' });
    }

    try {
      const { admin, db } = await getFirestoreAdmin();
      
      const convDoc = await db.collection('chats').doc(conversationId).get();
      const convData = convDoc.data();
      
      // We use the conversationId as a threadKey to group messages in Google Chat
      const gChatUrl = new URL(webhookUrl);
      gChatUrl.searchParams.set('threadKey', conversationId);
      gChatUrl.searchParams.set('messageReplyOption', 'REPLY_CONTROL_UNSPECIFIED');

      const payload = {
        text: `*Website Inquiry: ${userName}*\nID: \`${conversationId}\`\n\n> ${text}`
      };

      const response = await fetch(gChatUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const data = await response.json();
        // Capture the thread name for two-way communication
        if (data.thread?.name && !convData?.googleThreadName) {
          await db.collection('chats').doc(conversationId).update({
            googleThreadName: data.thread.name,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      } else {
        const errText = await response.text();
        console.error("[CHAT] Google Chat Webhook Error:", response.status, errText);
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[CHAT] Send error:", error);
      res.status(500).json({ error: 'Failed to relay message' });
    }
  });

  app.post("/api/webhooks/google-chat", async (req, res) => {
    const event = req.body;
    
    // Google Chat Webhook verification (optional but recommended)
    // For now, check if it's a MESSAGE event
    if (event.type !== 'MESSAGE' || !event.message || event.message.sender?.type === 'BOT') {
      return res.json({ type: 'STATUS_OK' });
    }

    const text = event.message.text;
    const threadName = event.message.thread?.name;
    
    if (!threadName) return res.json({ type: 'STATUS_OK' });

    try {
      const { admin, db } = await getFirestoreAdmin();
      
      // Find conversation by thread name
      const chatsRef = db.collection('chats');
      const snapshot = await chatsRef.where('googleThreadName', '==', threadName).limit(1).get();
      
      if (!snapshot.empty) {
        const convId = snapshot.docs[0].id;
        
        // Add message to Firestore
        await db.collection('chats').doc(convId).collection('messages').add({
          text,
          sender: 'team',
          timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Update conversation summary
        await db.collection('chats').doc(convId).update({
          lastMessage: text,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`[CHAT] Relayed message from Google Chat to web user: ${convId}`);
      }

      res.json({ type: 'STATUS_OK' });
    } catch (error) {
      console.error("[CHAT] Webhook processing error:", error);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // --- Vehicle Approval Centre pre-approval funnel → lead buyers ---
  // Served at apply.vehicleapprovalcentre.com. This endpoint collects a
  // completed, consented application, PERSISTS it (Firestore `dvLeads`), and
  // fans it out to one or more configurable buyer webhooks. It is deliberately
  // isolated from the VAC dealership pipeline: it NEVER touches Pipedrive / the
  // AI queue (that lives in POST /api/leads). Applications here are a separate
  // product that gets sold to outside dealers.
  //
  // Config (env):
  //   BUYER_WEBHOOK_URLS       comma-separated buyer/distribution endpoints
  //   BUYER_WEBHOOK_URL        single endpoint (added to the list above)
  //   N8N_LEAD_WEBHOOK_URL     legacy single endpoint (kept for back-compat)
  //   DV_DEDUPE_WINDOW_MINUTES suppress re-selling the same email/phone within
  //                            this many minutes (default 1440 = 24h)
  const DV_CONSENT_VERSION = "2026-08-03-v2"; // bump when the consent wording changes
  const DV_DEDUPE_WINDOW_MINUTES = Number(process.env.DV_DEDUPE_WINDOW_MINUTES) || 1440;

  const buyerWebhooks = (): string[] => {
    const list = [
      ...(process.env.BUYER_WEBHOOK_URLS || "").split(","),
      process.env.BUYER_WEBHOOK_URL || "",
      process.env.N8N_LEAD_WEBHOOK_URL || "",
    ].map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set(list)); // de-dupe if the same URL is listed twice
  };

  const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  const normPhone = (p: any) => (p || "").toString().replace(/\D/g, "");

  // --- Lead distribution: which dealer buys each lead (EXCLUSIVE model) ---
  // Each completed application is assigned to exactly ONE dealer and emailed to
  // them via Resend. Single dealer today; onboarding another buyer later (by
  // territory or monthly cap) is just another entry here + smarter assignDealer()
  // — no other code changes. Dealer address/sender are overridable via env.
  type Dealer = { id: string; name: string; email: string; active: boolean; territories?: string[]; monthlyCap?: number };
  const DEALERS: Dealer[] = [
    {
      id: "arc-auto",
      name: "Arc Auto Sales (Colin Ledaire)",
      email: process.env.LEAD_DEALER_EMAIL || "colin@arcautosales.ca",
      active: true,
      territories: [],   // empty = all provinces
      monthlyCap: 150,
    },
    {
      id: "vac",
      name: "Vehicle Approval Centre",
      email: process.env.VAC_DEALER_EMAIL || "j.jackson@drivevac.ca",
      // Turned OFF 2026-08-17 — VAC now gets its own leads via /apply-now → its own
      // Pipedrive, so the funnel (apply.*) routes 100% to Arc Auto. Flip back to true to re-enable.
      active: false,
      territories: [],
    },
  ];
  const LEAD_FROM_EMAIL = process.env.LEAD_FROM_EMAIL || "VAC Leads <leads@drivevac.ca>";

  // Assign a lead to ONE dealer (exclusive). With multiple active dealers we
  // round-robin evenly via a persistent counter (strict alternate, going forward).
  // Add territory/weight rules here later. Falls back to the first active dealer
  // so a lead is never lost if the counter read fails.
  // Dealer on/off is admin-editable — stored in Firestore (dvRouting/dealerStatus),
  // overriding each dealer's code default. Returns the effectively-active dealers.
  const effectiveDealers = async (db: any): Promise<Dealer[]> => {
    let overrides: Record<string, boolean> = {};
    try {
      const snap = await db.collection("dvRouting").doc("dealerStatus").get();
      if (snap.exists) overrides = snap.data() || {};
    } catch {}
    return DEALERS.filter((d) => (typeof overrides[d.id] === "boolean" ? overrides[d.id] : d.active));
  };

  const assignDealer = async (db: any): Promise<Dealer | null> => {
    const active = await effectiveDealers(db);
    if (active.length <= 1) return active[0] || null;
    try {
      const ref = db.collection("dvRouting").doc("roundRobin");
      const idx = await db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        const cur = snap.exists ? (snap.data().next || 0) : 0;
        tx.set(ref, { next: cur + 1 }, { merge: true });
        return cur;
      });
      return active[idx % active.length];
    } catch {
      return active[0];
    }
  };

  // Human-readable lead sheet the dealer can act on the moment it lands.
  const renderLeadEmail = (r: any): string => {
    const a = r.applicant || {};
    const addr = a.address || {};
    const v = r.vehicle || {};
    const e = r.employment || {};
    const h = r.housing || {};
    const el = r.eligibility || {};
    const mk = r.marketing || {};
    const fmt = (iso: string) => { try { return new Date(iso).toLocaleString("en-CA", { timeZone: "America/Halifax" }); } catch { return iso; } };
    const money = (x: any) => (x ? `$${x}` : "");
    // DOB is captured DD/MM/YYYY on the funnel; render the month as a word so a
    // dealer can never misread it as American MM/DD (e.g. 07/05/1992 -> 7 May 1992).
    const fmtDob = (s: any) => {
      if (typeof s !== "string") return s;
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return s;
      const dd = +m[1], mm = +m[2];
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return s;
      const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      return `${dd} ${M[mm - 1]} ${m[3]}`;
    };
    const row = (label: string, val: any) =>
      val === undefined || val === null || val === ""
        ? ""
        : `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:4px 0;color:#111;font-weight:600;word-break:break-word">${val}</td></tr>`;
    const section = (title: string, rows: string) =>
      rows ? `<h3 style="margin:22px 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#41456B">${title}</h3><table style="border-collapse:collapse;font-size:14px">${rows}</table>` : "";
    return `
      <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;padding:24px;color:#111">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7380FF">New Pre-Approval Lead</div>
        <h2 style="margin:4px 0 2px;font-size:22px">${[a.firstName, a.lastName].filter(Boolean).join(" ") || "Applicant"}</h2>
        <div style="color:#6b7280;font-size:13px">Submitted ${fmt(r.submittedAt)} (Atlantic)</div>
        ${section("Contact", row("Phone", a.phone) + row("Email", a.email) + row("Date of birth", fmtDob(a.dob)) + row("Address", [addr.street, addr.suite, addr.city, addr.province, addr.postal].filter(Boolean).join(", ")))}
        ${section("Vehicle", row("Looking for", v.type) + row("Budget", v.budgetBand) + row("Trade-in", v.tradeIn) + row("Down payment", money(v.downPayment)))}
        ${section("Credit", row("Self-rating", (r.credit || {}).selfRating))}
        ${section("Employment & income", row("Status", e.status) + row("Employer", e.employer) + row("Job title", e.jobTitle) + row("Income type", e.incomeType) + row("Gross income", money(e.grossIncome)) + row("Hours/week", e.hoursPerWeek) + row("Time on job", e.timeOnJob && (e.timeOnJob.years || e.timeOnJob.months) ? `${e.timeOnJob.years || 0}y ${e.timeOnJob.months || 0}m` : "") + row("Income source", e.incomeSource))}
        ${section("Housing", row("Own/Rent", h.ownOrRent) + row("Monthly payment", money(h.monthlyPayment)) + row("Time at address", h.timeAtAddress && (h.timeAtAddress.years || h.timeAtAddress.months) ? `${h.timeAtAddress.years || 0}y ${h.timeAtAddress.months || 0}m` : ""))}
        ${section("Eligibility", row("Citizen/PR", el.citizenOrPR) + row("Valid licence", el.validLicense))}
        ${section("Marketing source", row("Source", mk.utm_source) + row("Medium", mk.utm_medium) + row("Campaign", mk.utm_campaign) + row("Content", mk.utm_content) + row("Term", mk.utm_term) + row("gclid", mk.gclid) + row("fbclid", mk.fbclid))}
        <div style="margin-top:22px;padding:12px 14px;background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;font-size:12px;color:#475569">
          &#10003; Consent captured${r.consent?.timestamp ? " on " + fmt(r.consent.timestamp) : ""} &mdash; applicant authorized contact and a credit check (consent v${r.consent?.textVersion || "?"}, IP ${r.consent?.ip || "n/a"}).
        </div>
      </div>`;
  };

  // Dealership pre-approval form (vehicleapprovalcentre.com/apply-now, full-form style).
  // UNLIKE /api/dv-lead (the lead-gen brokerage that sells to partners), this lands the
  // applicant in the dealership's OWN Pipedrive as a LEAD — never a deal — with the full
  // application in a note. Best-effort Firestore copy so nothing is ever lost.
  // --- In-house CRM lead distribution (Phase A: event-driven round-robin) ---
  // Business hours for auto-assignment: Mon–Fri, 9am–8pm Atlantic. Outside this
  // window leads hold in the Inbox pool until the next business morning (and a rep
  // being active). Fail-open: if the TZ calc ever throws, we don't block assignment.
  const BIZ_TZ = "America/Halifax";
  const BIZ_START = 9;   // 9am
  const BIZ_END = 20;    // 8pm
  const isBusinessHours = (): boolean => {
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: BIZ_TZ, weekday: "short", hour: "2-digit", hour12: false }).formatToParts(new Date());
      const wd = parts.find((p) => p.type === "weekday")?.value || "";
      let hr = Number(parts.find((p) => p.type === "hour")?.value);
      if (!Number.isFinite(hr)) return true;
      if (hr === 24) hr = 0;
      const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(wd);
      return weekday && hr >= BIZ_START && hr < BIZ_END;
    } catch { return true; }
  };

  // Assign an unassigned crmLeads doc to the next active rep. "Next" = the active
  // rep assigned least recently (fair rotation). Returns the rep, or null if nobody
  // is signed in as active — in which case the lead waits in the admin Inbox.
  // Normalized phone key (last 10 digits) — used to match Quo call/text webhooks
  // to a crmLead regardless of formatting (+1, dashes, spaces, etc.).
  const phoneKeyOf = (raw: any): string => String(raw ?? "").replace(/\D+/g, "").slice(-10);

  const assignToNextActiveRep = async (db: any, leadDocRef: any): Promise<{ id: string; name: string | null } | null> => {
    const ps = await db.collection("crmReps").where("active", "==", true).get();
    if (ps.empty) return null;
    const candidates = ps.docs.map((d: any) => ({
      id: d.id,
      name: d.get("name") || null,
      last: d.get("lastAssignedAt") ? Date.parse(d.get("lastAssignedAt")) : 0,
    }));
    candidates.sort((a: any, b: any) => a.last - b.last); // least-recently-assigned first (fair rotation)
    const pick = candidates[0];
    const now = new Date().toISOString();
    await leadDocRef.update({ owner: pick.id, ownerName: pick.name || null, assignedAt: now, updatedAt: now });
    await db.collection("crmReps").doc(pick.id).update({ lastAssignedAt: now });
    return { id: pick.id, name: pick.name };
  };

  // ---- Phase B: scheduled tick (Cloud Scheduler → here every few minutes) ----
  // Guarded by CRM_TICK_SECRET (header x-tick-secret or ?secret=). Does two things:
  //  1. FREE-TO-CALL: any lead that has sat in attempting_contact for >= FREE_TO_CALL_BDAYS
  //     business days (Mon–Fri, Atlantic) is released back to the pool (owner=null,
  //     stage=new_lead) with an activity note. Must match FREE_TO_CALL_BDAYS in CrmPanel.tsx.
  //  2. DRIP: during business hours, unassigned Inbox leads are handed to active reps in
  //     rotation (closes the gap where a rep goes active but nothing re-checks the pool).
  const FREE_TO_CALL_BDAYS = 3;
  // "Jane Doe <jane@x.com>" → "Jane Doe"; "jane@x.com" → "jane@x.com"
  const nameOfHeader = (h: string): string => { const m = String(h || "").match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/); return (m ? m[1].trim() : String(h || "").trim()); };

  // Extract the plain-text body of a Gmail message and strip the noise a reply carries:
  // quoted previous messages ("On Mon, X wrote:", "> lines"), signature blocks ("-- ",
  // "Sent from my iPhone"), and long runs of blank lines. Keeps just what they typed.
  const cleanEmailBody = (m: any): string => {
    const b64 = (s: string) => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const findPart = (p: any, mime: string): string | null => {
      if (!p) return null;
      if (p.mimeType === mime && p.body?.data) return b64(p.body.data);
      for (const c of p.parts || []) { const r = findPart(c, mime); if (r) return r; }
      return null;
    };
    let text = findPart(m.payload, "text/plain");
    if (!text) {
      const html = findPart(m.payload, "text/html");
      if (html) text = html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    }
    if (!text) text = String(m.snippet || "");
    text = text.replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const t = l.trim();
      // Stop at quoted-reply markers / signature separators.
      if (/^On .+ wrote:\s*$/i.test(t)) break;
      if (/^On .+,\s*\d{4}.*$/i.test(t) && i + 1 < lines.length && /wrote:\s*$/i.test(lines[i + 1].trim())) break;
      if (/^-{2,}\s*$/.test(t)) break;                              // "-- " sig separator
      if (/^_{5,}|^-{5,}\s*$|^From:\s.+/i.test(t)) break;           // Outlook-style separators
      if (/^(Sent from my|Get Outlook for|Envoyé de mon)/i.test(t)) break;
      // WiseStamp / HTML-signature plain-text renderings: "[image: photo]", "[image: facebook] <https://…>", "* Mobile * 902…"
      if (/^\[image:\s*[^\]]*\]/i.test(t) && (/facebook|instagram|youtube|linkedin|logo|photo|tpx/i.test(t) || /<https?:\/\//.test(t))) break;
      if (/^\*\s*(Mobile|Phone|Website|Email|Address)\s*\*/i.test(t)) break;
      if (/^[A-Z][a-z]+ [A-Z][a-z]+\s*$/.test(t) && i + 1 < lines.length && /(Founder|Manager|Consultant|Sales|Advisor|Specialist|Vehicle Approval Centre)/i.test(lines[i + 1])) break;
      if (t.startsWith(">")) continue;                             // quoted lines
      out.push(l);
    }
    let cleaned = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    // Photo-only / signature-only reply: if what's left is just a "Name\nTitle, Company…" block, show nothing.
    if (/^[A-Z][a-z]+ [A-Z][a-z]+\s*\n\s*(Founder|Manager|Consultant|Sales|Advisor|Specialist)[^\n]*Vehicle Approval Centre/i.test(cleaned) || /^[A-Z][a-z]+ [A-Z][a-z]+\s+(Founder|Manager|Consultant|Sales|Advisor|Specialist)\b/i.test(cleaned)) cleaned = "";
    // Signature heuristics: cut at a line that's the sender's own name/title if followed by contact-y lines.
    const sigIdx = cleaned.search(/\n(?:[A-Z][a-z]+ [A-Z][a-z]+\s*\n(?:.*\n){0,2}.*(?:Mobile|Phone|Website|Founder|Manager|Sales|Email)\b)/);
    if (sigIdx > 20) cleaned = cleaned.slice(0, sigIdx).trim();
    if (!cleaned) {
      const snip = String(m.snippet || "");
      // If the snippet itself is just signature/image noise, return empty (attachment carries the message).
      if (/^\s*(\[image:|Justin Jackson|[A-Z][a-z]+ [A-Z][a-z]+ (Founder|Manager|Consultant|Sales|Advisor))/i.test(snip)) return "";
      return snip.slice(0, 300);
    }
    return cleaned;
  };

  // Pull any NEW customer replies from a lead's Gmail thread into its activityLog.
  // Reads the thread AS the rep who started it. Idempotent (tracks seen message ids).
  // Used by the 5-min tick (background) and by the drawer on open (instant).
  // Heads-up SMS to a rep's own phone (their Quo/mobile number), sent from the shared VAC line.
  // Used when a customer replies by email — reps reliably see texts, not always email.
  const notifyRepBySms = async (db: any, repId: string, text: string): Promise<boolean> => {
    try {
      const apiKey = process.env.QUO_API_KEY; const from = process.env.QUO_FROM_NUMBER;
      if (!apiKey || !from || !repId) return false;
      const rep = await db.collection("crmReps").doc(repId).get();
      if (!rep.exists || rep.get("poolAccount")) return false;
      const to = String(rep.get("mobile") || rep.get("quoNumber") || "").replace(/\D+/g, "");
      if (to.length < 10) return false;
      const e164 = (n: string) => (n.length === 10 ? `+1${n}` : `+${n}`);
      // Don't text the shared line to itself.
      if (e164(to) === e164(String(from).replace(/\D+/g, ""))) return false;
      const r = await fetchWithTimeout("https://api.openphone.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ from: e164(String(from).replace(/\D+/g, "")), to: [e164(to)], content: text.slice(0, 1500) }),
      });
      return r.ok;
    } catch (e: any) { console.error("[NOTIFY-REP] failed:", e?.message || e); return false; }
  };

  const importLeadEmails = async (db: any, admin: any, d: any, gmailCache?: Map<string, any>): Promise<{ imported: number; entries: any[] }> => {
    const et: any = d.get("emailThread") || {};
    if (!et.threadId || !et.repEmail) return { imported: 0, entries: [] };
    const nowIso = new Date().toISOString();
    let gm = gmailCache?.get(et.repEmail);
    if (!gm) { gm = await gmailAs(et.repEmail); gmailCache?.set(et.repEmail, gm); }
    const th = await gm.users.threads.get({ userId: "me", id: et.threadId, format: "full" });
    const msgs: any[] = th.data.messages || [];
    const seen: string[] = d.get("emailSeenIds") || [];
    const log: any[] = d.get("activityLog") || [];
    const known = new Set([...seen, ...log.map((a) => a && a.gmailId).filter(Boolean)]);
    const leadEmail = String(d.get("email") || "").toLowerCase();
    const newEntries: any[] = []; const newIds: string[] = [];
    for (const m of msgs) {
      if (!m.id || known.has(m.id)) continue;
      const hdr = (n: string) => (m.payload?.headers || []).find((h: any) => String(h.name).toLowerCase() === n.toLowerCase())?.value || "";
      const from = String(hdr("From")).toLowerCase();
      const labels: string[] = m.labelIds || [];
      // Only the CUSTOMER's messages — skip ours (SENT / from the rep) and drafts.
      const isOurs = labels.includes("SENT") || from.includes(String(et.repEmail).toLowerCase());
      if (isOurs || labels.includes("DRAFT")) { newIds.push(m.id); continue; }
      const body = cleanEmailBody(m);
      // Real attachments (skip inline signature icons: tiny images / no filename / content-id-only)
      const atts: { id: string; filename: string; mimeType: string; size: number }[] = [];
      const walk = (part: any) => {
        if (!part) return;
        const fn = part.filename || "";
        const aid = part.body?.attachmentId;
        const size = Number(part.body?.size || 0);
        const cid = (part.headers || []).some((h: any) => String(h.name).toLowerCase() === "content-id");
        const disp = String((part.headers || []).find((h: any) => String(h.name).toLowerCase() === "content-disposition")?.value || "");
        const inlineSig = cid && (size < 40_000 || /^(image0|facebook|instagram|youtube|linkedin|logo|__tpx__)/i.test(fn)) && !/attachment/i.test(disp);
        if (fn && aid && !inlineSig) atts.push({ id: aid, filename: fn, mimeType: part.mimeType || "application/octet-stream", size });
        for (const c of part.parts || []) walk(c);
      };
      walk(m.payload);
      const at = m.internalDate ? new Date(Number(m.internalDate)).toISOString() : nowIso;
      const fromLabel = nameOfHeader(hdr("From")) || (leadEmail && from.includes(leadEmail) ? "Customer" : hdr("From")) || "Customer";
      const subj = String(hdr("Subject") || et.subject || "(no subject)").replace(/^(re|fwd?):\s*/i, "");
      const attNote = atts.length ? `\n📎 ${atts.map((a) => a.filename).join(", ")}` : "";
      newEntries.push({ text: `📧 Email received — ${subj}\n${body.slice(0, 2000)}${attNote}`, by: fromLabel, at, kind: "email", direction: "inbound", from: hdr("From"), subject: hdr("Subject"), gmailId: m.id, gmailThreadId: et.threadId, mailbox: et.repEmail, attachments: atts });
      newIds.push(m.id);
    }
    if (newEntries.length || newIds.length) {
      const upd: any = { emailSeenIds: admin.firestore.FieldValue.arrayUnion(...newIds) };
      if (newEntries.length) {
        upd.activityLog = admin.firestore.FieldValue.arrayUnion(...newEntries);
        upd.updatedAt = nowIso;
        upd["emailThread.lastInboundAt"] = newEntries[newEntries.length - 1].at;
      }
      await d.ref.update(upd);
      // Heads-up to the rep who owns this lead: customers replying by email is a hot signal.
      if (newEntries.length && d.get("owner")) {
        const leadName = [d.get("firstName"), d.get("lastName")].filter(Boolean).join(" ") || "A lead";
        const last = newEntries[newEntries.length - 1];
        const preview = String(last.text || "").split("\n").slice(1).join(" ").replace(/📎.*$/s, "").trim().slice(0, 140);
        const link = `https://vehicleapprovalcentre.com/admin?tab=crm&lead=${d.id}`;
        const msg = `📧 ${leadName} replied to your email${newEntries.length > 1 ? ` (${newEntries.length} new)` : ""}${preview ? `: “${preview}${preview.length >= 140 ? "…" : ""}”` : ""}\nOpen: ${link}`;
        notifyRepBySms(db, d.get("owner"), msg).catch(() => {});
      }
    }
    return { imported: newEntries.length, entries: newEntries };
  };
  const businessDaysBetween = (fromIso: string, now: Date): number => {
    // Business days (Mon–Fri, Atlantic) elapsed AFTER the entry day, through today.
    // Entered Mon: Mon=0, Tue=1, Wed=2, Thu=3 → released Thu (3 business days used up).
    // Entered Fri: Fri=0, Mon=1, Tue=2, Wed=3 → weekend didn't count.
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: BIZ_TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
    const info = (d: Date) => { const p = fmt.formatToParts(d); const g = (t: string) => p.find((x) => x.type === t)?.value || ""; return { key: `${g("year")}-${g("month")}-${g("day")}`, wd: g("weekday") }; };
    const endKey = info(now).key;
    let n = 0;
    const cur = new Date(fromIso);
    cur.setUTCDate(cur.getUTCDate() + 1); // start counting the day AFTER entry
    for (let i = 0; i < 400; i++) {
      const { key, wd } = info(cur);
      if (key > endKey) break;
      if (wd !== "Sat" && wd !== "Sun") n++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return n;
  };
  app.all("/api/crm/tick", async (req, res) => {
    try {
      const secret = process.env.CRM_TICK_SECRET || "";
      const given = String(req.get("x-tick-secret") || req.query.secret || "");
      if (!secret || given !== secret) return res.status(403).json({ error: "Forbidden." });
      const { admin, db } = await getFirestoreAdmin();
      const now = new Date(); const nowIso = now.toISOString();
      const out: any = { released: [], dripped: [], businessHours: isBusinessHours() };

      // 1) Free-to-Call release
      const ac = await db.collection("crmLeads").where("stage", "==", "attempting_contact").get();
      for (const d of ac.docs) {
        // FIRST time it ever entered Attempting Contact — bouncing out and back doesn't reset the clock.
        const hist: any[] = d.get("stageHistory") || [];
        const entered = d.get("attemptingSince") || hist.find((h) => h && h.to === "attempting_contact")?.at || d.get("updatedAt") || d.get("addTime");
        if (!entered) continue;
        const bd = businessDaysBetween(String(entered), now);
        if (bd >= FREE_TO_CALL_BDAYS) {
          const prevOwner = d.get("ownerName") || d.get("owner") || "unassigned";
          // Tally what the rep actually did while they had it — shows in the note so
          // the next rep (and the manager) can see effort vs. a lead that just sat.
          const sinceMs = Date.parse(String(entered));
          const log: any[] = d.get("activityLog") || [];
          const mine = log.filter((a) => a && a.at && Date.parse(a.at) >= sinceMs && a.by !== "System" && !String(a.text || "").startsWith("♻️"));
          const calls = mine.filter((a) => a.kind === "call" && a.direction !== "inbound").length;
          const texts = mine.filter((a) => a.kind === "text" && a.direction !== "inbound").length;
          const notes = mine.filter((a) => !a.kind || a.kind === "note").length;
          const inbound = mine.filter((a) => a.direction === "inbound").length;
          const effort = `${calls} call${calls === 1 ? "" : "s"}, ${texts} text${texts === 1 ? "" : "s"}, ${notes} note${notes === 1 ? "" : "s"}${inbound ? `, ${inbound} customer repl${inbound === 1 ? "y" : "ies"}` : ", no customer reply"}`;
          await d.ref.update({
            stage: "free_to_call", owner: null, ownerName: null, assignedAt: null, updatedAt: nowIso,
            releasedAt: nowIso, releasedFrom: d.get("owner") || null, releasedFromName: d.get("ownerName") || null,
            releaseStats: { calls, texts, notes, inbound, bdays: bd, from: d.get("owner") || null, fromName: prevOwner },
            stageHistory: admin.firestore.FieldValue.arrayUnion({ from: "attempting_contact", to: "free_to_call", by: "system:free-to-call", byUid: null, at: nowIso }),
            activityLog: admin.firestore.FieldValue.arrayUnion({ text: `♻️ Released to Free-to-Call pool after ${bd} business days in Attempting Contact (limit ${FREE_TO_CALL_BDAYS}). Was with ${prevOwner} — ${effort}.`, by: "System", at: nowIso, kind: "note" }),
          });
          out.released.push({ id: d.id, name: [d.get("firstName"), d.get("lastName")].filter(Boolean).join(" "), from: prevOwner, bdays: bd, effort });
        }
      }

      // 1b) HOT-LEAD BOUNCE: a fresh lead (new_lead) assigned ≥30 min ago that its rep hasn't
      //     touched yet (no outbound call/text/email/note from them since assignment) bounces to
      //     the next active rep. Business hours only. Fresh leads are gold — don't let one sit.
      out.bounced = [];
      if (out.businessHours) {
        try {
          const HOT_MIN = 30;
          const cutoff = new Date(Date.now() - HOT_MIN * 60_000).toISOString();
          const fresh = await db.collection("crmLeads").where("stage", "==", "new_lead").get();
          const repsAll = await db.collection("crmReps").get();
          const repById = new Map<string, any>(repsAll.docs.map((d: any) => [d.id, d]));
          const activeCount = repsAll.docs.filter((d: any) => d.get("active") === true && d.get("archived") !== true && !d.get("poolAccount")).length;
          for (const d of fresh.docs) {
            const owner = d.get("owner"); const assignedAt = d.get("assignedAt");
            if (!owner || !assignedAt || assignedAt > cutoff) continue;           // unassigned, or not yet 30 min
            if (d.get("bouncedAt") && d.get("bouncedAt") > assignedAt) continue;  // already bounced since this assignment
            if (activeCount < 2) continue;                                        // nobody else to bounce to
            const rep = repById.get(owner);
            if (rep?.get("poolAccount")) continue;                                // shared/pool accounts (Leads VAC) aren't a rep sitting on a lead
            const repUid = rep?.get("uid"); const repEmail = String(rep?.get("email") || "").toLowerCase();
            const log: any[] = d.get("activityLog") || [];
            const touched = log.some((a) => a && a.at && a.at >= assignedAt && a.direction !== "inbound" && a.by !== "System" &&
              ((a.byRepId && a.byRepId === owner) || (repUid && a.byUid === repUid) || (repEmail && String(a.by || "").toLowerCase() === repEmail)));
            if (touched) continue;
            // Pick the next active rep that isn't the current owner.
            const candidates = repsAll.docs.filter((r: any) => r.get("active") === true && r.get("archived") !== true && r.id !== owner && !r.get("poolAccount"))
              .map((r: any) => ({ id: r.id, name: r.get("name") || null, last: r.get("lastAssignedAt") ? Date.parse(r.get("lastAssignedAt")) : 0 }))
              .sort((a: any, b: any) => a.last - b.last);
            const next = candidates[0]; if (!next) continue;
            const prevName = d.get("ownerName") || owner;
            await d.ref.update({
              owner: next.id, ownerName: next.name, assignedAt: nowIso, updatedAt: nowIso,
              bouncedAt: nowIso, bouncedFrom: owner, bouncedFromName: prevName, bounceCount: admin.firestore.FieldValue.increment(1),
              activityLog: admin.firestore.FieldValue.arrayUnion({ text: `⚡ Hot-lead bounce — sat ${HOT_MIN} min with ${prevName} and wasn't touched. Reassigned to ${next.name || next.id}.`, by: "System", at: nowIso, kind: "note", bounce: true, bouncedFrom: owner }),
            });
            await db.collection("crmReps").doc(next.id).update({ lastAssignedAt: nowIso });
            out.bounced.push({ id: d.id, name: [d.get("firstName"), d.get("lastName")].filter(Boolean).join(" "), from: prevName, to: next.name || next.id });
          }
        } catch (e: any) { console.error("[CRM-TICK] hot-lead bounce failed:", e?.message || e); }
      }

      // 2) Drip waiting Inbox leads to active reps (business hours only)
      if (out.businessHours) {
        // Filter on stage SERVER-SIDE. Querying owner==null alone returns the entire
        // Free-to-Call pool (~63k docs) every tick just to find the handful waiting in
        // the Inbox — the pool only ever grows, so that cost climbs forever. Leads in
        // the pool are stage "free_to_call" and must never be auto-assigned; only
        // "new_lead" is eligible. Docs with no stage field at all are no longer picked
        // up (they were, via the old `|| "new_lead"` default) — every write path sets a
        // stage explicitly, and silently handing a malformed record to a rep is worse
        // than leaving it in the Inbox to be noticed.
        const pool = await db.collection("crmLeads")
          .where("owner", "==", null)
          .where("stage", "==", "new_lead")
          .get();
        const waiting = pool.docs
          .sort((a: any, b: any) => String(a.get("addTime") || "").localeCompare(String(b.get("addTime") || "")));
        for (const d of waiting) {
          const rep = await assignToNextActiveRep(db, d.ref);
          if (!rep) break; // nobody active — leave the rest in the Inbox
          out.dripped.push({ id: d.id, to: rep.name || rep.id });
        }
      }

      // 2b) Nurture wake-ups: Lost leads whose wake-up date has arrived → Free-to-Call pool with a note.
      out.woken = [];
      try {
        const due = await db.collection("crmLeads").where("nurtureStatus", "==", "sleeping").get();
        for (const d of due.docs) {
          const at = d.get("nurtureAt"); if (!at || String(at) > nowIso) continue;
          const reason = d.get("lostReason") || "Lost"; const lostAt = d.get("lostAt") || d.get("updatedAt");
          const ago = lostAt ? Math.round((Date.now() - Date.parse(lostAt)) / 86_400_000) : null;
          const agoTxt = ago == null ? "" : ago >= 60 ? ` ${Math.round(ago / 30)} months ago` : ago === 0 ? " today" : ago === 1 ? " 1 day ago" : ` ${ago} days ago`;
          const wasWith = d.get("lostByName") || d.get("lostBy") || "";
          await d.ref.update({
            stage: "free_to_call", owner: null, ownerName: null, assignedAt: null, updatedAt: nowIso,
            nurtureStatus: "woken", wokenAt: nowIso, releasedAt: nowIso,
            releasedFrom: null, releasedFromName: wasWith ? `${wasWith} (lost: ${reason})` : null,   // no reclaim block for nurtures — anyone incl. the original rep may take it
            poolNote: `⏰ Nurture wake-up — was Lost (${reason})${agoTxt}${wasWith ? `, by ${wasWith}` : ""}.${d.get("lostNote") ? ` “${String(d.get("lostNote")).slice(0, 160)}”` : ""} Worth another try.`,
            stageHistory: admin.firestore.FieldValue.arrayUnion({ from: "lost", to: "free_to_call", by: "system:nurture", byUid: null, at: nowIso }),
            activityLog: admin.firestore.FieldValue.arrayUnion({ text: `⏰ Woke up from Nurture — was Lost (${reason})${agoTxt}. Back in the Free-to-Call pool.`, by: "System", at: nowIso, kind: "note" }),
          });
          out.woken.push({ id: d.id, name: [d.get("firstName"), d.get("lastName")].filter(Boolean).join(" "), reason });
        }
      } catch (e: any) { console.error("[CRM-TICK] nurture phase failed:", e?.message || e); }

      // 3) Inbound email replies → thread (background sweep; the drawer also refreshes on open).
      out.emailsImported = [];
      try {
        // orderBy on the nested field returns ONLY docs that have it, which is the whole
        // filter we need. Reading the full crmLeads collection here and filtering in
        // memory pulled every lead (owned, pooled, archived — the lot) every tick to
        // find the few with a live Gmail thread.
        const threaded = await db.collection("crmLeads").orderBy("emailThread.threadId").get();
        const gmailCache = new Map<string, any>();
        for (const d of threaded.docs) {
          try {
            const r = await importLeadEmails(db, admin, d, gmailCache);
            if (r.imported > 0) out.emailsImported.push({ id: d.id, count: r.imported });
          } catch (e: any) { console.error("[CRM-TICK] email import failed for", d.id, e?.message || e); }
        }
      } catch (e: any) { console.error("[CRM-TICK] email import phase failed:", e?.message || e); }

      res.json({ ok: true, at: nowIso, ...out });
    } catch (err: any) {
      console.error("[CRM-TICK] error:", err?.message || err);
      res.status(500).json({ error: "Tick failed." });
    }
  });

  app.post("/api/apply-now", async (req: express.Request, res: express.Response) => {
    const ip = clientIp(req);
    if (!rateLimit(`apply-now:${ip}`, 5, 60_000)) {
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    const body = req.body || {};
    const a = body.applicant || {};
    const addr = a.address || {};
    const v = body.vehicle || {}, e = body.employment || {}, h = body.housing || {}, el = body.eligibility || {}, mk = body.marketing || {};
    const email = (a.email || "").toString().trim().toLowerCase();
    const phone = (a.phone || "").toString().trim();
    const phoneDigits = normPhone(phone);

    if (!email && !phoneDigits) return res.status(400).json({ error: "Missing contact information." });
    if (email && !isValidEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });
    if (body?.consent?.agreed !== true) return res.status(400).json({ error: "Consent is required to submit." });

    const apiToken = process.env.PIPEDRIVE_API_TOKEN;
    if (!apiToken) return res.status(500).json({ error: "PIPEDRIVE_API_TOKEN is not configured." });

    const nowIso = new Date().toISOString();
    const name = [a.firstName, a.lastName].filter(Boolean).join(" ") || "Applicant";
    // DOB is captured DD/MM/YYYY on this form; Pipedrive date fields want YYYY-MM-DD.
    // (Do NOT use normalizeDate here — it assumes MM/DD and would flip the day/month.)
    const dobToISO = (s: any): string | undefined => {
      if (typeof s !== "string") return undefined;
      const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!m) return undefined;
      if (+m[2] < 1 || +m[2] > 12 || +m[1] < 1 || +m[1] > 31) return undefined;
      return `${m[3]}-${m[2]}-${m[1]}`;
    };
    const esc = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const timeStr = (t: any) => (t && (t.years || t.months) ? `${t.years || 0}y ${t.months || 0}m` : "");

    try {
      // 1) Person (dedupe by email/phone)
      let personId = await findPipedrivePerson(apiToken, email, phone);
      const personDobKey = process.env.PIPEDRIVE_PERSON_DOB_FIELD_KEY;
      const dobIso = dobToISO(a.dob);
      const personPayload: any = { name, email: email ? [email] : undefined, phone: phone ? [phone] : undefined };
      if (dobIso && personDobKey) personPayload[personDobKey] = dobIso;
      if (!personId) {
        const r = await fetchWithTimeout(`https://api.pipedrive.com/v1/persons?api_token=${apiToken}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(personPayload),
        });
        personId = (await r.json())?.data?.id;
      } else {
        await fetchWithTimeout(`https://api.pipedrive.com/v1/persons/${personId}?api_token=${apiToken}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(personPayload),
        });
      }

      // 2) LEAD (never a deal). Reuse an open lead if this person already has one.
      const existing = personId ? await findRecentOpenPipedriveLead(apiToken, personId) : null;
      let leadId = existing ? existing.id : null;
      if (!leadId) {
        const leadPayload: any = { title: name, person_id: personId };
        // Pipedrive custom-field keys (confirmed from GET /v1/dealFields — leads share
        // deal fields). Everything the funnel captures lands in its OWN filterable field;
        // the note (below) stays as the human-readable summary + catch-all.
        const set = (key: string, val: any) => {
          if (val !== undefined && val !== null && String(val).trim() !== "") leadPayload[key] = val;
        };
        // Contact
        set("daee3baeeba75f1262c5a59c2d5fae9e0ab9824b", a.firstName);         // First Name
        set("45db65ef76c70f04bd5c6a161e4d48b3e3fb52b8", a.lastName);          // Last Name
        set("9902ecfb207e316c980c1264d302e7e48a86bf4a", phone);              // Phone Number
        set("9649ec95be44509028395a4b4cedd772d133534c", email);             // Email
        set("1607078230a6742a6afc8f68968b09f7de12d1bb", dobIso || a.dob);    // DOB
        // Address
        set("7654290790c763a2afe25568df76093670091d83", addr.street);        // Street Address
        set("9cf433c83609faf834036edec7e675fd5676e694", addr.suite);         // Apartment/Suite
        set("8ace800abf264d012c73a8eef1d6d5cf9f0c160c", addr.city);          // City
        set("bedcc069f503187bd05b3a221cf5f1509d37f36b", addr.province);      // Province
        set("eaad668062db5c899096f99eba83a34e672a8503", addr.postal);        // Postal Code
        // Vehicle
        set("6150c2ed44b168d6dba7472be2aa2366e7d6fc42", v.type);             // Looking For
        set("34dbe5967fd0d9b18db6b026468a27618f0ff888", v.budgetBand);       // Budget
        set("125897eb1ad0cf18f0f1bdb03064058e9528fca0", v.downPayment);      // Down Payment
        set("f8683d67228e1316880a7a15e719b80f68d58f49", v.tradeIn);          // Has Trade-In (Yes/No/Unsure)
        // Employment & income
        set("f33681a3d38a9526fecd9704aae5d20abc7ab76f", e.status);           // Employment Status
        set("a1bf2e94dd027089a4091f45b71fb1f18d79e5d6", e.employer);         // Employer
        set("5ad151377579cf87e71e4565d3bc7dfc2e62b153", e.jobTitle);         // Job Title
        set("b327c0938c9ab66eaee6806a22ff5716252d2cc7", e.hoursPerWeek);     // How many hours a week
        set("d9e541eadb637ab076a189134019c1c96c26e8f9", timeStr(e.timeOnJob)); // Time on Job
        // Gross income routes to the matching field by type (hourly vs monthly)
        if (/hour/i.test(String(e.incomeType || ""))) {
          set("6df9a9fd090d038e8eb836fce00c2a89f3187289", e.grossIncome);    // Hourly Wage
        } else {
          set("7850c2c90305c2d65ce8c81dc07f92bcfecddae0", e.grossIncome);    // Monthly Income
        }
        // Housing
        set("366f5d279222b4c36bd1b3a4cccd4d2d67b77833", h.ownOrRent);         // Rent or Own
        set("5530e4ac6b144e965c80fc49a18237591ee0b2a3", h.monthlyPayment);   // Monthly Payment
        set("1d73b415c786bb6e1feefd137f3362d7df057fda", timeStr(h.timeAtAddress)); // How long lived there
        // Eligibility — Valid Drivers License is an enum (Yes=201, No=202)
        const lic = String(el.validLicense || "").toLowerCase();
        if (lic === "yes") set("f72c950606278711225de1c6d279e3bae6e14331", 201);
        else if (lic === "no") set("f72c950606278711225de1c6d279e3bae6e14331", 202);
        // Credit + Citizen/PR (dedicated fields created 2026-08-17)
        set("f805e9aac832acb583d7e9f293711e48222bc402", (body.credit || {}).selfRating); // Credit Self-Rating
        set("6ae2b9103295bf3b6b8fc1218762fc231edb8499", el.citizenOrPR);                  // Citizen or PR
        // Lead Source (derived from UTMs)
        set("a7c81ae79890d65ac301296c947f335e91730146", getLeadSource(mk.utm_source, mk.utm_medium));
        const r = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads?api_token=${apiToken}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(leadPayload),
        });
        leadId = (await r.json())?.data?.id;
      }

      // 3) Full application as a note — guarantees nothing is lost even if a custom field is unset.
      const line = (label: string, val: any) => (val === undefined || val === null || val === "" ? "" : `${label}: ${esc(val)}<br>`);
      const note =
        `<b>NEW PRE-APPROVAL APPLICATION</b> (${esc(nowIso)})<br><br>` +
        `<b>Contact</b><br>` +
        line("Name", name) + line("Phone", phone) + line("Email", email) + line("Date of birth", a.dob) +
        line("Address", [addr.street, addr.suite, addr.city, addr.province, addr.postal].filter(Boolean).join(", ")) +
        `<br><b>Vehicle</b><br>` +
        line("Vehicle of interest", v.specificVehicle) + line("Stock #", v.specificVehicleId) +
        line("Looking for", v.type) + line("Budget", v.budgetBand) + line("Trade-in", v.tradeIn) + line("Down payment", v.downPayment) +
        `<br><b>Credit</b><br>` + line("Self-rating", (body.credit || {}).selfRating) +
        `<br><b>Employment &amp; income</b><br>` +
        line("Status", e.status) + line("Employer", e.employer) + line("Job title", e.jobTitle) +
        line("Income type", e.incomeType) + line("Gross income", e.grossIncome) + line("Hours/week", e.hoursPerWeek) +
        line("Time on job", timeStr(e.timeOnJob)) + line("Income source", e.incomeSource) +
        `<br><b>Housing</b><br>` +
        line("Own/Rent", h.ownOrRent) + line("Monthly payment", h.monthlyPayment) + line("Time at address", timeStr(h.timeAtAddress)) +
        `<br><b>Eligibility</b><br>` +
        line("Citizen/PR", el.citizenOrPR) + line("Valid licence", el.validLicense) +
        `<br><b>Marketing</b><br>` +
        line("Source", mk.utm_source) + line("Medium", mk.utm_medium) + line("Campaign", mk.utm_campaign) +
        line("Content", mk.utm_content) + line("Term", mk.utm_term) + line("gclid", mk.gclid) + line("fbclid", mk.fbclid);
      if (leadId) {
        await fetchWithTimeout(`https://api.pipedrive.com/v1/notes?api_token=${apiToken}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: note, lead_id: leadId }),
        });
      }

      // 4) Best-effort Firestore copy (own record; NO `stage`, so it never shows as a board deal).
      try {
        const { db } = await getFirestoreAdmin();
        await db.collection("leads").add({
          source: "apply-now", type: "financing", status: "new",
          firstName: a.firstName || null, lastName: a.lastName || null,
          email: email || null, phone: phone || null, dob: a.dob || null, dateOfBirth: a.dob || null,
          fullAddress: [addr.street, addr.suite, addr.city, addr.province, addr.postal].filter(Boolean).join(", ") || null,
          city: addr.city || null, province: addr.province || null, postalCode: addr.postal || null,
          vehicleType: v.type || null, annualIncome: e.grossIncome || null, monthlyHousing: h.monthlyPayment || null,
          creditSelfRating: (body.credit || {}).selfRating || null,
          application: body, marketing: mk,
          pipedriveLeadId: leadId || null, pipedrivePersonId: personId || null,
          createdAt: new Date(), submittedAt: nowIso,
        });
      } catch (fireErr: any) {
        console.error("[APPLY-NOW] Firestore persist failed (non-fatal):", fireErr?.message || fireErr);
      }

      // 4b) Dual-write into the in-house CRM (`crmLeads`) so the lead lands in the
      // admin Inbox (owner=null → unassigned) ready to disperse. Keyed by the
      // Pipedrive lead id to stay idempotent with the importer, and never resets
      // the stage/owner of a lead that's already been picked up and worked.
      try {
        const { admin, db } = await getFirestoreAdmin();
        const incomeHourly = /hour/i.test(String(e.incomeType || ""));
        const crmRecord: any = {
          pipedriveLeadId: leadId ? String(leadId) : null,
          pipedrivePersonId: personId || null,
          title: name,
          firstName: a.firstName || null, lastName: a.lastName || null,
          dob: a.dob || null, phone: phone || null, phoneKey: phoneKeyOf(phone) || null, email: email || null,
          street: addr.street || null, suite: addr.suite || null, city: addr.city || null,
          province: addr.province || null, postal: addr.postal || null,
          lookingFor: v.type || null, budget: v.budgetBand || null, downPayment: v.downPayment || null,
          hasTradeIn: v.tradeIn || null, specificVehicle: v.specificVehicle || null, specificVehicleId: v.specificVehicleId || null,
          employmentStatus: e.status || null, employer: e.employer || null, jobTitle: e.jobTitle || null,
          hoursPerWeek: e.hoursPerWeek || null, timeOnJob: timeStr(e.timeOnJob) || null,
          hourlyWage: incomeHourly ? (e.grossIncome || null) : null,
          monthlyIncome: incomeHourly ? null : (e.grossIncome || null),
          rentOrOwn: h.ownOrRent || null, monthlyPayment: h.monthlyPayment || null, timeAtAddress: timeStr(h.timeAtAddress) || null,
          creditSelfRating: (body.credit || {}).selfRating || null, validLicense: el.validLicense || null, citizenOrPR: el.citizenOrPR || null,
          leadSource: getLeadSource(mk.utm_source, mk.utm_medium) || null,
          notes: admin.firestore.FieldValue.arrayUnion({ content: note, addTime: nowIso, byName: "Website" }),
          addTime: nowIso,
          source: "apply-now",
          updatedAt: nowIso,
        };
        // Key by phone (pd_<last10>) so a returning applicant merges into their one
        // record — same key the Pipedrive archive import uses. Lead-id keying only
        // when there's no usable phone.
        const crmPk = phoneKeyOf(phone) || "";
        const docRef = crmPk.length === 10
          ? db.collection("crmLeads").doc(`pd_${crmPk}`)
          : (leadId ? db.collection("crmLeads").doc(String(leadId)) : db.collection("crmLeads").doc());
        const existingCrm = await docRef.get();
        const prevStage = existingCrm.exists ? String(existingCrm.get("stage") || "") : "";
        crmRecord.applications = admin.firestore.FieldValue.arrayUnion(nowIso);
        crmRecord.lastAppliedAt = nowIso;
        crmRecord.appliedMonth = nowIso.slice(0, 7);
        if (!existingCrm.exists || !existingCrm.get("firstAppliedAt")) crmRecord.firstAppliedAt = nowIso;
        if (!existingCrm.exists) { crmRecord.stage = "new_lead"; crmRecord.owner = null; }
        else if (prevStage === "free_to_call" || prevStage === "lost") {
          // Re-application revives an archived/lost record: back to the Inbox, opted back in.
          crmRecord.stage = "new_lead"; crmRecord.owner = null; crmRecord.dnc = false;
          crmRecord.releasedAt = null; crmRecord.releasedFrom = null; crmRecord.releasedFromName = null;
        }
        else if (!existingCrm.get("owner")) { crmRecord.owner = null; } // still unassigned → keep it that way
        // (if it already has an owner and is being worked, we leave stage/owner untouched)
        await docRef.set(crmRecord, { merge: true });
        // Phase A: auto-assign to the next active rep the instant it lands. If nobody
        // is active, it stays unassigned and waits in the Inbox.
        const wasUnassigned = !existingCrm.exists || !existingCrm.get("owner");
        if (wasUnassigned && isBusinessHours()) {
          try { await assignToNextActiveRep(db, docRef); }
          catch (asnErr: any) { console.error("[APPLY-NOW] auto-assign failed (non-fatal):", asnErr?.message || asnErr); }
        }
      } catch (crmErr: any) {
        console.error("[APPLY-NOW] CRM dual-write failed (non-fatal):", crmErr?.message || crmErr);
      }

      res.json({ success: true, leadId: leadId || null });
    } catch (err: any) {
      console.error("[APPLY-NOW] error:", err?.message || err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  });

  app.post("/api/dv-lead", async (req, res) => {
    const ip = clientIp(req);
    if (!rateLimit(`dv-lead:${ip}`, 5, 60_000)) {
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }

    const body = req.body || {};
    const email = (body?.applicant?.email || "").toString().trim().toLowerCase();
    const phoneDigits = normPhone(body?.applicant?.phone);

    // A sellable lead needs a valid way to reach the applicant + explicit consent.
    if (!email && !phoneDigits) {
      return res.status(400).json({ error: "Missing contact information." });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }
    if (phoneDigits && phoneDigits.length < 10) {
      return res.status(400).json({ error: "Please enter a valid phone number." });
    }
    if (body?.consent?.shareWithDealers !== true || body?.consent?.agreed !== true) {
      return res.status(400).json({ error: "Consent is required to submit." });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // Proof-of-consent, stamped server-side so the client can't forge it. We keep
    // the exact wording (body.consent.text) the applicant actually saw, plus IP,
    // timestamp, version, and the captured UTMs (in `marketing`).
    const consent = {
      ...(body.consent || {}),
      shareWithDealers: true,
      creditPull: body?.consent?.creditPull === true,
      agreed: true,
      textVersion: body?.consent?.textVersion || DV_CONSENT_VERSION,
      text: body?.consent?.text || null,
      timestamp: nowIso,
      ip,
    };

    const record: any = {
      source: "apply.vehicleapprovalcentre.com",
      submittedAt: nowIso,
      submittedAtMs: now.getTime(),
      emailLower: email || null,
      phoneDigits: phoneDigits || null,
      applicant: body.applicant || null,
      vehicle: body.vehicle || null,
      credit: body.credit || null,
      employment: body.employment || null,
      housing: body.housing || null,
      eligibility: body.eligibility || null,
      consent,
      marketing: body.marketing || {}, // utm_*, gclid, fbclid, landing_page, ...
      meta: { ip, userAgent: req.get("user-agent") || null },
      status: "new",
    };

    // --- Assign dealer (round-robin) + order gate + persist + dedupe (best-effort) ---
    let db: any = null;
    let dealer: Dealer | null = null;
    let leadRef: any = null;
    let isDuplicate = false;
    let held = false;          // true → save the lead but DON'T email the dealer yet
    let activeOrder: any = null;
    try {
      ({ db } = await getFirestoreAdmin());

      // Exclusive assignment: pick the one dealer who will buy this lead.
      dealer = await assignDealer(db);
      record.assignment = dealer
        ? { dealerId: dealer.id, dealerName: dealer.name, dealerEmail: dealer.email, assignedAt: nowIso, delivery: "pending" }
        : { dealerId: null, delivery: "unassigned" };

      // Order gate. A dealer sells in batches ("orders") of a set size. We only
      // email while the active order has room. No active order but past orders
      // exist = paused between orders → hold. No orders at all = legacy send-all.
      if (dealer) {
        try {
          const ordersSnap = await db.collection("dvOrders").where("dealerId", "==", dealer.id).get();
          if (!ordersSnap.empty) {
            const activeDoc = ordersSnap.docs.find((d: any) => d.data().status === "active");
            if (!activeDoc) {
              held = true; // between orders — paused until a new one is started
            } else {
              activeOrder = { id: activeDoc.id, ...activeDoc.data() };
              // Fulfilled = delivered, non-returned leads already in this order.
              const inOrder = await db.collection("dvLeads").where("assignment.orderId", "==", activeOrder.id).get();
              let fulfilled = 0;
              inOrder.forEach((d: any) => {
                const x = d.data();
                if (x.assignment?.delivery === "emailed" && !["returned", "bad"].includes(x.outcome || "new")) fulfilled++;
              });
              if (fulfilled >= (activeOrder.size || 150)) held = true;
            }
          }
        } catch (e: any) {
          console.error("[DV-LEAD] Order gate check failed (defaulting to send):", e?.message || e);
        }
      }

      // Reflect the order gate on the record before persisting.
      if (dealer) {
        if (held) {
          record.assignment.delivery = "held";
        } else if (activeOrder) {
          record.assignment.orderId = activeOrder.id;
          record.assignment.orderNumber = activeOrder.number;
        }
      }

      const windowStartMs = now.getTime() - DV_DEDUPE_WINDOW_MINUTES * 60_000;
      // Equality-only queries need no composite index. Check email + phone.
      const seen: number[] = [];
      const collect = async (field: string, value: string | null) => {
        if (!value) return;
        const snap = await db.collection("dvLeads").where(field, "==", value).get();
        snap.forEach((d: any) => {
          const ms = d.get("submittedAtMs");
          if (typeof ms === "number") seen.push(ms);
        });
      };
      await collect("emailLower", email || null);
      await collect("phoneDigits", phoneDigits || null);
      isDuplicate = seen.some((ms) => ms >= windowStartMs);
      record.status = isDuplicate ? "duplicate" : "new";
      leadRef = await db.collection("dvLeads").add(record);
    } catch (err: any) {
      console.error("[DV-LEAD] Firestore persist/dedupe failed (continuing):", err?.message || err);
    }

    // Resilience: if Firestore was unavailable we couldn't round-robin — still
    // assign the first active dealer so the lead is emailed and never lost.
    if (!dealer) {
      dealer = DEALERS.find((d) => d.active) || null;
      if (dealer) {
        record.assignment = { dealerId: dealer.id, dealerName: dealer.name, dealerEmail: dealer.email, assignedAt: nowIso, delivery: "pending" };
      }
    }

    // A duplicate within the window is stored for the record but NOT re-sold to
    // buyers — the applicant still sees success so they aren't bounced.
    if (isDuplicate) {
      console.log("[DV-LEAD] Duplicate within window — stored, not re-forwarded:", email || phoneDigits);
      return res.json({ success: true, duplicate: true });
    }

    // --- Deliver the lead to its assigned dealer (EXCLUSIVE) by email ---
    // The lead is already saved, so any delivery failure is logged for recovery
    // and never bounces the applicant (they still see the success screen).
    let delivered = false;
    if (dealer && !held) {
      try {
        const resend = getResendClient();
        const applicantName = [record.applicant?.firstName, record.applicant?.lastName].filter(Boolean).join(" ") || "New applicant";
        const { error: mailErr } = await resend.emails.send({
          from: LEAD_FROM_EMAIL,
          to: dealer.email,
          subject: `New lead — ${applicantName} · ${record.vehicle?.type || "vehicle"} · ${record.applicant?.address?.city || record.applicant?.address?.province || "Canada"}`,
          html: renderLeadEmail(record),
        });
        if (mailErr) console.error("[DV-LEAD] Resend error emailing dealer:", mailErr);
        else { delivered = true; console.log("[DV-LEAD] Lead emailed to dealer", dealer.email); }
      } catch (err: any) {
        console.error("[DV-LEAD] Failed to email lead to dealer (lead is saved):", err?.message || err);
      }
    } else if (dealer && held) {
      console.log("[DV-LEAD] Order full/paused — lead HELD (saved, not emailed) for dealer", dealer.email);
    } else {
      console.error("[DV-LEAD] No active dealer configured — lead saved but NOT delivered:", email || phoneDigits);
    }

    // Record the delivery outcome (skip when held — it stays 'held' until an
    // order is started and releases it).
    if (leadRef && !held) {
      try {
        await leadRef.update({
          "assignment.delivery": delivered ? "emailed" : "failed",
          "assignment.deliveredAt": delivered ? new Date().toISOString() : null,
        });
      } catch (err: any) {
        console.error("[DV-LEAD] Could not update delivery status:", err?.message || err);
      }
    }

    // Optional: also fan out to any configured buyer webhooks (e.g. a future n8n
    // distribution engine). Off unless BUYER_WEBHOOK_URL(S)/N8N_LEAD_WEBHOOK_URL set.
    await Promise.all(buyerWebhooks().map(async (url) => {
      try {
        const response = await fetchWithTimeout(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(record),
        }, 15000);
        if (!response.ok) console.error("[DV-LEAD] Buyer webhook returned", response.status, "for", url);
      } catch (err: any) {
        console.error("[DV-LEAD] Failed to forward lead to", url, ":", err?.message || err);
      }
    }));

    return res.json({ success: true });
  });

  // --- Admin auth helper: verify the caller's Firebase ID token is an admin ---
  const requireAdmin = async (
    req: express.Request,
  ): Promise<{ db: any; admin: any; email: string } | { error: number; message: string }> => {
    const authz = req.get("authorization") || "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
    if (!token) return { error: 401, message: "Not signed in." };
    const { admin, db } = await getFirestoreAdmin();
    let decoded: any;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return { error: 401, message: "Session expired — please sign in again." };
    }
    // Mirror the Firestore isAdmin() rule: the owner email, or an admin role.
    const email = (decoded.email || "").toLowerCase();
    if (!email.endsWith("@drivevac.ca")) return { error: 403, message: "Only @drivevac.ca accounts can access the VAC admin." };
    let ok = email === "j.jackson@drivevac.ca";
    if (!ok && decoded.uid) {
      const u = await db.collection("users").doc(decoded.uid).get();
      const role = u.exists ? u.get("role") : null;
      ok = ["super_admin", "general_manager", "finance_manager"].includes(role);
    }
    if (!ok) return { error: 403, message: "Admin access required." };
    return { db, admin, email };
  };

  // Outcomes an admin can set on a delivered lead. "returned" and "bad" don't
  // count toward a dealer's fulfilled/cap tally (they're credited back).
  const DV_OUTCOMES = ["new", "accepted", "sold", "returned", "bad"];

  // --- Admin: full lead list for the dashboard (auth-gated, admins only) ---
  // Returns the FULL record per lead (so the detail view can show the whole
  // application) plus the dealer roster with caps for the fulfilled tally.
  app.get("/api/dv-leads", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const snap = await ctx.db.collection("dvLeads").orderBy("submittedAtMs", "desc").limit(2000).get();
      const leads = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      let dealerOverrides: Record<string, boolean> = {};
      try { const s = await ctx.db.collection("dvRouting").doc("dealerStatus").get(); if (s.exists) dealerOverrides = s.data() || {}; } catch {}
      const dealers = DEALERS.map((dl) => ({ id: dl.id, name: dl.name, cap: dl.monthlyCap || null, active: typeof dealerOverrides[dl.id] === "boolean" ? dealerOverrides[dl.id] : dl.active }));
      const ordersSnap = await ctx.db.collection("dvOrders").get();
      const orders = ordersSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      res.json({ leads, dealers, outcomes: DV_OUTCOMES, orders });
    } catch (err: any) {
      console.error("[DV-LEADS] list error:", err?.message || err);
      res.status(500).json({ error: "Failed to load leads." });
    }
  });

  // --- Admin: set a lead's outcome (new/accepted/sold/returned/bad) ---
  app.post("/api/dv-lead-outcome", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { id, outcome } = req.body || {};
      if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing lead id." });
      if (!DV_OUTCOMES.includes(outcome)) return res.status(400).json({ error: "Invalid outcome." });
      await ctx.db.collection("dvLeads").doc(id).update({
        outcome,
        outcomeAt: new Date().toISOString(),
        outcomeBy: ctx.email,
      });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[DV-LEAD-OUTCOME] error:", err?.message || err);
      res.status(500).json({ error: "Failed to update outcome." });
    }
  });

  // --- Admin: toggle a funnel dealer on/off in the lead rotation ---
  app.post("/api/dv-dealer-toggle", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { dealerId, active } = req.body || {};
      if (!DEALERS.some((d) => d.id === dealerId)) return res.status(400).json({ error: "Unknown dealer." });
      if (typeof active !== "boolean") return res.status(400).json({ error: "'active' must be true/false." });
      await ctx.db.collection("dvRouting").doc("dealerStatus").set({ [dealerId]: active }, { merge: true });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[DV-DEALER-TOGGLE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to update dealer." });
    }
  });

  // --- Admin: reassign a lead to a different dealer (re-emails the new dealer) ---
  app.post("/api/dv-lead-reassign", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { id, dealerId } = req.body || {};
      if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing lead id." });
      const dealer = DEALERS.find((d) => d.id === dealerId);
      if (!dealer) return res.status(400).json({ error: "Unknown dealer." });
      const ref = ctx.db.collection("dvLeads").doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Lead not found." });
      const lead: any = snap.data() || {};
      const prev = lead.assignment || {};
      if (prev.dealerId === dealer.id) return res.status(400).json({ error: "Lead is already with that dealer." });
      const nowIso = new Date().toISOString();
      // Tie the lead to the NEW dealer's active order so it counts toward THEIR tally
      // (and drops off the old dealer's). No active order for them → no order tie.
      let newOrderId: string | null = null, newOrderNumber: number | null = null;
      try {
        const os = await ctx.db.collection("dvOrders").where("dealerId", "==", dealer.id).get();
        const activeDoc = os.docs.find((d: any) => d.data().status === "active");
        if (activeDoc) { newOrderId = activeDoc.id; newOrderNumber = activeDoc.data().number ?? null; }
      } catch {}
      await ref.update({
        assignment: {
          ...prev,
          dealerId: dealer.id, dealerName: dealer.name, dealerEmail: dealer.email,
          orderId: newOrderId, orderNumber: newOrderNumber,
          reassignedAt: nowIso, reassignedBy: ctx.email, reassignedFrom: prev.dealerId || null,
          delivery: "emailed",
        },
      });
      // Re-send the lead sheet to the new dealer so they actually receive it.
      let emailed = false;
      try {
        const resend = getResendClient();
        const applicantName = [lead.applicant?.firstName, lead.applicant?.lastName].filter(Boolean).join(" ") || "New applicant";
        const { error: mailErr } = await resend.emails.send({
          from: LEAD_FROM_EMAIL,
          to: dealer.email,
          subject: `Reassigned lead — ${applicantName} · ${lead.vehicle?.type || "vehicle"} · ${lead.applicant?.address?.city || lead.applicant?.address?.province || "Canada"}`,
          html: renderLeadEmail(lead),
        });
        if (mailErr) console.error("[DV-REASSIGN] Resend error:", mailErr);
        else emailed = true;
      } catch (e: any) {
        console.error("[DV-REASSIGN] email failed:", e?.message || e);
      }
      res.json({ success: true, emailed, dealerName: dealer.name });
    } catch (err: any) {
      console.error("[DV-LEAD-REASSIGN] error:", err?.message || err);
      res.status(500).json({ error: "Failed to reassign lead." });
    }
  });

  // --- Admin: start a new order for a dealer ---
  // Closes the dealer's active order, opens a new one (given size), and releases
  // any HELD leads (oldest first) into it — emailing them — up to the new size.
  app.post("/api/dv-orders/start", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { dealerId, size } = req.body || {};
      const dealer = DEALERS.find((d) => d.id === dealerId);
      if (!dealer) return res.status(400).json({ error: "Unknown dealer." });
      const orderSize = Math.max(1, Math.min(100000, Math.floor(Number(size) || dealer.monthlyCap || 150)));

      const allSnap = await ctx.db.collection("dvOrders").where("dealerId", "==", dealerId).get();
      for (const d of allSnap.docs) {
        if (d.data().status === "active") {
          await d.ref.update({ status: "closed", closedAt: new Date().toISOString(), closedBy: ctx.email });
        }
      }
      const number = allSnap.size + 1;
      const orderRef = await ctx.db.collection("dvOrders").add({
        dealerId, dealerName: dealer.name, number, size: orderSize, status: "active",
        createdAt: new Date().toISOString(), createdBy: ctx.email,
      });

      // Release held leads (oldest first) into the new order until it's full.
      let released = 0;
      let releaseFailed = 0;
      const heldSnap = await ctx.db.collection("dvLeads").where("assignment.dealerId", "==", dealerId).get();
      const heldDocs = heldSnap.docs
        .filter((d: any) => d.data().assignment?.delivery === "held")
        .sort((a: any, b: any) => (a.data().submittedAtMs || 0) - (b.data().submittedAtMs || 0));
      for (const hd of heldDocs) {
        if (released >= orderSize) break;
        const r = hd.data();
        try {
          const resend = getResendClient();
          const applicantName = [r.applicant?.firstName, r.applicant?.lastName].filter(Boolean).join(" ") || "New applicant";
          const { error: mailErr } = await resend.emails.send({
            from: LEAD_FROM_EMAIL,
            to: dealer.email,
            subject: `New lead — ${applicantName} · ${r.vehicle?.type || "vehicle"} · ${r.applicant?.address?.city || r.applicant?.address?.province || "Canada"}`,
            html: renderLeadEmail(r),
          });
          if (mailErr) {
            releaseFailed++;
            await hd.ref.update({ "assignment.delivery": "failed", "assignment.orderId": orderRef.id, "assignment.orderNumber": number });
          } else {
            released++;
            await hd.ref.update({ "assignment.delivery": "emailed", "assignment.deliveredAt": new Date().toISOString(), "assignment.orderId": orderRef.id, "assignment.orderNumber": number });
          }
        } catch (e: any) {
          releaseFailed++;
          console.error("[DV-ORDERS] release email failed:", e?.message || e);
        }
      }

      res.json({ success: true, orderNumber: number, size: orderSize, released, releaseFailed });
    } catch (err: any) {
      console.error("[DV-ORDERS] start error:", err?.message || err);
      res.status(500).json({ error: "Failed to start order." });
    }
  });

  // --- Customer portal: a signed-in customer's OWN applications (matched by email) ---
  // Any signed-in customer (email-link auth) — not admin-gated. Returns only their
  // own dealership applications with customer-safe fields (no internal notes/assignee).
  app.get("/api/my-applications", async (req, res) => {
    try {
      const authz = req.get("authorization") || "";
      const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
      if (!token) return res.status(401).json({ error: "Not signed in." });
      const { admin, db } = await getFirestoreAdmin();
      let decoded: any;
      try {
        decoded = await admin.auth().verifyIdToken(token);
      } catch {
        return res.status(401).json({ error: "Session expired — please sign in again." });
      }
      const email = (decoded.email || "").trim();
      if (!email) return res.status(400).json({ error: "No email on your account." });

      const emails = Array.from(new Set([email, email.toLowerCase()]));
      const seen = new Set<string>();
      const applications: any[] = [];
      for (const e of emails) {
        const snap = await db.collection("leads").where("email", "==", e).get();
        snap.forEach((d: any) => {
          if (seen.has(d.id)) return;
          seen.add(d.id);
          const x = d.data() || {};
          applications.push({
            id: d.id,
            createdAt: x.createdAt?.toDate ? x.createdAt.toDate().toISOString() : (x.createdAt || null),
            status: x.status || "new",
            type: x.type || "financing",
            vehicleType: x.vehicleType || null,
            price: x.price || null,
            downPayment: x.downPayment || null,
          });
        });
      }
      applications.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      res.json({ email, name: decoded.name || null, applications });
    } catch (err: any) {
      console.error("[MY-APPS] error:", err?.message || err);
      res.status(500).json({ error: "Failed to load your applications." });
    }
  });

  // ===================== In-house CRM: Deals board =====================
  // Mirrors the dealership Pipedrive "Working" pipeline. Reads the `leads`
  // collection (dealership financing apps) as deals; staff move them between
  // stages and add notes. Served via firebase-admin so no client rule changes.
  const DEAL_STAGES = [
    { key: "contact_made", label: "Contact Made" },
    { key: "dealertrack", label: "Submitted in Dealertrack" },
    { key: "approved", label: "Approved" },
    { key: "agreed", label: "Agreed to Buy" },
    { key: "delivery", label: "Delivery Status" },
    { key: "complete", label: "Complete" },
  ];

  // Staff = any admin role OR a sales rep (reps live in the Deals board).
  const requireStaff = async (
    req: express.Request,
  ): Promise<{ db: any; admin: any; email: string; uid: string; name: string; role: string | null } | { error: number; message: string }> => {
    const authz = req.get("authorization") || "";
    const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
    if (!token) return { error: 401, message: "Not signed in." };
    const { admin, db } = await getFirestoreAdmin();
    let decoded: any;
    try {
      decoded = await admin.auth().verifyIdToken(token);
    } catch {
      return { error: 401, message: "Session expired — please sign in again." };
    }
    const email = (decoded.email || "").toLowerCase();
    if (!email.endsWith("@drivevac.ca")) return { error: 403, message: "Only @drivevac.ca accounts can access the VAC admin." };
    let role: string | null = null;
    let name: string = decoded.name || email;
    if (decoded.uid) {
      const u = await db.collection("users").doc(decoded.uid).get();
      if (u.exists) { role = u.get("role"); name = u.get("displayName") || name; }
    }
    const ok = email === "j.jackson@drivevac.ca" ||
      ["super_admin", "general_manager", "finance_manager", "sales_rep"].includes(role || "");
    if (!ok) return { error: 403, message: "Staff access required." };
    return { db, admin, email, uid: decoded.uid, name, role };
  };

  app.get("/api/deals", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const usersSnap = await ctx.db.collection("users").get();
      const repName: Record<string, string> = {};
      usersSnap.forEach((u: any) => { repName[u.id] = u.get("displayName") || u.get("email") || "—"; });
      // Only deals explicitly placed on the board carry a valid `stage`. We do NOT
      // dump every lead onto the board — a lead joins the board when it gets a stage.
      const stageKeys = DEAL_STAGES.map((s) => s.key);
      const snap = await ctx.db.collection("leads").where("stage", "in", stageKeys).limit(1000).get();
      const deals = snap.docs.map((d: any) => {
        const x = d.data() || {};
        return {
          id: d.id,
          name: [x.firstName, x.lastName].filter(Boolean).join(" ") || x.name || "—",
          email: x.email || "",
          phone: x.phone || "",
          vehicle: x.vehicleType || x.vehicleName || "",
          price: x.price || null,
          downPayment: x.downPayment || null,
          annualIncome: x.annualIncome || null,
          monthlyHousing: x.monthlyHousing || null,
          address: x.fullAddress || null,
          dob: x.dateOfBirth || x.dob || null,
          type: x.type || "financing",
          stage: DEAL_STAGES.some((s) => s.key === x.stage) ? x.stage : "contact_made",
          assignedTo: x.assignedTo || null,
          repName: x.assignedTo ? (repName[x.assignedTo] || "Unassigned") : "Unassigned",
          createdAt: x.createdAt?.toDate ? x.createdAt.toDate().toISOString() : (x.createdAt || null),
          notes: Array.isArray(x.dealNotes) ? x.dealNotes : [],
          intakeNote: typeof x.notes === "string" && x.notes.trim() ? x.notes.trim() : null,
        };
      });
      deals.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      res.json({ deals, stages: DEAL_STAGES });
    } catch (err: any) {
      console.error("[DEALS] list error:", err?.message || err);
      res.status(500).json({ error: "Failed to load deals." });
    }
  });

  app.post("/api/deal-update", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { id, stage, note } = req.body || {};
      if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing deal id." });

      const update: any = { updatedAt: new Date() };
      if (stage) {
        if (!DEAL_STAGES.some((s) => s.key === stage)) return res.status(400).json({ error: "Invalid stage." });
        update.stage = stage;
      }
      let addedNote: any = null;
      if (note && String(note).trim()) {
        addedNote = { text: String(note).trim().slice(0, 4000), by: ctx.uid, byName: ctx.name, at: new Date().toISOString() };
        update.dealNotes = ctx.admin.firestore.FieldValue.arrayUnion(addedNote);
      }
      if (!stage && !addedNote) return res.status(400).json({ error: "Nothing to update." });

      await ctx.db.collection("leads").doc(id).update(update);
      res.json({ success: true, note: addedNote });
    } catch (err: any) {
      console.error("[DEAL-UPDATE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to update the deal." });
    }
  });
  // ===================================================================
  // IN-HOUSE CRM (Phase 1) — mirror Pipedrive leads into our own `crmLeads`
  // collection with a clean schema, so we can eventually migrate off Pipedrive.
  // Pipedrive custom-field hash -> clean field name.
  const CRM_FIELDS: Record<string, string> = {
    "daee3baeeba75f1262c5a59c2d5fae9e0ab9824b": "firstName",
    "45db65ef76c70f04bd5c6a161e4d48b3e3fb52b8": "lastName",
    "1607078230a6742a6afc8f68968b09f7de12d1bb": "dob",
    "9902ecfb207e316c980c1264d302e7e48a86bf4a": "phone",
    "9649ec95be44509028395a4b4cedd772d133534c": "email",
    "7654290790c763a2afe25568df76093670091d83": "street",
    "9cf433c83609faf834036edec7e675fd5676e694": "suite",
    "8ace800abf264d012c73a8eef1d6d5cf9f0c160c": "city",
    "bedcc069f503187bd05b3a221cf5f1509d37f36b": "province",
    "eaad668062db5c899096f99eba83a34e672a8503": "postal",
    "6150c2ed44b168d6dba7472be2aa2366e7d6fc42": "lookingFor",
    "34dbe5967fd0d9b18db6b026468a27618f0ff888": "budget",
    "125897eb1ad0cf18f0f1bdb03064058e9528fca0": "downPayment",
    "f8683d67228e1316880a7a15e719b80f68d58f49": "hasTradeIn",
    "f33681a3d38a9526fecd9704aae5d20abc7ab76f": "employmentStatus",
    "a1bf2e94dd027089a4091f45b71fb1f18d79e5d6": "employer",
    "5ad151377579cf87e71e4565d3bc7dfc2e62b153": "jobTitle",
    "6df9a9fd090d038e8eb836fce00c2a89f3187289": "hourlyWage",
    "b327c0938c9ab66eaee6806a22ff5716252d2cc7": "hoursPerWeek",
    "7850c2c90305c2d65ce8c81dc07f92bcfecddae0": "monthlyIncome",
    "d9e541eadb637ab076a189134019c1c96c26e8f9": "timeOnJob",
    "366f5d279222b4c36bd1b3a4cccd4d2d67b77833": "rentOrOwn",
    "5530e4ac6b144e965c80fc49a18237591ee0b2a3": "monthlyPayment",
    "1d73b415c786bb6e1feefd137f3362d7df057fda": "timeAtAddress",
    "f72c950606278711225de1c6d279e3bae6e14331": "validLicense",
    "a7c81ae79890d65ac301296c947f335e91730146": "leadSource",
    "f805e9aac832acb583d7e9f293711e48222bc402": "creditSelfRating",
    "6ae2b9103295bf3b6b8fc1218762fc231edb8499": "citizenOrPR",
    "43a9d5f5592e07c8b7fb771e4df6a767f188130f": "applicationId",
  };
  // Enum option-id -> label (for single-option Pipedrive fields).
  const CRM_ENUMS: Record<string, Record<number, string>> = {
    "f72c950606278711225de1c6d279e3bae6e14331": { 201: "Yes", 202: "No" }, // Valid Drivers License
  };
  // Unified pipeline — everything is a lead, one board. New leads land in "New Lead".
  // "Not Approved" and "Lost" are terminal exits. Distribution (drip/round-robin/timeouts)
  // is handled by the n8n engine, which reads owner + crmPresence (active reps).
  const CRM_STAGES = [
    { key: "new_lead", label: "New Lead" },
    { key: "attempting_contact", label: "Attempting Contact" },
    { key: "dealertrack", label: "Submitted to Dealertrack" },
    { key: "approved", label: "Approved" },
    { key: "signed", label: "Signed" },
    { key: "lost", label: "Lost" },
    { key: "free_to_call", label: "Free to Call Pool" },   // released leads — own tab, not a board column
  ];
  const pipedriveLeadToCrm = (lead: any) => {
    const mapped: Record<string, any> = {};
    for (const [hash, name] of Object.entries(CRM_FIELDS)) {
      let val = lead[hash];
      if (val === undefined || val === null || val === "") continue;
      const em = CRM_ENUMS[hash];
      if (em && em[Number(val)]) val = em[Number(val)];
      mapped[name] = val;
    }
    return {
      pipedriveLeadId: String(lead.id),
      pipedrivePersonId: lead.person_id ?? null,
      ownerId: lead.owner_id ?? null,
      title: lead.title ?? null,
      labelIds: lead.label_ids || [],
      addTime: lead.add_time ?? null,
      updateTime: lead.update_time ?? null,
      ...mapped,
      pipedriveRaw: lead, // full record kept for migration safety
    };
  };

  // Import one Pipedrive lead into crmLeads (by id, or the most recent if none given).
  app.post("/api/crm/import", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const apiToken = process.env.PIPEDRIVE_API_TOKEN;
      if (!apiToken) return res.status(500).json({ error: "PIPEDRIVE_API_TOKEN not configured." });
      const { pipedriveLeadId } = req.body || {};
      let lead: any = null;
      if (pipedriveLeadId) {
        const r = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads/${pipedriveLeadId}?api_token=${apiToken}`);
        lead = (await r.json())?.data || null;
      } else {
        const r = await fetchWithTimeout(`https://api.pipedrive.com/v1/leads?sort=add_time%20DESC&limit=1&api_token=${apiToken}`);
        lead = ((await r.json())?.data || [])[0] || null;
      }
      if (!lead) return res.status(404).json({ error: "No lead found in Pipedrive." });
      let notes: any[] = [];
      try {
        const nr = await fetchWithTimeout(`https://api.pipedrive.com/v1/notes?lead_id=${lead.id}&api_token=${apiToken}`);
        notes = ((await nr.json())?.data || []).map((n: any) => ({ content: n.content, addTime: n.add_time, byName: n.user?.name || null }));
      } catch {}
      const docRef = ctx.db.collection("crmLeads").doc(String(lead.id));
      const existing = await docRef.get();
      const record: any = {
        ...pipedriveLeadToCrm(lead),
        notes,
        source: "pipedrive-import",
        importedAt: new Date().toISOString(),
        importedBy: ctx.email,
      };
      // New leads land in "New Lead"; a re-import never drags a worked lead backwards.
      if (!existing.exists || !existing.get("stage")) record.stage = "new_lead";
      await docRef.set(record, { merge: true });
      res.json({ success: true, lead: { id: String(lead.id), ...record } });
    } catch (err: any) {
      console.error("[CRM-IMPORT] error:", err?.message || err);
      res.status(500).json({ error: "Failed to import lead." });
    }
  });

  // List CRM leads (our own copy) + the pipeline stages, sales team, and who's
  // currently signed in as "active" (the roster the distribution engine reads).
  app.get("/api/crm/leads", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      // Board/Inbox = the ACTIVE pipeline only. free_to_call (the 35k+ archive pool) and
      // lost/nurture have their own paginated endpoints — never load them here.
      const ACTIVE_STAGES = ["new_lead", "attempting_contact", "dealertrack", "approved", "signed"];
      const snap = await ctx.db.collection("crmLeads")
        .where("stage", "in", ACTIVE_STAGES)
        .orderBy("addTime", "desc").limit(1000).get();
      let leads = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) }));
      // Sales team = the rep directory (crmReps). Presence (active) lives on each rep.
      const repsSnap = await ctx.db.collection("crmReps").get();
      // Reps only ever see ASSIGNED leads — unassigned leads wait in the admin
      // Inbox until they're dispersed. Admins get everything (Inbox + board).
      if (ctx.role === "sales_rep") {
        const myRepIds = new Set(repsSnap.docs.filter((d: any) => d.get("uid") === ctx.uid).map((d: any) => d.id));
        leads = leads.filter((l: any) => l.owner);   // reps see only their assigned, active leads
      }
      const reps = repsSnap.docs
        .filter((d: any) => d.get("archived") !== true)   // offboarded reps drop out of dropdowns/rotation
        .map((d: any) => ({
          id: d.id, name: d.get("name") || "—",
          quoNumber: d.get("quoNumber") || null,
          active: d.get("active") === true,
          uid: d.get("uid") || null,
        })).sort((a: any, b: any) => a.name.localeCompare(b.name));
      // Which rep is the signed-in user (so the client can scope "my leads" + presence).
      let myRep = reps.find((r: any) => r.uid && r.uid === ctx.uid);
      // First-login linking: connect this account to its rep record by email.
      if (!myRep && ctx.email) {
        const match = repsSnap.docs.find((d: any) => (d.get("email") || "").toLowerCase() === ctx.email && d.get("archived") !== true);
        if (match && match.get("uid") !== ctx.uid) {
          try { await match.ref.update({ uid: ctx.uid }); } catch {}
          myRep = reps.find((r: any) => r.id === match.id);
          if (myRep) myRep.uid = ctx.uid;
        }
      }
      res.json({ leads, stages: CRM_STAGES, reps, myRepId: myRep ? myRep.id : null, role: ctx.role });
    } catch (err: any) {
      console.error("[CRM-LEADS] error:", err?.message || err);
      res.status(500).json({ error: "Failed to load CRM leads." });
    }
  });

  // Update a CRM lead: move stage, log an activity/contact note, or (re)assign owner.
  app.post("/api/crm/lead-update", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { id, stage, note, owner, ownerName, lostReason, nurtureAt, lostNote, fields } = req.body || {};
      if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing lead id." });
      const now = new Date().toISOString();
      const update: any = { updatedAt: now };
      // Rep-editable lead fields (correct a customer's typo while confirming details).
      const EDITABLE = new Set([
        "firstName", "lastName", "phone", "email", "dob", "street", "suite", "city", "province", "postal",
        "lookingFor", "budget", "downPayment", "hasTradeIn", "employmentStatus", "employer", "jobTitle",
        "hourlyWage", "monthlyIncome", "hoursPerWeek", "timeOnJob", "rentOrOwn", "monthlyPayment",
        "timeAtAddress", "creditSelfRating", "validLicense", "citizenOrPR",
      ]);
      const hasFields = fields && typeof fields === "object" && Object.keys(fields).length > 0;
      // Income drives underwriting — only managers/admins may change it. Reps get a clear error.
      const INCOME_LOCKED = new Set(["hourlyWage", "monthlyIncome", "hoursPerWeek"]);
      if (hasFields && ctx.role === "sales_rep") {
        const blocked = Object.keys(fields).filter((k) => INCOME_LOCKED.has(k));
        if (blocked.length) return res.status(403).json({ error: "Income fields (wage, monthly income, hours) can only be changed by a manager." });
      }
      if (hasFields) {
        for (const [k, val] of Object.entries(fields)) {
          if (!EDITABLE.has(k)) continue;
          update[k] = val == null || val === "" ? null : String(val).slice(0, 500);
        }
        if (Object.prototype.hasOwnProperty.call(fields, "phone")) {
          update.phoneKey = fields.phone ? String(fields.phone).replace(/\D+/g, "").slice(-10) : null; // keep Quo matching in sync
        }
      }
      if (stage !== undefined) {
        if (!CRM_STAGES.some((s) => s.key === stage)) return res.status(400).json({ error: "Invalid stage." });
        update.stage = stage;
        if (stage !== "lost") update.lostReason = null;   // leaving Lost clears the reason
        // Record the transition (from → to, who, when) for per-rep pipeline reporting.
        const cur = await ctx.db.collection("crmLeads").doc(id).get();
        const from = cur.exists ? (cur.get("stage") || null) : null;
        if (from !== stage) {
          // No going backwards from a worked stage to New Lead / Attempting Contact —
          // a lead that reached Dealertrack doesn't un-reach it, and it closes the
          // "bounce out and back to reset the 3-day clock" loophole. Admins can
          // still pull it back (mistakes happen); reps can't.
          const ORDER = ["new_lead", "attempting_contact", "dealertrack", "approved", "signed"];
          const fi = ORDER.indexOf(from || ""), ti = ORDER.indexOf(stage);
          if (ctx.role === "sales_rep" && fi >= 2 && ti >= 0 && ti < fi) {
            return res.status(400).json({ error: "Leads can't move backwards from here. If it's not going ahead, mark it Lost — or ask a manager." });
          }
          update.stageHistory = ctx.admin.firestore.FieldValue.arrayUnion({ from, to: stage, by: ctx.email, byUid: ctx.uid, at: now });
          if (stage === "attempting_contact") {
            update.lastAttemptAt = now;
            // Stamp the FIRST entry only — the 3-business-day clock never resets.
            if (!cur.get("attemptingSince")) update.attemptingSince = now;
          }
        }
      }
      if (lostReason !== undefined) update.lostReason = lostReason ? String(lostReason).slice(0, 120) : null;
      // Lost = "not now": park it in Nurture with a wake-up date (null = dead, no follow-up).
      // Leaves the rep's board (owner cleared) — the lead becomes a company asset again.
      if (stage === "lost") {
        const nAt = nurtureAt ? new Date(String(nurtureAt)) : null;
        update.nurtureAt = nAt && !isNaN(nAt.getTime()) ? nAt.toISOString() : null;
        update.nurtureStatus = update.nurtureAt ? "sleeping" : "dead";
        try {
          const cur0 = await ctx.db.collection("crmLeads").doc(id).get();
          update.lostBy = cur0.get("owner") || null; update.lostByName = cur0.get("ownerName") || null; update.lostAt = now;
        } catch {}
        update.owner = null; update.ownerName = null; update.assignedAt = null;
        const ln = lostNote ? String(lostNote).trim().slice(0, 1000) : "";
        update.lostNote = ln || null;
        const wake = update.nurtureAt ? ` Wake-up ${String(update.nurtureAt).slice(0, 10)}.` : " No follow-up.";
        update.__lostEntry = { text: `🚫 Marked lost — ${lostReason || "no reason"}.${ln ? `\n${ln}` : ""}${wake}`, by: ctx.name || ctx.email, byUid: ctx.uid, at: now, kind: "note" };
        update.activityLog = ctx.admin.firestore.FieldValue.arrayUnion(update.__lostEntry);
      }
      if (owner !== undefined) {
        update.owner = owner || null;                 // null = back to the "Vehicle Approval Centre" pool
        update.ownerName = owner ? (ownerName || null) : null;
        update.assignedAt = owner ? now : null;
      }
      let addedNote: any = null;
      if (note && String(note).trim()) {
        addedNote = { text: String(note).trim().slice(0, 4000), by: ctx.name || ctx.email, byEmail: ctx.email, byUid: ctx.uid, at: now, kind: "note" };
        update.activityLog = update.__lostEntry ? ctx.admin.firestore.FieldValue.arrayUnion(update.__lostEntry, addedNote) : ctx.admin.firestore.FieldValue.arrayUnion(addedNote);
        update.lastAttemptAt = now;                    // resets the "stale" timer the engine watches
      }
      if (stage === undefined && owner === undefined && !addedNote && !hasFields)
        return res.status(400).json({ error: "Nothing to update." });
      delete update.__lostEntry;
      await ctx.db.collection("crmLeads").doc(id).update(update);
      res.json({ success: true, note: addedNote });
    } catch (err: any) {
      console.error("[CRM-LEAD-UPDATE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to update lead." });
    }
  });

  // Toggle a rep's "active" (signed-in) status on their directory record.
  // Auto-assignment only routes to reps whose crmReps doc is active === true.
  app.post("/api/crm/rep-active", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { repId, active } = req.body || {};
      if (!repId || typeof repId !== "string") return res.status(400).json({ error: "Missing rep id." });
      if (typeof active !== "boolean") return res.status(400).json({ error: "'active' must be true/false." });
      const repRef = ctx.db.collection("crmReps").doc(repId);
      const repSnap = await repRef.get();
      if (!repSnap.exists) return res.status(404).json({ error: "Rep not found." });
      // A rep may only sign themselves in/out; admins can toggle anyone.
      if (ctx.role === "sales_rep" && repSnap.get("uid") !== ctx.uid) return res.status(403).json({ error: "You can only change your own status." });
      const now = new Date().toISOString();
      await repRef.update({ active, lastActiveAt: active ? now : null });
      // Phase A: when a rep signs in DURING business hours, hand them the OLDEST
      // waiting lead (just one — the heartbeat drips the rest). Before 9am / after
      // 8pm / weekends, nothing is handed out; the pool holds until the next morning.
      if (active === true && isBusinessHours()) {
        try {
          const snap = await ctx.db.collection("crmLeads").orderBy("addTime", "desc").limit(100).get();
          const waiting = snap.docs
            .filter((d: any) => !d.get("owner"))
            .sort((a: any, b: any) => String(a.get("addTime") || "").localeCompare(String(b.get("addTime") || "")));
          if (waiting.length) {
            await waiting[0].ref.update({ owner: repId, ownerName: repSnap.get("name") || null, assignedAt: now, updatedAt: now });
            await repRef.update({ lastAssignedAt: now });
          }
        } catch (pullErr: any) { console.error("[REP-ACTIVE] sign-in pull failed (non-fatal):", pullErr?.message || pullErr); }
      }
      res.json({ success: true });
    } catch (err: any) {
      console.error("[CRM-REP-ACTIVE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to update rep status." });
    }
  });

  // --- Team management (rep directory CRUD) — admin only ---
  app.get("/api/crm/reps", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const snap = await ctx.db.collection("crmReps").get();
      const reps = snap.docs.map((d: any) => ({
        id: d.id, name: d.get("name") || "—", quoNumber: d.get("quoNumber") || null,
        active: d.get("active") === true, archived: d.get("archived") === true,
        uid: d.get("uid") || null, pipedriveOwnerId: d.get("pipedriveOwnerId") || null,
      })).sort((a: any, b: any) => (Number(a.archived) - Number(b.archived)) || a.name.localeCompare(b.name));
      res.json({ reps });
    } catch (err: any) {
      console.error("[CRM-REPS] error:", err?.message || err);
      res.status(500).json({ error: "Failed to load reps." });
    }
  });

  // Add a rep (onboard) or edit one. id omitted → create (slug from name).
  app.post("/api/crm/rep-save", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { id, name, quoNumber, email, title } = req.body || {};
      const cleanName = String(name || "").trim();
      if (!cleanName) return res.status(400).json({ error: "Name is required." });
      const cleanEmail = email ? String(email).trim().toLowerCase() : null;
      if (cleanEmail && !cleanEmail.endsWith("@drivevac.ca")) return res.status(400).json({ error: "Rep email must be an @drivevac.ca address." });
      // Store the Quo number in E.164 (+1XXXXXXXXXX) regardless of how it was typed.
      const quoDigits = quoNumber ? String(quoNumber).replace(/\D+/g, "") : "";
      const quo = quoDigits ? (quoDigits.length === 10 ? `+1${quoDigits}` : `+${quoDigits}`) : null;
      const quoKey = quoDigits ? quoDigits.slice(-10) : null;
      const slug = (id && String(id).trim()) || cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) return res.status(400).json({ error: "Invalid name." });
      const ref = ctx.db.collection("crmReps").doc(slug);
      const exists = (await ref.get()).exists;
      const data: any = { name: cleanName, quoNumber: quo, quoKey, archived: false };
      if (cleanEmail) data.email = cleanEmail;
      if (title !== undefined) data.title = String(title || "").trim().slice(0, 80) || null;   // job title for the email signature
      if (!exists) data.active = false;
      await ref.set(data, { merge: true });

      // Onboarding: create/refresh an invitation so this @drivevac.ca email gets the
      // sales_rep role on first sign-in, and email them an invite to set up + PIN.
      let invited = false;
      if (cleanEmail) {
        try {
          const inviteRef = ctx.db.collection("invitations").doc(cleanEmail);
          const alreadyUser = !(await ctx.db.collection("users").where("email", "==", cleanEmail).limit(1).get()).empty;
          await inviteRef.set({ email: cleanEmail, role: "sales_rep", status: "pending", invitedBy: ctx.email, name: cleanName, createdAt: new Date().toISOString() }, { merge: true });
          if (!alreadyUser) {
            const link = "https://vehicleapprovalcentre.com/admin?tab=crm";
            const html = `<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;color:#41456B">
              <div style="background:linear-gradient(135deg,#7380FF,#41456B);padding:28px 24px;border-radius:16px 16px 0 0;text-align:center">
                <h1 style="color:#fff;margin:0;font-size:22px">Welcome to the VAC CRM</h1>
              </div>
              <div style="background:#fff;border:1px solid #eee;border-top:0;border-radius:0 0 16px 16px;padding:28px 24px">
                <p style="font-size:15px;line-height:1.6">Hi ${cleanName.replace(/[<>&]/g, "")},</p>
                <p style="font-size:15px;line-height:1.6">You've been added to the <b>Vehicle Approval Centre</b> sales CRM. Click below, sign in with your <b>@drivevac.ca</b> Google account, and set up your PIN to get started.</p>
                <p style="text-align:center;margin:26px 0">
                  <a href="${link}" style="background:#7380FF;color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;display:inline-block;font-size:15px">Set up my account</a>
                </p>
                <p style="font-size:13px;color:#888;line-height:1.6">Once you're in, flip yourself <b>Active</b> to start receiving leads. Questions? Just reply to this email.</p>
              </div>
            </div>`;
            const resend = getResendClient();
            await resend.emails.send({ from: "Vehicle Approval Centre <admin@drivevac.ca>", to: cleanEmail, subject: "You're invited to the VAC CRM", html });
            invited = true;
          }
        } catch (e: any) { console.error("[REP-SAVE] invite failed (non-fatal):", e?.message || e); }
      }
      res.json({ success: true, id: slug, invited });
    } catch (err: any) {
      console.error("[REP-SAVE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to save rep." });
    }
  });

  // Offboard a rep — archive (keeps history, removes from dropdowns/rotation).
  app.post("/api/crm/rep-remove", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { id, restore } = req.body || {};
      if (!id || typeof id !== "string") return res.status(400).json({ error: "Missing rep id." });
      await ctx.db.collection("crmReps").doc(id).set(
        { archived: restore ? false : true, active: false }, { merge: true });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[REP-REMOVE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to update rep." });
    }
  });

  // --- Quo call/text webhook → logs into the lead's CRM activity thread ---
  // Quo POSTs here on call-completed / SMS events. We match the customer's phone
  // to a crmLead and append a call/text entry to its activityLog. Field names are
  // mapped DEFENSIVELY (many aliases) so it works against Quo's real payload with a
  // one-line tweak once we have a sample. Auth = shared secret (QUO_WEBHOOK_SECRET)
  // via header or ?token=. No secret set → allowed (for first-run testing) + warns.
  app.post("/api/crm/quo-webhook", async (req, res) => {
    try {
      const secret = process.env.QUO_WEBHOOK_SECRET;
      if (secret) {
        const provided = req.get("x-quo-signature") || req.get("x-quo-secret") || req.get("x-webhook-secret")
          || (req.query.token as string) || (req.query.secret as string) || "";
        if (provided !== secret) return res.status(401).json({ error: "Bad webhook secret." });
      } else {
        console.warn("[QUO] QUO_WEBHOOK_SECRET not set — webhook is unauthenticated.");
      }

      const b = req.body || {};
      const rawType = String(b.type || b.event || b.event_type || "").toLowerCase(); // envelope, e.g. "message.received"
      // OpenPhone/Quo wraps the actual record in data.object.
      const p = (b.data && b.data.object) || b.data || b.object || b;
      const pick = (...keys: string[]) => {
        for (const k of keys) {
          const v = k.split(".").reduce((o: any, kk: string) => (o == null ? o : o[kk]), p);
          if (v !== undefined && v !== null && v !== "") return v;
        }
        return undefined;
      };

      // Only log final, meaningful events — ignore ringing / message.sent / etc. to
      // avoid noise and duplicate thread entries.
      const ACCEPT = ["message.received", "message.delivered", "call.completed", "call.recording.completed"];
      if (rawType && !ACCEPT.includes(rawType)) return res.json({ success: true, ignored: rawType });

      const isRecording = rawType === "call.recording.completed";
      const isCall = /call/.test(rawType) || pick("duration", "recording_url") !== undefined;
      const hasBody = pick("body", "text", "message") !== undefined;
      const isText = !isCall && (/message|sms|text/.test(rawType) || hasBody);
      const dirRaw = String(pick("direction", "call_direction") || "").toLowerCase(); // outgoing / incoming
      const direction = dirRaw.includes("out") ? "outbound" : dirRaw.includes("in") ? "inbound" : "";
      const from = String(pick("from", "from_number", "caller") || "");
      const to = String(pick("to", "to_number", "callee") || "");
      const bodyText = pick("body", "text", "message");
      const duration = pick("duration", "call_duration", "length");
      let recording = pick("recording_url", "recordingUrl", "url");            // recordings arrive as a url…
      if (!recording) { const media = pick("media"); if (Array.isArray(media) && media[0]) recording = media[0].url || media[0].link; } // …or in media[]
      const externalId = String(pick("id") || "");                            // OpenPhone message/call id (AC…/CA…)
      const quoUserId = String(pick("userId", "createdBy") || "");            // which Quo user made it → rep attribution
      const tsRaw = pick("createdAt", "completedAt", "answeredAt", "timestamp", "created_at", "time") || b.createdAt;
      let atIso = new Date().toISOString();
      try { if (tsRaw) { const d = new Date(isNaN(Number(tsRaw)) ? tsRaw : Number(tsRaw)); if (!isNaN(d.getTime())) atIso = d.toISOString(); } } catch {}

      // Match the customer's number (try both from & to) to a crmLead.
      const { admin, db } = await getFirestoreAdmin();
      const keys = [from, to].map(phoneKeyOf).filter((k) => k && k.length >= 7);
      let match: any = null;
      for (const k of keys) {
        const q = await db.collection("crmLeads").where("phoneKey", "==", k).limit(5).get();
        if (!q.empty) { match = q.docs.sort((a: any, x: any) => String(x.get("addTime") || "").localeCompare(String(a.get("addTime") || "")))[0]; break; }
      }
      if (!match) {
        // Fallback for leads saved before phoneKey existed: bounded scan.
        const recent = await db.collection("crmLeads").orderBy("addTime", "desc").limit(500).get();
        match = recent.docs.find((d: any) => keys.includes(phoneKeyOf(d.get("phone")))) || null;
      }
      if (!match) { console.warn("[QUO] no lead match for", keys); return res.json({ success: true, matched: false }); }

      // De-dupe by OpenPhone id (recording events share the call id, so let those through).
      const existing = (match.get("activityLog") || []) as any[];
      if (externalId && !isRecording && existing.some((a) => a && a.externalId === externalId && a.kind !== "recording")) {
        return res.json({ success: true, duplicate: true });
      }

      const secs = Number(duration);
      let text: string; let kind: string;
      if (isRecording) {
        kind = "recording";
        text = `📼 Call recording available${recording ? `: ${recording}` : ""}`;
      } else if (isText) {
        kind = "text";
        text = `💬 Text ${direction === "outbound" ? "sent" : "received"}${bodyText ? `: ${String(bodyText).slice(0, 1000)}` : ""}`;
      } else {
        kind = "call";
        const status = String(pick("status") || "").toLowerCase();
        const isVm = /voicemail/.test(status) || pick("voicemail") !== undefined;
        const answered = (!isNaN(secs) && secs > 0) || /complet|answer|progress/.test(status);
        const dirWord = direction === "outbound" ? "Outbound" : "Inbound";
        if (isVm) {
          text = `📼 Voicemail ${direction === "outbound" ? "left" : "from caller"}`;
        } else if (answered) {
          const dur = !isNaN(secs) && secs > 0 ? ` · ${Math.floor(secs / 60)}m ${secs % 60}s` : "";
          text = `📞 ${dirWord} call${dur}`;
        } else {
          text = direction === "outbound" ? "📞 Outbound call · no answer" : "📞 Missed call";
        }
      }
      // Attribute to the rep whose Quo LINE this went through — i.e. the from/to
      // number that isn't the customer's (matched lead) number → crmReps.quoKey.
      let by = "Quo"; let byRepId: string | undefined;
      const custKey = phoneKeyOf(match.get("phone"));
      const lineKey = [from, to].map(phoneKeyOf).find((k) => k && k !== custKey) || "";
      if (lineKey) {
        try { const rq = await db.collection("crmReps").where("quoKey", "==", lineKey).limit(1).get(); if (!rq.empty) { by = rq.docs[0].get("name") || by; byRepId = rq.docs[0].id; } } catch {}
      }
      const entry: any = { text, by, at: atIso, kind, direction, from, to, externalId, quoUserId };
      if (byRepId) entry.byRepId = byRepId;
      if (recording) entry.recording = String(recording);
      await match.ref.update({
        activityLog: admin.firestore.FieldValue.arrayUnion(entry),
        lastAttemptAt: atIso,
        updatedAt: new Date().toISOString(),
      });
      res.json({ success: true, matched: true, leadId: match.id, kind });
    } catch (err: any) {
      console.error("[QUO-WEBHOOK] error:", err?.message || err);
      res.status(500).json({ error: "Webhook processing failed." });
    }
  });

  // --- Send an SMS to a lead THROUGH Quo/OpenPhone, from the CRM thread ---
  // Logs the sent text with the OpenPhone message id as externalId, so the
  // later message.delivered webhook de-dupes against it (no double entry).
  // ---- Reports: per-rep effort & outcomes over a date range -----------------
  // Attribution: activity entries carry byRepId (Quo + sent texts), byUid (notes,
  // stage moves) or by=email — all resolved to a crmReps record here.
  app.get("/api/crm/reports", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
      const since = new Date(Date.now() - days * 86_400_000);
      const sinceIso = since.toISOString();

      const repsSnap = await ctx.db.collection("crmReps").get();
      // Shared/pool accounts (poolAccount: true, e.g. "Leads VAC") aren't salespeople —
      // they'd just soak up every inbound on the shared line. Excluded from the scorecard.
      const reps: any[] = repsSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })).filter((r: any) => !r.archived && !r.poolAccount);
      const byRepId = new Map<string, any>(), byUid = new Map<string, any>(), byEmail = new Map<string, any>();
      for (const r of reps) { byRepId.set(r.id, r); if (r.uid) byUid.set(r.uid, r); if (r.email) byEmail.set(String(r.email).toLowerCase(), r); }
      const resolve = (e: any): any | null =>
        (e?.byRepId && byRepId.get(e.byRepId)) || (e?.byUid && byUid.get(e.byUid)) || (e?.byEmail && byEmail.get(String(e.byEmail).toLowerCase())) || (e?.by && byEmail.get(String(e.by).toLowerCase())) || null;

      const blank = () => ({ assigned: 0, calls: 0, texts: 0, notes: 0, touches: 0, leadsTouched: 0, inboundReplies: 0,
        toDealertrack: 0, approved: 0, signed: 0, lost: 0, released: 0, releasedNoEffort: 0, bounced: 0,
        firstContactMins: [] as number[], activeLeads: 0, untouchedLeads: 0 });
      const stats: Record<string, any> = {};
      for (const r of reps) stats[r.id] = { rep: { id: r.id, name: r.name, active: !!r.active }, ...blank() };
      const touchedSets: Record<string, Set<string>> = {}; for (const r of reps) touchedSets[r.id] = new Set();

      const leadsSnap = await ctx.db.collection("crmLeads").get();
      let totalLeads = 0, poolNow = 0;
      for (const d of leadsSnap.docs) {
        const l: any = d.data() || {}; totalLeads++;
        if (!l.owner) poolNow++;
        // Current-book snapshot (not date-bounded): what each rep is holding right now.
        if (l.owner && stats[l.owner] && !["signed", "lost"].includes(l.stage || "")) {
          stats[l.owner].activeLeads++;
          const log: any[] = l.activityLog || [];
          const repTouched = log.some((a) => resolve(a)?.id === l.owner && a.by !== "System");
          if (!repTouched) stats[l.owner].untouchedLeads++;
        }
        // Assignments in window
        if (l.assignedAt && l.assignedAt >= sinceIso && l.owner && stats[l.owner]) stats[l.owner].assigned++;
        // Activity in window
        const log: any[] = l.activityLog || [];
        let firstOutboundAt: number | null = null;
        for (const a of log) {
          if (!a || !a.at || a.at < sinceIso) continue;
          if (a.bounce && a.bouncedFrom && stats[a.bouncedFrom]) { stats[a.bouncedFrom].bounced++; continue; }   // hot-lead bounce AWAY from this rep
          if (a.direction === "inbound") { const owner = l.owner && stats[l.owner]; if (owner) owner.inboundReplies++; continue; }
          const r = resolve(a); if (!r || !stats[r.id]) continue;
          const s = stats[r.id];
          if (a.kind === "call") s.calls++; else if (a.kind === "text") s.texts++; else s.notes++;
          s.touches++; touchedSets[r.id].add(d.id);
          if (a.kind === "call" || a.kind === "text") { const t = Date.parse(a.at); if (firstOutboundAt == null || t < firstOutboundAt) firstOutboundAt = t; }
        }
        if (firstOutboundAt != null && l.assignedAt && l.owner && stats[l.owner]) {
          const mins = (firstOutboundAt - Date.parse(l.assignedAt)) / 60000;
          if (mins >= 0 && mins < 60 * 24 * 30) stats[l.owner].firstContactMins.push(mins);
        }
        // Stage outcomes in window (credited to who moved it)
        for (const h of (l.stageHistory || [])) {
          if (!h || !h.at || h.at < sinceIso) continue;
          if (h.by === "system:free-to-call") {
            const from = l.releaseStats?.from || l.releasedFrom; const s = from && stats[from];
            if (s) { s.released++; if (l.releaseStats && (l.releaseStats.calls + l.releaseStats.texts) === 0) s.releasedNoEffort++; }
            continue;
          }
          const r = resolve(h); if (!r || !stats[r.id]) continue;
          if (h.to === "dealertrack") stats[r.id].toDealertrack++;
          if (h.to === "approved") stats[r.id].approved++;
          if (h.to === "signed") stats[r.id].signed++;
          if (h.to === "lost") stats[r.id].lost++;
        }
      }
      const rows = Object.values(stats).map((s: any) => {
        const fc = s.firstContactMins as number[]; fc.sort((a, b) => a - b);
        const median = fc.length ? fc[Math.floor(fc.length / 2)] : null;
        const { firstContactMins, ...rest } = s;
        return { ...rest, leadsTouched: touchedSets[s.rep.id].size, medianFirstContactMins: median == null ? null : Math.round(median),
          touchesPerLead: s.assigned ? +(s.touches / s.assigned).toFixed(1) : null };
      }).sort((a: any, b: any) => b.touches - a.touches);
      // Reps only see their own row.
      const visible = ctx.role === "sales_rep" ? rows.filter((r: any) => byUid.get(ctx.uid)?.id === r.rep.id) : rows;
      res.json({ days, since: sinceIso, totals: { leads: totalLeads, pool: poolNow }, rows: visible });
    } catch (err: any) {
      console.error("[CRM-REPORTS] error:", err?.message || err);
      res.status(500).json({ error: "Failed to build report." });
    }
  });

  // Manual lead — a rep types in a walk-in / phone-in / referral. Assigned to the
  // creating rep by default (or a chosen owner). Dedupes on phone so a customer
  // who already applied online doesn't get a second card.
  app.post("/api/crm/lead-create", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const b = req.body || {};
      const s = (v: any, max = 200) => { const t = v == null ? "" : String(v).trim(); return t ? t.slice(0, max) : null; };
      const firstName = s(b.firstName), lastName = s(b.lastName);
      const phone = s(b.phone, 40), email = s(b.email, 200)?.toLowerCase() || null;
      if (!firstName && !lastName) return res.status(400).json({ error: "A name is required." });
      if (!phone && !email) return res.status(400).json({ error: "A phone number or email is required." });
      const phoneKey = phone ? phone.replace(/\D+/g, "").slice(-10) : null;
      if (phone && (!phoneKey || phoneKey.length < 10)) return res.status(400).json({ error: "Please enter a valid 10-digit phone number." });

      // Dedupe: an existing lead with this phone → hand it back instead of duplicating.
      if (phoneKey) {
        const dup = await ctx.db.collection("crmLeads").where("phoneKey", "==", phoneKey).limit(1).get();
        if (!dup.empty) {
          const d = dup.docs[0];
          return res.status(409).json({ error: "A lead with this phone number already exists.", existingId: d.id, existingName: [d.get("firstName"), d.get("lastName")].filter(Boolean).join(" ") });
        }
      }

      // Owner: chosen rep, else the creating rep's own record, else unassigned (Inbox).
      let owner: string | null = null, ownerName: string | null = null;
      const wantOwner = s(b.owner, 120);
      if (wantOwner) {
        const r = await ctx.db.collection("crmReps").doc(wantOwner).get();
        if (r.exists) { owner = r.id; ownerName = r.get("name") || null; }
      } else {
        const mine = await ctx.db.collection("crmReps").where("uid", "==", ctx.uid).limit(1).get();
        if (!mine.empty) { owner = mine.docs[0].id; ownerName = mine.docs[0].get("name") || null; }
      }

      const nowIso = new Date().toISOString();
      const rec: any = {
        pipedriveLeadId: null, pipedrivePersonId: null,
        title: [firstName, lastName].filter(Boolean).join(" "),
        firstName, lastName, phone, phoneKey, email,
        dob: s(b.dob, 20), street: s(b.street), suite: s(b.suite, 40), city: s(b.city, 100), province: s(b.province, 40), postal: s(b.postal, 20),
        lookingFor: s(b.lookingFor, 120), budget: s(b.budget, 60), downPayment: s(b.downPayment, 40), hasTradeIn: s(b.hasTradeIn, 20),
        employmentStatus: s(b.employmentStatus, 60), employer: s(b.employer), jobTitle: s(b.jobTitle),
        hourlyWage: s(b.hourlyWage, 20), monthlyIncome: s(b.monthlyIncome, 20), hoursPerWeek: s(b.hoursPerWeek, 10), timeOnJob: s(b.timeOnJob, 40),
        rentOrOwn: s(b.rentOrOwn, 20), monthlyPayment: s(b.monthlyPayment, 20), timeAtAddress: s(b.timeAtAddress, 40),
        creditSelfRating: s(b.creditSelfRating, 40), validLicense: s(b.validLicense, 10), citizenOrPR: s(b.citizenOrPR, 10),
        leadSource: s(b.leadSource, 60) || "Manual entry",
        source: "manual", createdBy: ctx.email, createdByName: ctx.name || ctx.email,
        stage: "new_lead", owner, ownerName, assignedAt: owner ? nowIso : null,
        addTime: nowIso, updatedAt: nowIso,
        activityLog: [{ text: `📝 Lead created manually by ${ctx.name || ctx.email}${s(b.note) ? ` — ${s(b.note, 1000)}` : ""}`, by: ctx.name || ctx.email, byUid: ctx.uid, at: nowIso, kind: "note" }],
      };
      const docRef = ctx.db.collection("crmLeads").doc();
      await docRef.set(rec);
      if (owner) { try { await ctx.db.collection("crmReps").doc(owner).update({ lastAssignedAt: nowIso }); } catch {} }
      res.json({ success: true, id: docRef.id, lead: { id: docRef.id, ...rec } });
    } catch (err: any) {
      console.error("[LEAD-CREATE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to create lead." });
    }
  });

  // ---- Email via Gmail domain-wide delegation --------------------------------
  // Sends AS the signed-in rep's own @drivevac.ca (lands in their real Sent folder),
  // logs to the lead's thread. Which address: the rep's crmReps.email, else their login.
  const repEmailFor = async (ctx: any): Promise<{ email: string; name: string; repId?: string }> => {
    const mine = await ctx.db.collection("crmReps").where("uid", "==", ctx.uid).limit(1).get();
    if (!mine.empty) { const r = mine.docs[0]; return { email: (r.get("email") || ctx.email).toLowerCase(), name: r.get("name") || ctx.name, repId: r.id }; }
    return { email: ctx.email, name: ctx.name || ctx.email };
  };
  const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const emailUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 5 } });
  app.post("/api/crm/send-email", emailUpload.array("files", 5), async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { leadId, subject, body } = req.body || {};
      if (!leadId || typeof leadId !== "string") return res.status(400).json({ error: "Missing lead id." });
      const subj = String(subject || "").trim().slice(0, 200);
      const text = String(body || "").trim().slice(0, 20000);
      if (!subj) return res.status(400).json({ error: "Subject is required." });
      if (!text) return res.status(400).json({ error: "Email body is empty." });

      const leadRef = ctx.db.collection("crmLeads").doc(leadId);
      const leadSnap = await leadRef.get();
      if (!leadSnap.exists) return res.status(404).json({ error: "Lead not found." });
      const to = String(leadSnap.get("email") || "").trim().toLowerCase();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "This lead has no valid email address." });

      const from = await repEmailFor(ctx);
      if (!from.email.endsWith("@drivevac.ca")) return res.status(400).json({ error: "Can only send from an @drivevac.ca address." });

      // Reply in-thread if we've emailed this lead before — but a Gmail threadId only
      // exists in the mailbox that sent it. If a DIFFERENT rep is sending now, start a
      // fresh thread (Gmail returns "Requested entity was not found" otherwise).
      const prevAll: any = leadSnap.get("emailThread") || null;
      const prev: any = prevAll && String(prevAll.repEmail || "").toLowerCase() === from.email ? prevAll : null;
      // Company-standard signature (WiseStamp layout), filled from the rep's record.
      let sigRep: any = { name: from.name, email: from.email };
      if (from.repId) { try { const r = await ctx.db.collection("crmReps").doc(from.repId).get(); if (r.exists) sigRep = { name: r.get("name") || from.name, title: r.get("title") || null, phone: r.get("phone") || null, mobile: r.get("mobile") || r.get("quoNumber") || null, email: from.email }; } catch {} }
      const sigHtml = vacSignatureHtml(sigRep);
      const sigText = `\n\n${sigRep.name}${sigRep.title ? `\n${sigRep.title}, Vehicle Approval Centre` : `\nVehicle Approval Centre`}${sigRep.mobile ? `\nMobile ${sigRep.mobile}` : ""}\nvehicleapprovalcentre.com · ${from.email}\nUnit 3B - 110 Chain Lake Drive, Halifax, NS B3S 1A9`;
      const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1f2337">${esc(text).replace(/\n/g, "<br>")}</div>${sigHtml}`;
      const files: any[] = (req as any).files || [];
      const attachments = files.map((f: any) => ({ filename: f.originalname || "attachment", mimeType: f.mimetype || "application/octet-stream", data: f.buffer as Buffer }));
      let sent: { id: string; threadId: string };
      const sendOpts = { from: from.email, fromName: from.name, to, subject: subj, html, text: text + sigText, attachments };
      try {
        sent = await gmailSendAs({ ...sendOpts, threadId: prev?.threadId, inReplyTo: prev?.lastMessageIdHeader, references: prev?.lastMessageIdHeader });
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (prev?.threadId && /not found/i.test(msg)) {
          // Stale/foreign thread id — send as a new thread instead of failing.
          try { sent = await gmailSendAs(sendOpts); }
          catch (e2: any) { console.error("[SEND-EMAIL] gmail error (retry):", e2?.message || e2); return res.status(502).json({ error: `Gmail rejected the send: ${String(e2?.message || e2).slice(0, 200)}` }); }
        } else {
          console.error("[SEND-EMAIL] gmail error:", msg);
          return res.status(502).json({ error: `Gmail rejected the send: ${msg.slice(0, 200)}` });
        }
      }
      const now = new Date().toISOString();
      const attNote = attachments.length ? `\n📎 ${attachments.map((a) => a.filename).join(", ")}` : "";
      // Capture Gmail attachment ids for our own sent message so the thread can open them later.
      let sentAtts: { id: string; filename: string; mimeType: string; size: number }[] = [];
      if (attachments.length) {
        try {
          const gm = await gmailAs(from.email);
          const full = await gm.users.messages.get({ userId: "me", id: sent.id, format: "full" });
          const walk2 = (part: any) => { if (!part) return; if (part.filename && part.body?.attachmentId) sentAtts.push({ id: part.body.attachmentId, filename: part.filename, mimeType: part.mimeType || "application/octet-stream", size: Number(part.body.size || 0) }); for (const c of part.parts || []) walk2(c); };
          walk2(full.data.payload);
        } catch (e: any) { console.error("[SEND-EMAIL] attachment lookup failed (non-fatal):", e?.message || e); }
      }
      const entry: any = { text: `📧 Email sent — ${subj}\n${text.slice(0, 1500)}${attNote}`, by: from.name, byUid: ctx.uid, at: now, kind: "email", direction: "outbound", from: from.email, to, subject: subj, gmailId: sent.id, gmailThreadId: sent.threadId, mailbox: from.email, attachments: sentAtts.length ? sentAtts : attachments.map((a) => ({ id: "", filename: a.filename, mimeType: a.mimeType, size: a.data.length })) };
      if (from.repId) entry.byRepId = from.repId;
      await leadRef.update({
        activityLog: ctx.admin.firestore.FieldValue.arrayUnion(entry),
        emailThread: { threadId: sent.threadId, repEmail: from.email, lastAt: now, subject: prev?.subject || subj },
        lastAttemptAt: now, updatedAt: now,
      });
      res.json({ success: true, entry });
    } catch (err: any) {
      console.error("[SEND-EMAIL] error:", err?.message || err);
      res.status(500).json({ error: `Failed to send email${err?.message ? ` — ${String(err.message).slice(0, 160)}` : "."}` });
    }
  });

  // Fetch an email attachment (inbound or sent) so the thread can open/preview it.
  app.get("/api/crm/email-attachment", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const mailbox = String(req.query.mailbox || "").toLowerCase();
      const messageId = String(req.query.messageId || ""); const attachmentId = String(req.query.attachmentId || "");
      const filename = String(req.query.filename || "attachment"); const mimeType = String(req.query.mimeType || "application/octet-stream");
      if (!mailbox.endsWith("@drivevac.ca") || !messageId || !attachmentId) return res.status(400).json({ error: "Bad request." });
      const gm = await gmailAs(mailbox);
      const a = await gm.users.messages.attachments.get({ userId: "me", messageId, id: attachmentId });
      const data = Buffer.from(String(a.data.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
      res.setHeader("Content-Type", mimeType);
      // Header values must be ASCII — macOS screenshots have a narrow no-break space in the name.
      const asciiName = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\\r\n]/g, "_").trim() || "attachment";
      const disp = /^image\//.test(mimeType) || mimeType === "application/pdf" ? "inline" : "attachment";
      res.setHeader("Content-Disposition", `${disp}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(data);
    } catch (err: any) {
      console.error("[EMAIL-ATTACHMENT] error:", err?.message || err);
      res.status(500).json({ error: "Couldn't fetch attachment." });
    }
  });

  // On-open refresh: when a rep opens a lead that has an email thread, pull any new
  // replies right now (instead of waiting for the 5-min sweep). Returns the new entries.
  app.post("/api/crm/email-refresh", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { leadId } = req.body || {};
      if (!leadId || typeof leadId !== "string") return res.status(400).json({ error: "Missing lead id." });
      const d = await ctx.db.collection("crmLeads").doc(leadId).get();
      if (!d.exists) return res.status(404).json({ error: "Lead not found." });
      if (!d.get("emailThread")?.threadId) return res.json({ imported: 0, entries: [] });
      const r = await importLeadEmails(ctx.db, ctx.admin, d);
      res.json(r);
    } catch (err: any) {
      console.error("[EMAIL-REFRESH] error:", err?.message || err);
      res.status(500).json({ error: "Refresh failed." });
    }
  });

  // Diagnostics: can the server act as the signed-in user's mailbox? (admin only)
  app.get("/api/crm/email-check", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const as = String(req.query.as || ctx.email).toLowerCase();
      const gmail = await gmailAs(as);
      const prof = await gmail.users.getProfile({ userId: "me" });
      res.json({ ok: true, as, emailAddress: prof.data.emailAddress, messagesTotal: prof.data.messagesTotal });
    } catch (e: any) {
      res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 400) });
    }
  });

  // ---- Email templates (shared, editable by all staff) -----------------------
  // {{firstName}} {{lastName}} {{repName}} {{repPhone}} {{lookingFor}} {{budget}} get filled in on the client.
  app.get("/api/crm/email-templates", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const snap = await ctx.db.collection("crmEmailTemplates").orderBy("name").get();
      res.json({ templates: snap.docs.map((d: any) => ({ id: d.id, ...(d.data() || {}) })) });
    } catch (err: any) { res.status(500).json({ error: "Failed to load templates." }); }
  });
  app.post("/api/crm/email-templates", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { id, name, subject, body, remove } = req.body || {};
      const col = ctx.db.collection("crmEmailTemplates");
      if (remove && id) { await col.doc(String(id)).delete(); return res.json({ success: true }); }
      const nm = String(name || "").trim().slice(0, 80), sj = String(subject || "").trim().slice(0, 200), bd = String(body || "").trim().slice(0, 20000);
      if (!nm || !sj || !bd) return res.status(400).json({ error: "Name, subject and body are all required." });
      const now = new Date().toISOString();
      const ref = id ? col.doc(String(id)) : col.doc();
      const exists = id ? (await ref.get()).exists : false;
      await ref.set({ name: nm, subject: sj, body: bd, updatedAt: now, updatedBy: ctx.name || ctx.email, ...(exists ? {} : { createdAt: now, createdBy: ctx.name || ctx.email }) }, { merge: true });
      res.json({ success: true, id: ref.id });
    } catch (err: any) { res.status(500).json({ error: "Failed to save template." }); }
  });

  // Free-to-Call pool: a rep claims a released lead → becomes owner, lead drops into
  // Attempting Contact with a FRESH 3-business-day clock. The rep who lost it can't reclaim it.
  // ---- Nurture (managers only): sleeping Lost leads with a wake-up date ----
  const requireManager = async (req: express.Request) => {
    const ctx = await requireStaff(req);
    if ("error" in ctx) return ctx;
    if (!["super_admin", "general_manager", "finance_manager"].includes(ctx.role || "") && ctx.email !== "j.jackson@drivevac.ca") return { error: 403 as const, message: "Managers only." };
    return ctx;
  };
  app.get("/api/crm/nurture", async (req, res) => {
    try {
      const ctx = await requireManager(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const snap = await ctx.db.collection("crmLeads").where("stage", "==", "lost").get();
      const rows = snap.docs.map((d: any) => { const l = d.data() || {}; return {
        id: d.id, name: [l.firstName, l.lastName].filter(Boolean).join(" ") || l.title || "—", phone: l.phone || null, email: l.email || null,
        lookingFor: l.lookingFor || null, budget: l.budget || null, city: l.city || null, province: l.province || null,
        lostReason: l.lostReason || null, lostNote: l.lostNote || null, lostAt: l.lostAt || l.updatedAt || null, lostByName: l.lostByName || l.ownerName || null,
        nurtureAt: l.nurtureAt || null, nurtureStatus: l.nurtureStatus || (l.nurtureAt ? "sleeping" : "dead"),
      }; }).sort((a: any, b: any) => String(a.nurtureAt || "9999").localeCompare(String(b.nurtureAt || "9999")));
      res.json({ rows });
    } catch (err: any) { res.status(500).json({ error: "Failed to load nurture list." }); }
  });
  app.post("/api/crm/nurture", async (req, res) => {
    try {
      const ctx = await requireManager(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { leadId, nurtureAt, wakeNow } = req.body || {};
      if (!leadId || typeof leadId !== "string") return res.status(400).json({ error: "Missing lead id." });
      const ref = ctx.db.collection("crmLeads").doc(leadId);
      const now = new Date().toISOString();
      if (wakeNow) {
        // Move it to the Free-to-Call pool right now (same as the tick would), so managers see it instantly.
        const d = await ref.get();
        if (!d.exists) return res.status(404).json({ error: "Lead not found." });
        const reason = d.get("lostReason") || "Lost"; const lostAt = d.get("lostAt") || d.get("updatedAt");
        const ago = lostAt ? Math.round((Date.now() - Date.parse(lostAt)) / 86_400_000) : null;
        const agoTxt = ago == null ? "" : ago >= 60 ? ` ${Math.round(ago / 30)} months ago` : ago === 0 ? " today" : ago === 1 ? " 1 day ago" : ` ${ago} days ago`;
        const wasWith = d.get("lostByName") || d.get("lostBy") || "";
        await ref.update({
          stage: "free_to_call", owner: null, ownerName: null, assignedAt: null, updatedAt: now,
          nurtureStatus: "woken", wokenAt: now, releasedAt: now, releasedFrom: null,
          releasedFromName: wasWith ? `${wasWith} (lost: ${reason})` : null,
          poolNote: `⏰ Woken by ${ctx.name || ctx.email} — was Lost (${reason})${agoTxt}${wasWith ? `, by ${wasWith}` : ""}.${d.get("lostNote") ? ` “${String(d.get("lostNote")).slice(0, 160)}”` : ""} Worth another try.`,
          stageHistory: ctx.admin.firestore.FieldValue.arrayUnion({ from: "lost", to: "free_to_call", by: ctx.email, byUid: ctx.uid, at: now }),
          activityLog: ctx.admin.firestore.FieldValue.arrayUnion({ text: `⏰ Woken from Nurture by ${ctx.name || ctx.email} — was Lost (${reason})${agoTxt}. Back in the Free-to-Call pool.`, by: ctx.name || ctx.email, byUid: ctx.uid, at: now, kind: "note" }),
        });
        return res.json({ success: true, movedNow: true });
      }
      const nAt = nurtureAt ? new Date(String(nurtureAt)) : null;
      await ref.update({ nurtureAt: nAt && !isNaN(nAt.getTime()) ? nAt.toISOString() : null, nurtureStatus: nAt && !isNaN(nAt.getTime()) ? "sleeping" : "dead", updatedAt: now });
      res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: "Failed to update nurture." }); }
  });

  // Delete a lead outright (admins only) — for junk/test/duplicate entries. Real "not now"
  // leads should be marked Lost (→ Nurture) instead, so this is deliberately admin-gated.
  app.post("/api/crm/lead-delete", async (req, res) => {
    try {
      const ctx = await requireAdmin(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { leadId } = req.body || {};
      if (!leadId || typeof leadId !== "string") return res.status(400).json({ error: "Missing lead id." });
      const ref = ctx.db.collection("crmLeads").doc(leadId);
      const d = await ref.get();
      if (!d.exists) return res.status(404).json({ error: "Lead not found." });
      // Keep a tombstone so a deletion is auditable (who/when/what), then remove the live doc.
      const data = d.data() || {};
      await ctx.db.collection("crmLeadsDeleted").doc(leadId).set({ ...data, deletedAt: new Date().toISOString(), deletedBy: ctx.email });
      await ref.delete();
      res.json({ success: true });
    } catch (err: any) {
      console.error("[LEAD-DELETE] error:", err?.message || err);
      res.status(500).json({ error: "Failed to delete lead." });
    }
  });

  // ---- Trade-in appraisal link for a lead --------------------------------------
  // Generates a unique, unguessable link (/appraisal?lead=<token>) tied to the lead so
  // the customer never has to find/type an App ID; optionally texts it to them.
  app.post("/api/crm/trade-link", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { leadId, send } = req.body || {};
      if (!leadId || typeof leadId !== "string") return res.status(400).json({ error: "Missing lead id." });
      const ref = ctx.db.collection("crmLeads").doc(leadId);
      const d = await ref.get();
      if (!d.exists) return res.status(404).json({ error: "Lead not found." });
      let tok = d.get("tradeToken");
      if (!tok) { tok = crypto.randomBytes(18).toString("base64url"); await ref.update({ tradeToken: tok, tradeTokenAt: new Date().toISOString() }); }
      const link = `https://vehicleapprovalcentre.com/appraisal?lead=${tok}`;
      let sent = false;
      if (send === "sms") {
        const to = String(d.get("phone") || "").replace(/\D+/g, "");
        const apiKey = process.env.QUO_API_KEY;
        if (to.length < 10) return res.status(400).json({ error: "This lead has no valid phone number." });
        if (!apiKey) return res.status(503).json({ error: "Texting isn't configured." });
        // From the OWNING rep's line (same as the CRM text button).
        let fromNumber = process.env.QUO_FROM_NUMBER || ""; let byName = ctx.name || ctx.email; let byRepId: string | undefined;
        const ownerId = String(d.get("owner") || "");
        if (ownerId) { try { const rep = await ctx.db.collection("crmReps").doc(ownerId).get(); if (rep.exists) { byRepId = rep.id; byName = rep.get("name") || byName; if (rep.get("quoNumber")) fromNumber = rep.get("quoNumber"); } } catch {} }
        const e164 = (n: string) => { const x = String(n).replace(/\D+/g, ""); return x.length === 10 ? `+1${x}` : `+${x}`; };
        const first = d.get("firstName") || "there";
        const msg = `Hi ${first}, it's ${byName} at Vehicle Approval Centre. Here's your trade-in link — a few photos and details of your vehicle and we'll get you a value: ${link}`;
        const r = await fetchWithTimeout("https://api.openphone.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", Authorization: apiKey }, body: JSON.stringify({ from: e164(fromNumber), to: [e164(to)], content: msg }) });
        const jd: any = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: (jd && (jd.message || jd.error)) || "Quo rejected the message." });
        const now = new Date().toISOString();
        const entry: any = { text: `💬 Text sent: ${msg}`, by: byName, byUid: ctx.uid, at: now, kind: "text", direction: "outbound", from: e164(fromNumber), to: e164(to), externalId: String(jd?.data?.id || jd?.id || ""), tradeLink: true };
        if (byRepId) entry.byRepId = byRepId;
        await ref.update({ activityLog: ctx.admin.firestore.FieldValue.arrayUnion(entry), lastAttemptAt: now, updatedAt: now, tradeLinkSentAt: now });
        sent = true;
      }
      res.json({ success: true, link, sent });
    } catch (err: any) {
      console.error("[TRADE-LINK] error:", err?.message || err);
      res.status(500).json({ error: "Failed to create trade-in link." });
    }
  });

  // ================= Pipedrive bulk import =================================
  // Resumable: each call does `pages` pages and returns the next `start`, so a long
  // import is driven as a loop of short requests (no Cloud Run timeouts).
  //  • Leads carry the CRM_FIELDS custom-field hashes INLINE → one page = 500 full records.
  //  • Dedupe/merge is automatic: doc id = pd_<last-10-phone-digits>, so the same person's
  //    repeat applications land on ONE lead, each application appended to the thread.
  //  • Everything imports UNASSIGNED into the Free-to-Call pool. Ownership for
  //    genuinely-live work is applied separately by the "deals" phase (Aug 1 onward).
  const IMPORT_OWNERSHIP_FROM = "2026-08-01T00:00:00Z";
  const PD_DNC_STAGES = new Set([48, 50]);   // Opt Out, Wrong Number → never claimable

  const pdFetch = async (path: string) => {
    const token = process.env.PIPEDRIVE_API_TOKEN;
    if (!token) throw new Error("PIPEDRIVE_API_TOKEN is not configured.");
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetchWithTimeout(`https://api.pipedrive.com/v1${path}${sep}api_token=${token}`, {}, 30000);
    const j: any = await r.json().catch(() => ({}));
    if (!j?.success) throw new Error(`Pipedrive ${path}: ${j?.error || r.status}`);
    return j;
  };

  const phoneKeyOfRaw = (p: any) => String(p ?? "").replace(/\D+/g, "").slice(-10);
  const tokensFor = (rec: any) => {
    const bits = [rec.firstName, rec.lastName, rec.city, rec.province, String(rec.email || "").split("@")[0]]
      .filter(Boolean).join(" ").toLowerCase();
    return Array.from(new Set(bits.split(/[^a-z0-9]+/).filter((t) => t.length > 1).map((t) => t.slice(0, 24)))).slice(0, 25);
  };

  app.post("/api/crm/pipedrive-import", async (req, res) => {
    try {
      // Admin session OR the ops secret (so a long import can be driven from a script).
      const secret = process.env.CRM_TICK_SECRET || "";
      const viaSecret = secret && String(req.get("x-tick-secret") || "") === secret;
      if (!viaSecret) {
        const ctx = await requireAdmin(req);
        if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      }
      const phase = String(req.body?.phase || "leads");
      const pages = Math.min(20, Math.max(1, Number(req.body?.pages) || 4));
      const perPage = 500;
      let start = Number(req.body?.start) || 0;
      const dryRun = req.body?.dryRun === true;
      const { admin, db } = await getFirestoreAdmin();
      const nowIso = new Date().toISOString();

      if (phase === "fields") {
        // Read Pipedrive's own field definitions so mapping is exact, never guessed.
        const which = String(req.body?.entity || "person");
        const j = await pdFetch(`/${which}Fields?limit=500`);
        const out = (j.data || []).filter((f: any) => f.key && f.key.length === 40)
          .map((f: any) => ({ key: f.key, name: f.name, type: f.field_type,
            options: Array.isArray(f.options) ? f.options.slice(0, 12).map((o: any) => `${o.id}=${o.label}`) : undefined }));
        return res.json({ ok: true, entity: which, count: out.length, fields: out });
      }

      // Person-record field map — from Pipedrive's own personFields definitions (verified 2026-08-19).
      const PERSON_FIELDS: Record<string, string> = {
        "f564e37049699ba76316ff6f3ee8e617c7a7fdd6": "applicationId",
        "57de6657cbb5438bf5415c81185ed9c1d8121c95": "hasTradeIn",
        "077932485b6411341a64b965700279af5d30d51f": "budget",
        "3b7734030f22415928524281d15cf5f8ce6f0923": "lookingFor",
        "4757bf6f166ed3386cd5438f677eca7b83c366eb": "leadSource",
        "9a797bbab5a4a042444df34add8177fc381631eb": "origin",
        "5a6e06b823c5589dc1b77ce42d5048d7e7abbd86": "originalOwnerName",
        "d98856443db5ad796f3db30f3fc3fcfaa20379ef": "middleName",
        "c30d4c12db82927b1ccbca8f31568d83fdaa6730": "maritalStatus",
        "f2b439c28e961c4005e910571424bda14f1761e6": "dob",
        "d98af281770daaefbf449b0f4bdb33458817ca47": "dob",
        "841328cfd4062dbd906972658c6015930835b3af": "street",
        "8779f4faa82a05e3a919a4259dcf96e0eba2d3c1": "street2",
        "49f3ebc9df6d2fab9244d226164e2d63e25b4f41": "suite",
        "f29344a1f399d9022bda870b1b9c5f2b758b9b92": "city",
        "70eefeb850270bd6d80eaff0811c292140985d90": "province",
        "c6cddb628024194faa1c09dae95fcdb2382a2296": "postal",
        "09402d8f246f889cfa55ea0cfc399afbaee59575": "rentOrOwn",
        "257a734dffa392edf80c11d8b18eb3471c9fe309": "timeAtAddress",
        "ab55116b32183c1489740b42318780acff0738fd": "monthlyPayment",
        "b1d7f85d70cf747c30996db9a851bf71173bb4b5": "employer",
        "a17ab1ddd560ec0404d223684c029ed42cec9246": "jobTitle",
        "d3eb13a75eee18315c55a09a8b8fbaab64c40d6e": "employmentStatus",
        "ab4fa09ab649c8684be5cb23da85ad429ea58d29": "employmentYears",
        "8d2c21ebdaa2481cb76189b9ad35715d5be069c4": "employmentMonths",
        "86ee0c72853df9212222bb47b8f26b9597576d68": "monthlyIncome",
        "c58ce27ae7d66d9c62c54bc0db508809d0651b32": "otherIncome",
        "2762ff86001af9fb9dc29bd79ee16aeb1f5317e7": "campaign",
        "71b27db3baa67c17e8342999bdc0a91eae1f5733": "appStatus",
      };
      const SKIP_PERSON_KEYS = new Set(["7978ffd789b532fde20a7464620c7fec010bb7b3"]);   // SIN — never import

      if (phase === "persons-peek") {
        // Diagnostic: show the raw shape of one person from the LIST endpoint (differs from single-get).
        const j = await pdFetch(`/persons?limit=2`);
        const first = (j.data || [])[0] || {};
        const shape: any = {};
        for (const [k, v] of Object.entries(first)) shape[k] = Array.isArray(v) ? `array(${v.length})` : (v && typeof v === "object" ? `object(${Object.keys(v as any).slice(0, 6).join(",")})` : typeof v === "string" ? (v as string).slice(0, 40) : v);
        return res.json({ ok: true, keys: Object.keys(first), shape, pagination: j.additional_data, rawFirst: first });
      }

      if (phase === "wipe-imported") {
        // Remove ONLY pipedrive-import docs (re-import after a mapping fix). Never touches real leads.
        if (!req.body?.confirm) return res.status(400).json({ error: "Pass confirm:true." });
        let removed = 0;
        while (true) {
          const snap = await db.collection("crmLeads").where("source", "==", "pipedrive-import").limit(400).get();
          if (snap.empty) break;
          const b = db.batch(); snap.docs.forEach((d: any) => b.delete(d.ref)); await b.commit(); removed += snap.size;
          if (removed > 200000) break;
        }
        return res.json({ ok: true, removed });
      }

      if (phase === "wipe-stubs") {
        // Safety net: delete any lead with no name, no phone and no email (can never be worked).
        if (!req.body?.confirm) return res.status(400).json({ error: "Pass confirm:true." });
        let removed = 0;
        const snap = await db.collection("crmLeads").get();
        let b = db.batch(); let ops = 0;
        for (const d of snap.docs) {
          const x = d.data() || {};
          if (!x.firstName && !x.lastName && !x.title && !x.phone && !x.email) { b.delete(d.ref); ops++; removed++; if (ops >= 400) { await b.commit(); b = db.batch(); ops = 0; } }
        }
        if (ops) await b.commit();
        return res.json({ ok: true, removed });
      }

      if (phase === "reconcile-inbox") {
        // Dual-write docs used to be keyed by Pipedrive lead id (uuid), so a recent
        // applicant could exist twice (uuid Inbox doc + pd_<phone> archive doc) and the
        // round-robin owner Pipedrive gave the lead never reached the CRM. For every
        // unassigned new_lead NOT keyed pd_/pp_: look up the Pipedrive lead, merge the
        // doc into the phone-keyed record (fresh data wins), adopt the owner when it
        // maps to a rep, and delete the duplicate. Dry run unless confirm:true.
        const dry = !req.body?.confirm;
        const repsSnap = await db.collection("crmReps").get();
        const byPdUser = new Map<string, { id: string; name: string }>();
        repsSnap.docs.forEach((d: any) => { const pid = d.get("pipedriveOwnerId"); if (pid) byPdUser.set(String(pid), { id: d.id, name: d.get("name") || d.id }); });
        const NO_COPY = new Set(["stage", "owner", "ownerName", "assignedAt", "releasedAt", "releasedFrom", "releasedFromName", "dnc", "dncReason", "attemptingSince", "activityLog", "notes", "applications", "firstAppliedAt", "source", "stageHistory"]);
        const snap = await db.collection("crmLeads").where("stage", "==", "new_lead").get();
        const rows: any[] = []; let assigned = 0, merged = 0, deletedJunk = 0, keptInbox = 0;
        for (const d of snap.docs) {
          if (/^(pd_|pp_)/.test(d.id)) continue;          // already phone/person-keyed
          if (d.get("owner")) continue;                    // already being worked — hands off
          const x: any = d.data() || {};
          let pdLead: any = null;
          try { const j = await pdFetch(`/leads/${d.id}`); pdLead = j?.data || null; } catch { pdLead = null; }
          const rep = pdLead?.owner_id ? byPdUser.get(String(pdLead.owner_id)) : null;
          const row: any = { id: d.id, name: [x.firstName, x.lastName].filter(Boolean).join(" ").trim(), pdOwner: pdLead ? (pdLead.owner_id ?? null) : "LEAD GONE", rep: rep?.name || null, archived: !!pdLead?.is_archived };
          if (dry) { rows.push(row); continue; }
          if (pdLead?.is_archived) { await d.ref.delete(); deletedJunk++; row.action = "deleted (archived in Pipedrive)"; rows.push(row); continue; }
          const pk = phoneKeyOfRaw(x.phoneKey || x.phone);
          const targetRef = pk.length === 10 ? db.collection("crmLeads").doc(`pd_${pk}`) : null;
          const target = targetRef ? await targetRef.get() : null;
          if (targetRef && target?.exists) {
            // Merge the fresh application into the master record; fresh data wins over the archive.
            const upd: any = { updatedAt: nowIso, pipedriveLeadId: d.id, source: "apply-now" };
            for (const [k, v] of Object.entries(x)) { if (v !== null && v !== "" && !NO_COPY.has(k)) upd[k] = v; }
            const appAt = String(x.addTime || nowIso);
            upd.applications = admin.firestore.FieldValue.arrayUnion(appAt);
            upd.lastAppliedAt = appAt; upd.appliedMonth = appAt.slice(0, 7);
            if (!target.get("firstAppliedAt")) upd.firstAppliedAt = appAt;
            for (const key of ["notes", "activityLog"]) {
              if (Array.isArray(x[key]) && x[key].length) upd[key] = admin.firestore.FieldValue.arrayUnion(...x[key].slice(0, 400));
            }
            if (target.get("owner")) { row.action = `merged into ${targetRef.id} — kept ${target.get("ownerName")}'s board`; }
            else if (rep) { Object.assign(upd, { stage: "new_lead", owner: rep.id, ownerName: rep.name, assignedAt: nowIso, dnc: false, releasedAt: null, releasedFrom: null, releasedFromName: null }); assigned++; row.action = `merged into ${targetRef.id} + assigned ${rep.name}`; }
            else { Object.assign(upd, { stage: "new_lead", owner: null, ownerName: null, dnc: false, releasedAt: null, releasedFrom: null, releasedFromName: null }); keptInbox++; row.action = `merged into ${targetRef.id} — inbox`; }
            await targetRef.set(upd, { merge: true });
            await d.ref.delete(); merged++;
          } else if (targetRef) {
            // No archive record — rekey to pd_<phone> so future applications merge here.
            const data: any = { ...x, pipedriveLeadId: d.id, updatedAt: nowIso };
            if (rep) { Object.assign(data, { owner: rep.id, ownerName: rep.name, assignedAt: nowIso }); assigned++; row.action = `rekeyed to ${targetRef.id} + assigned ${rep.name}`; }
            else { keptInbox++; row.action = `rekeyed to ${targetRef.id} — inbox`; }
            await targetRef.set(data, { merge: true });
            await d.ref.delete(); merged++;
          } else {
            // No usable phone — leave the doc where it is, just adopt the owner if known.
            if (rep) { await d.ref.set({ owner: rep.id, ownerName: rep.name, assignedAt: nowIso, updatedAt: nowIso }, { merge: true }); assigned++; row.action = `assigned ${rep.name}`; }
            else { keptInbox++; row.action = "kept in inbox"; }
            rows.push(row); continue;
          }
          rows.push(row);
        }
        return res.json({ ok: true, dry, assigned, merged, deletedJunk, keptInbox, rows });
      }

      if (phase === "audit-deals") {
        // Read-only check: every OPEN sales-pipeline deal added since Aug 1 must exist in
        // the CRM on the right rep's board in the right stage. Returns mismatches only.
        // Pass fix:true to also apply the expected owner/stage to mismatched records.
        const fix = req.body?.fix === true;
        const STAGE_MAP: Record<number, string> = { 35: "attempting_contact", 40: "dealertrack", 36: "approved", 37: "approved", 38: "signed", 39: "signed" };
        const repsSnap = await db.collection("crmReps").get();
        const byPdUser = new Map<string, { id: string; name: string }>();
        repsSnap.docs.forEach((d: any) => { const pid = d.get("pipedriveOwnerId"); if (pid) byPdUser.set(String(pid), { id: d.id, name: d.get("name") || d.id }); });
        const ownershipFrom = IMPORT_OWNERSHIP_FROM.slice(0, 19).replace(" ", "T").replace("T", " ");
        const PHONE_HASH = "9902ecfb207e316c980c1264d302e7e48a86bf4a";
        let checked = 0, matched = 0, fixed = 0, hasMore = true;
        const mismatches: any[] = []; const unmappedOwners: any[] = [];
        for (let p = 0; p < pages && hasMore; p++) {
          const j = await pdFetch(`/deals?limit=${perPage}&start=${start}&status=all_not_deleted`);
          const items: any[] = j.data || [];
          for (const D of items) {
            if (D.status !== "open" || Number(D.pipeline_id) !== 5) continue;
            if (String(D.add_time || "") < ownershipFrom) continue;
            checked++;
            const ownerRaw: any = D.user_id ?? D.owner_id;
            const ownerId = typeof ownerRaw === "object" ? ownerRaw?.id ?? ownerRaw?.value : ownerRaw;
            const rep = byPdUser.get(String(ownerId));
            const expectStage = STAGE_MAP[Number(D.stage_id)] || "attempting_contact";
            if (!rep) { unmappedOwners.push({ deal: D.id, title: D.title, pdOwner: ownerId }); continue; }
            // Find the CRM record: by deal id first, then by phone key, then by person id.
            let doc: any = null;
            const byDeal = await db.collection("crmLeads").where("pipedriveDealId", "==", String(D.id)).limit(1).get();
            if (!byDeal.empty) doc = byDeal.docs[0];
            if (!doc) {
              const pk = phoneKeyOfRaw(D[PHONE_HASH]);
              if (pk.length === 10) { const s = await db.collection("crmLeads").doc(`pd_${pk}`).get(); if (s.exists) doc = s; }
            }
            if (!doc) {
              const pid = typeof D.person_id === "object" ? D.person_id?.value : D.person_id;
              if (pid) { const s = await db.collection("crmLeads").where("pipedrivePersonId", "==", String(pid)).limit(1).get(); if (!s.empty) doc = s.docs[0]; }
            }
            const found = doc ? { id: doc.id, stage: doc.get("stage") || null, owner: doc.get("owner") || null, ownerName: doc.get("ownerName") || null } : null;
            const ok = !!found && found.owner === rep.id && found.stage === expectStage;
            if (ok) { matched++; continue; }
            const row: any = { deal: D.id, title: D.title, pdStage: D.stage_id, expected: { rep: rep.name, stage: expectStage }, found: found ? { doc: found.id, rep: found.ownerName, stage: found.stage } : "NO CRM RECORD" };
            if (fix && found) {
              await db.collection("crmLeads").doc(found.id).set({
                stage: expectStage, owner: rep.id, ownerName: rep.name,
                assignedAt: nowIso, updatedAt: nowIso, pipedriveDealId: String(D.id),
                releasedAt: null, releasedFrom: null, releasedFromName: null,
                attemptingSince: expectStage === "attempting_contact" ? nowIso : null,
              }, { merge: true });
              row.action = "fixed"; fixed++;
            } else if (fix && !found) {
              // Deal exists only in Pipedrive (created after the import) — build the CRM
              // record from the deal's own application fields. Phone-keyed only; no stubs.
              const rec: any = {};
              for (const [hash, name] of Object.entries(CRM_FIELDS)) {
                const v = (D as any)[hash];
                if (v === undefined || v === null || v === "") continue;
                const enums = CRM_ENUMS[hash];
                rec[name] = enums && typeof v === "number" ? (enums[v] || String(v)) : (typeof v === "object" ? (v.value ?? null) : v);
              }
              if (!rec.firstName && !rec.lastName && D.title) {
                const parts = String(D.title).trim().split(/\s+/);
                rec.firstName = parts[0]; rec.lastName = parts.slice(1).join(" ") || null;
              }
              const pk2 = phoneKeyOfRaw(rec.phone);
              if (pk2.length === 10) {
                const at = String(D.add_time || nowIso).replace(" ", "T");
                const appliedZ = at.endsWith("Z") ? at : `${at}Z`;
                const pid = typeof D.person_id === "object" ? D.person_id?.value : D.person_id;
                await db.collection("crmLeads").doc(`pd_${pk2}`).set({
                  ...rec, phoneKey: pk2,
                  title: [rec.firstName, rec.lastName].filter(Boolean).join(" ") || D.title || null,
                  pipedriveDealId: String(D.id), pipedrivePersonId: pid ? String(pid) : null,
                  stage: expectStage, owner: rep.id, ownerName: rep.name, assignedAt: nowIso,
                  attemptingSince: expectStage === "attempting_contact" ? nowIso : null,
                  addTime: appliedZ, firstAppliedAt: appliedZ, lastAppliedAt: appliedZ,
                  appliedMonth: appliedZ.slice(0, 7),
                  applications: admin.firestore.FieldValue.arrayUnion(appliedZ),
                  searchTokens: tokensFor(rec), source: "pipedrive-import", importedAt: nowIso, updatedAt: nowIso,
                  activityLog: admin.firestore.FieldValue.arrayUnion({ text: `📥 Imported from Pipedrive as an open deal — ${rep.name}.`, by: "Pipedrive import", at: nowIso, kind: "note", pipedriveDealId: String(D.id) }),
                }, { merge: true });
                row.action = "created"; fixed++;
              } else { row.action = "cannot create — deal has no phone"; }
            }
            mismatches.push(row);
          }
          hasMore = items.length >= perPage && (j.additional_data?.pagination?.more_items_in_collection ?? items.length >= perPage);
          start += items.length;
          if (!items.length) hasMore = false;
        }
        return res.json({ ok: true, fix, checked, matched, fixed, mismatches, unmappedOwners, nextStart: hasMore ? start : null, done: !hasMore });
      }

      if (phase === "audit-leads") {
        // Pipedrive LEADS (not yet deals) dispersed to reps by the round-robin never pass
        // through the CRM Inbox if they predate the dual-write. Walk non-archived leads
        // created since Aug 1 owned by a mapped rep and put them on that rep's board as
        // new_lead. Never touches a record that already has an owner (deals win), skips
        // leads Pipedrive labels as free-to-call/not-interested. fix:true to apply.
        const fix = req.body?.fix === true;
        const repsSnap = await db.collection("crmReps").get();
        const byPdUser = new Map<string, { id: string; name: string }>();
        repsSnap.docs.forEach((d: any) => { const pid = d.get("pipedriveOwnerId"); if (pid) byPdUser.set(String(pid), { id: d.id, name: d.get("name") || d.id }); });
        let checked = 0, matched = 0, fixed = 0, skippedPool = 0, hasMore = true;
        const rows: any[] = [];
        const labelName = new Map<string, string>();
        try { const lj = await pdFetch(`/leadLabels`); (lj.data || []).forEach((x: any) => labelName.set(String(x.id), String(x.name || ""))); } catch { /* labels optional */ }
        for (let p = 0; p < pages && hasMore; p++) {
          const j = await pdFetch(`/leads?limit=${perPage}&start=${start}&archived_status=not_archived`);
          const items: any[] = j.data || [];
          for (const L of items) {
            if (String(L.add_time || "") < IMPORT_OWNERSHIP_FROM.slice(0, 10)) continue;
            const rep = byPdUser.get(String(L.owner_id));
            if (!rep) continue;
            const lNames = (Array.isArray(L.label_ids) ? L.label_ids : []).map((id: any) => labelName.get(String(id)) || "").join(", ");
            if (/free\s*to\s*call|not\s*interested/i.test(lNames)) { skippedPool++; continue; } // Pipedrive says pool — leave it there
            checked++;
            // Map fields the same way the leads import does (hashes are inline on v1 leads).
            const rec: any = {};
            for (const [hash, name] of Object.entries(CRM_FIELDS)) {
              const v = (L as any)[hash];
              if (v === undefined || v === null || v === "") continue;
              const enums = CRM_ENUMS[hash];
              rec[name] = enums && typeof v === "number" ? (enums[v] || String(v)) : (typeof v === "object" ? (v.value ?? null) : v);
            }
            if (!rec.firstName && !rec.lastName && L.title) {
              const parts = String(L.title).trim().split(/\s+/);
              rec.firstName = parts[0]; rec.lastName = parts.slice(1).join(" ") || null;
            }
            const pk = phoneKeyOfRaw(rec.phone);
            // Find the CRM record: lead id doc (legacy dual-write), pd_<phone>, then person id.
            let doc: any = null;
            const byLead = await db.collection("crmLeads").where("pipedriveLeadId", "==", String(L.id)).limit(1).get();
            if (!byLead.empty) doc = byLead.docs[0];
            if (!doc && pk.length === 10) { const s = await db.collection("crmLeads").doc(`pd_${pk}`).get(); if (s.exists) doc = s; }
            if (!doc && L.person_id) { const s = await db.collection("crmLeads").where("pipedrivePersonId", "==", String(L.person_id)).limit(1).get(); if (!s.empty) doc = s.docs[0]; }
            if (doc && doc.get("owner")) { matched++; continue; }   // already on a board — deals/manual state wins
            const row: any = { lead: L.id, title: L.title, rep: rep.name, found: doc ? doc.id : "NO CRM RECORD" };
            if (!fix) { rows.push(row); continue; }
            if (doc) {
              await db.collection("crmLeads").doc(doc.id).set({
                stage: "new_lead", owner: rep.id, ownerName: rep.name, assignedAt: nowIso,
                pipedriveLeadId: String(L.id), updatedAt: nowIso,
                releasedAt: null, releasedFrom: null, releasedFromName: null,
              }, { merge: true });
              row.action = "assigned"; fixed++;
            } else if (pk.length === 10) {
              const at = String(L.add_time || nowIso).replace(" ", "T");
              const appliedZ = at.endsWith("Z") ? at : `${at}Z`;
              await db.collection("crmLeads").doc(`pd_${pk}`).set({
                ...rec, phoneKey: pk,
                title: [rec.firstName, rec.lastName].filter(Boolean).join(" ") || L.title || null,
                pipedriveLeadId: String(L.id), pipedrivePersonId: L.person_id ? String(L.person_id) : null,
                stage: "new_lead", owner: rep.id, ownerName: rep.name, assignedAt: nowIso,
                addTime: appliedZ, firstAppliedAt: appliedZ, lastAppliedAt: appliedZ,
                appliedMonth: appliedZ.slice(0, 7),
                applications: admin.firestore.FieldValue.arrayUnion(appliedZ),
                searchTokens: tokensFor(rec), source: "pipedrive-import", importedAt: nowIso, updatedAt: nowIso,
                activityLog: admin.firestore.FieldValue.arrayUnion({ text: `📥 Imported from Pipedrive as ${rep.name}'s lead.`, by: "Pipedrive import", at: nowIso, kind: "note", pipedriveLeadId: String(L.id) }),
              }, { merge: true });
              row.action = "created"; fixed++;
            } else { row.action = "cannot create — no phone"; }
            rows.push(row);
          }
          hasMore = items.length >= perPage;
          start += items.length;
          if (!items.length) hasMore = false;
        }
        return res.json({ ok: true, fix, checked, matched, fixed, skippedPool, rows, nextStart: hasMore ? start : null, done: !hasMore });
      }

      if (phase === "deals-peek") {
        // Diagnostic: the newest few deals — why aren't they mapping to owners?
        const st = Number(req.body?.start) || 24000;
        const j = await pdFetch(`/deals?limit=${Number(req.body?.n) || 6}&start=${st}&status=all_not_deleted`);
        const repsSnap = await db.collection("crmReps").get();
        const byPdUser = new Map<string, string>(); repsSnap.docs.forEach((d: any) => { const pid = d.get("pipedriveOwnerId"); if (pid) byPdUser.set(String(pid), d.get("name")); });
        const rows = (j.data || []).map((D: any) => ({ id: D.id, title: D.title, status: D.status, pipeline_id: D.pipeline_id, stage_id: D.stage_id, user_id: D.user_id, owner_id: D.owner_id, creator_user_id: D.creator_user_id, owner_name: D.owner_name, add_time: D.add_time, person_id: typeof D.person_id === "object" ? D.person_id?.value : D.person_id, keys: Object.keys(D).filter((k) => k.length !== 40) }));
        return res.json({ ok: true, from: IMPORT_OWNERSHIP_FROM, knownPdUsers: Array.from(byPdUser.keys()).slice(0, 20), rows });
      }

      if (phase === "sample") {
        // Diagnostic: how many imported docs, and a few samples as the pool will see them.
        const agg = await db.collection("crmLeads").where("source", "==", "pipedrive-import").count().get();
        const snap = await db.collection("crmLeads").where("source", "==", "pipedrive-import").limit(Number(req.body?.n) || 5).get();
        const pick = ["firstName","lastName","phone","email","city","province","lookingFor","budget","employmentStatus","monthlyIncome","dob","stage","owner","addTime","dnc"];
        const samples = snap.docs.map((d: any) => { const o: any = { id: d.id }; for (const k of pick) o[k] = d.get(k) ?? null; return o; });
        const poolAgg = await db.collection("crmLeads").where("stage", "==", "free_to_call").count().get();
        return res.json({ ok: true, imported: agg.data().count, inPool: poolAgg.data().count, samples });
      }

      if (phase === "persons") {
        let imported = 0, merged = 0, skipped = 0, dnc = 0, more = true;
        for (let p = 0; p < pages && more; p++) {
          const j = await pdFetch(`/persons?limit=${perPage}&start=${start}`);
          const items: any[] = j.data || [];
          more = !!j?.additional_data?.pagination?.more_items_in_collection;
          start = j?.additional_data?.pagination?.next_start ?? start + items.length;
          if (!items.length) { more = false; break; }

          let batch = db.batch(); let ops = 0;
          for (const P of items) {
            if (P.is_deleted) { skipped++; continue; }
            const rec: any = {};
            const cf = P.custom_fields && typeof P.custom_fields === "object" ? P.custom_fields : P;   // list endpoint = top-level hashes
            for (const [hash, name] of Object.entries(PERSON_FIELDS)) {
              if (SKIP_PERSON_KEYS.has(hash)) continue;
              const v = cf[hash];
              if (v === undefined || v === null || v === "") continue;
              if (rec[name] != null && rec[name] !== "") continue;     // first non-empty wins (two DOB fields)
              rec[name] = typeof v === "object" ? (v.value ?? null) : v;
            }
            const titleCase = (x: any) => x == null ? x : String(x).trim().toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m) => m.toUpperCase());
            rec.firstName = titleCase(P.first_name || (P.name ? String(P.name).split(/\s+/)[0] : null));
            rec.lastName = titleCase(P.last_name || (P.name ? String(P.name).split(/\s+/).slice(1).join(" ") : null) || null);
            // Province → 2-letter code so the pool filter works across old ("Nova Scotia") and new ("NS") records.
            const PROV: Record<string, string> = { "nova scotia": "NS", "new brunswick": "NB", "newfoundland and labrador": "NL", "newfoundland": "NL", "prince edward island": "PE", "pei": "PE", "quebec": "QC", "québec": "QC", "ontario": "ON", "manitoba": "MB", "saskatchewan": "SK", "alberta": "AB", "british columbia": "BC", "yukon": "YT", "northwest territories": "NT", "nunavut": "NU" };
            if (rec.province) { const k = String(rec.province).trim().toLowerCase(); rec.province = PROV[k] || (String(rec.province).trim().length === 2 ? String(rec.province).trim().toUpperCase() : rec.province); }
            const phones: any[] = P.phones || P.phone || []; const emails: any[] = P.emails || P.email || [];
            const ph = phones.find((x: any) => x?.primary && x?.value) || phones.find((x: any) => x?.value);
            const em = emails.find((x: any) => x?.primary && x?.value) || emails.find((x: any) => x?.value);
            rec.phone = ph?.value || null; rec.email = em?.value ? String(em.value).toLowerCase() : null;
            if (rec.employmentYears || rec.employmentMonths) rec.timeOnJob = `${rec.employmentYears || 0}y ${rec.employmentMonths || 0}m`;

            const pk = phoneKeyOfRaw(rec.phone);
            if (pk.length !== 10 && !rec.email) { skipped++; continue; }      // no way to reach them — skip
            // autoTRADER lead-feed artifacts: hashed relay email, no phone, no real name → not a callable human.
            if (pk.length !== 10 && /@leads\.trader\.ca$/i.test(String(rec.email || ""))) { skipped++; continue; }
            if (/^autotrader/i.test(String(rec.firstName || ""))) { skipped++; continue; }
            // Applied month (YYYY-MM) for "call everyone from March 2024" workflows.
            const appliedIso = P.add_time ? new Date(String(P.add_time).replace(" ", "T") + (String(P.add_time).endsWith("Z") ? "" : "Z")).toISOString() : nowIso;
            rec.appliedMonth = appliedIso.slice(0, 7);
            const docId = pk.length === 10 ? `pd_${pk}` : `pp_${P.id}`;
            const isDnc = /opt[- ]?out|do not (call|contact)|dnc|wrong number/i.test(String(rec.appStatus || "") + " " + String((P.label_ids || []).join(",")));
            if (isDnc) dnc++;

            const data: any = {
              ...rec,
              phoneKey: pk.length === 10 ? pk : null,
              title: [rec.firstName, rec.lastName].filter(Boolean).join(" ") || P.name || null,
              pipedrivePersonId: String(P.id),
              stage: "free_to_call", owner: null, ownerName: null, assignedAt: null,
              addTime: appliedIso, firstAppliedAt: appliedIso, lastAppliedAt: appliedIso,
              releasedAt: appliedIso,
              source: "pipedrive-import", importedAt: nowIso,
              searchTokens: tokensFor(rec),
              updatedAt: nowIso,
              ...(isDnc ? { dnc: true, dncReason: "Pipedrive: " + (rec.appStatus || "opt out") } : {}),
            };
            if (!dryRun) { batch.set(db.collection("crmLeads").doc(docId), data, { merge: true }); ops++; }
            if (docId.startsWith("pd_")) merged++; else imported++;
            if (ops >= 300) { await batch.commit(); batch = db.batch(); ops = 0; }
          }
          if (!dryRun && ops > 0) await batch.commit();
        }
        return res.json({ ok: true, phase, nextStart: more ? start : null, done: !more, withPhone: merged, emailOnly: imported, skipped, dnc, dryRun });
      }

      if (phase === "leads") {
        let imported = 0, merged = 0, skipped = 0, dnc = 0, more = true;
        for (let p = 0; p < pages && more; p++) {
          const j = await pdFetch(`/leads?limit=${perPage}&start=${start}`);
          const items: any[] = j.data || [];
          more = !!j?.additional_data?.pagination?.more_items_in_collection;
          start = j?.additional_data?.pagination?.next_start ?? start + items.length;
          if (!items.length) { more = false; break; }

          let batch = db.batch(); let ops = 0;
          for (const L of items) {
            const rec: any = {};
            for (const [hash, name] of Object.entries(CRM_FIELDS)) {
              const v = (L as any)[hash];
              if (v === undefined || v === null || v === "") continue;
              const enums = CRM_ENUMS[hash];
              rec[name] = enums && typeof v === "number" ? (enums[v] || String(v)) : (typeof v === "object" ? (v.value ?? null) : v);
            }
            if (!rec.firstName && !rec.lastName && L.title) {
              const parts = String(L.title).trim().split(/\s+/);
              rec.firstName = parts[0]; rec.lastName = parts.slice(1).join(" ") || null;
            }
            const pk = phoneKeyOfRaw(rec.phone);
            const docId = pk.length === 10 ? `pd_${pk}` : `pl_${String(L.id).replace(/[^\w-]/g, "")}`;
            if (!rec.firstName && !rec.lastName && !rec.email && pk.length !== 10) { skipped++; continue; }

            const isDnc = PD_DNC_STAGES.has(Number(L.stage_id)) || String(L.label_ids || "").includes("opt-out");
            if (isDnc) dnc++;

            const appNote = {
              text: `📄 Pipedrive application${rec.applicationId ? ` — ${rec.applicationId}` : ""}\n` +
                    [`Vehicle: ${rec.lookingFor || "—"}`, `Budget: ${rec.budget || "—"}`, `Down payment: ${rec.downPayment || "—"}`,
                     `Credit: ${rec.creditSelfRating || "—"}`, `Employment: ${rec.employmentStatus || "—"}`].join("\n"),
              by: "Pipedrive import", at: L.add_time || nowIso, kind: "application", pipedriveLeadId: String(L.id),
            };
            const data: any = {
              ...rec,
              phoneKey: pk.length === 10 ? pk : null,
              title: [rec.firstName, rec.lastName].filter(Boolean).join(" ") || L.title || null,
              pipedriveLeadId: String(L.id),
              stage: "free_to_call", owner: null, ownerName: null, assignedAt: null,
              addTime: L.add_time || nowIso,
              releasedAt: L.add_time || nowIso,          // pool ordering
              source: "pipedrive-import", importedAt: nowIso,
              searchTokens: tokensFor(rec),
              updatedAt: nowIso,
              ...(isDnc ? { dnc: true, dncReason: Number(L.stage_id) === 48 ? "Opt out" : "Wrong number" } : {}),
              activityLog: admin.firestore.FieldValue.arrayUnion(appNote),
            };
            if (!dryRun) { batch.set(db.collection("crmLeads").doc(docId), data, { merge: true }); ops++; }
            if (docId.startsWith("pd_")) merged++; else imported++;
            if (ops >= 300) { await batch.commit(); batch = db.batch(); ops = 0; }
          }
          if (!dryRun && ops > 0) await batch.commit();
        }
        return res.json({ ok: true, phase, nextStart: more ? start : null, done: !more, imported, merged, skipped, dnc, dryRun });
      }

      if (phase === "leads-backfill") {
        // Pipedrive LEADS carry the full application inline for many eras (top-level 40-char hashes,
        // same CRM_FIELDS map as /apply-now). Fill whatever the person record is missing.
        // NEVER creates records; never overwrites a non-empty field.
        let backfilled = 0, skippedNoDoc = 0, noContact = 0, more = true;
        for (let p = 0; p < pages && more; p++) {
          const j = await pdFetch(`/leads?limit=${perPage}&start=${start}`);
          const items: any[] = j.data || [];
          more = !!j?.additional_data?.pagination?.more_items_in_collection;
          start = j?.additional_data?.pagination?.next_start ?? start + items.length;
          if (!items.length) { more = false; break; }
          let batch = db.batch(); let ops = 0;
          for (const L of items) {
            const rec: any = {};
            for (const [hash, name] of Object.entries(CRM_FIELDS)) {
              const v = (L as any)[hash];
              if (v === undefined || v === null || v === "") continue;
              const enums = CRM_ENUMS[hash];
              rec[name] = enums && typeof v === "number" ? (enums[v] || String(v)) : (typeof v === "object" ? (v.value ?? null) : v);
            }
            if (!Object.keys(rec).length) continue;                       // shell lead — nothing to give
            const pk = phoneKeyOfRaw(rec.phone);
            const personId = L.person_id ? String(L.person_id) : "";
            const targetId = pk.length === 10 ? `pd_${pk}` : (personId ? `pp_${personId}` : null);
            if (!targetId) { noContact++; continue; }
            const ref = db.collection("crmLeads").doc(targetId);
            const cur = await ref.get();
            if (!cur.exists) { skippedNoDoc++; continue; }                 // creation belongs to the persons pass
            const have = cur.data() || {};
            const missing: any = {};
            for (const [k, v] of Object.entries(rec)) if (v != null && v !== "" && (have[k] == null || have[k] === "")) missing[k] = v;
            const appliedIso = L.add_time ? new Date(L.add_time).toISOString() : nowIso;
            const upd: any = { updatedAt: nowIso, applications: admin.firestore.FieldValue.arrayUnion(appliedIso), pipedriveLeadId: String(L.id) };
            if (Object.keys(missing).length) { backfilled++; if (missing.province) { const PROV: Record<string, string> = { "nova scotia": "NS", "new brunswick": "NB", "newfoundland and labrador": "NL", "newfoundland": "NL", "prince edward island": "PE", "quebec": "QC", "ontario": "ON", "manitoba": "MB", "saskatchewan": "SK", "alberta": "AB", "british columbia": "BC" }; const k2 = String(missing.province).trim().toLowerCase(); missing.province = PROV[k2] || (String(missing.province).trim().length === 2 ? String(missing.province).trim().toUpperCase() : missing.province); } }
            if (!dryRun) { batch.set(ref, { ...missing, ...upd }, { merge: true }); ops++; }
            if (ops >= 250) { await batch.commit(); batch = db.batch(); ops = 0; }
          }
          if (!dryRun && ops > 0) await batch.commit();
        }
        return res.json({ ok: true, phase, nextStart: more ? start : null, done: !more, backfilled, skippedNoRecord: skippedNoDoc, noContact, dryRun });
      }

      if (phase === "deals") {
        // Deals carry the FULL application (phone, email, DOB, address, employment, income, vehicle…).
        // This pass does THREE things across ALL deals (all statuses, all time):
        //   1. BACK-FILL: fill any field the person record is missing; re-key a phone-less person
        //      (pp_<id>) to pd_<phone> once a deal reveals their number; record each application date.
        //   2. DNC: AI-pipeline Opt Out / Wrong Number → flag the person DNC (out of the claimable pool).
        //   3. OWNERSHIP (Aug 1+ only, open sales-pipeline deals): put the lead on that rep's board/stage.
        const STAGE_MAP: Record<number, string> = { 35: "attempting_contact", 40: "dealertrack", 36: "approved", 37: "approved", 38: "signed", 39: "signed" }; // 37 Agreed to Buy stays "approved" — signed is for won/delivered only
        const repsSnap = await db.collection("crmReps").get();
        const byPdUser = new Map<string, { id: string; name: string }>();
        repsSnap.docs.forEach((d: any) => { const pid = d.get("pipedriveOwnerId"); if (pid) byPdUser.set(String(pid), { id: d.id, name: d.get("name") || d.id }); });
        const ownershipFrom = IMPORT_OWNERSHIP_FROM.slice(0, 19).replace("T", " ");
        let owned = 0, backfilled = 0, rekeyed = 0, dncN = 0, noPhone = 0, skippedNoDoc = 0, hasMore = true;
        for (let p = 0; p < pages && hasMore; p++) {
          const j = await pdFetch(`/deals?limit=${perPage}&start=${start}&status=all_not_deleted`);
          const items: any[] = j.data || [];
          hasMore = !!j?.additional_data?.pagination?.more_items_in_collection;
          start = j?.additional_data?.pagination?.next_start ?? start + items.length;
          if (!items.length) { hasMore = false; break; }
          // Batch-resolve personId → CRM doc id (30 at a time) so phone-less deals don't need one query each.
          const needIds = new Set<string>();
          for (const D of items) {
            const cf0 = D.custom_fields && typeof D.custom_fields === "object" ? D.custom_fields : D;
            const ph0 = cf0["9902ecfb207e316c980c1264d302e7e48a86bf4a"];
            const pk0 = phoneKeyOfRaw(typeof ph0 === "object" ? ph0?.value : ph0);
            const pid0 = D.person_id ? String(typeof D.person_id === "object" ? D.person_id.value : D.person_id) : "";
            if (pk0.length !== 10 && pid0) needIds.add(pid0);
          }
          const personDoc = new Map<string, string>();
          const idsArr = Array.from(needIds);
          for (let i = 0; i < idsArr.length; i += 30) {
            const chunk = idsArr.slice(i, i + 30);
            const q = await db.collection("crmLeads").where("pipedrivePersonId", "in", chunk).get();
            q.docs.forEach((d: any) => personDoc.set(String(d.get("pipedrivePersonId")), d.id));
          }

          let batch = db.batch(); let ops = 0;
          for (const D of items) {
            const cf = D.custom_fields && typeof D.custom_fields === "object" ? D.custom_fields : D;
            // Map the deal's application fields through CRM_FIELDS (same hashes as /apply-now).
            const rec: any = {};
            for (const [hash, name] of Object.entries(CRM_FIELDS)) {
              const v = cf[hash]; if (v === undefined || v === null || v === "") continue;
              const enums = CRM_ENUMS[hash];
              rec[name] = enums && typeof v === "number" ? (enums[v] || String(v)) : (typeof v === "object" ? (v.value ?? null) : v);
            }
            const pk = phoneKeyOfRaw(rec.phone);
            const personId = D.person_id ? String(typeof D.person_id === "object" ? D.person_id.value : D.person_id) : "";
            const appliedIso = D.add_time ? new Date(String(D.add_time).replace(" ", "T") + "Z").toISOString() : nowIso;
            const isDnc = PD_DNC_STAGES.has(Number(D.stage_id));

            // Where does this deal's person live right now? Prefer the phone key; else find the record
            // by pipedrivePersonId (persons imported with a phone live at pd_<phone>, not pp_<id>).
            let targetId: string | null = pk.length === 10 ? `pd_${pk}` : (personId ? personDoc.get(personId) || null : null);
            if (!targetId) { noPhone++; continue; }

            // Re-key: person was imported phone-less as pp_<id> but this deal has their phone → move to pd_<phone>.
            if (pk.length === 10 && personId && !dryRun) {
              const ppRef = db.collection("crmLeads").doc(`pp_${personId}`);
              const pp = await ppRef.get();
              if (pp.exists) {
                const pdRef = db.collection("crmLeads").doc(`pd_${pk}`);
                const pd = await pdRef.get();
                const merged = { ...(pp.data() || {}), ...(pd.exists ? (pd.data() || {}) : {}) };   // existing pd_ wins on conflicts
                batch.set(pdRef, merged, { merge: true }); batch.delete(ppRef); ops += 2; rekeyed++;
              }
            }

            // Back-fill: only fill what's missing (never overwrite a value the person already had).
            const fill: any = {};
            for (const [k, v] of Object.entries(rec)) if (v != null && v !== "") fill[k] = v;
            if (pk.length === 10) fill.phoneKey = pk;
            fill.searchTokens = tokensFor({ ...rec });
            const upd: any = {
              updatedAt: nowIso,
              applications: admin.firestore.FieldValue.arrayUnion(appliedIso),
              lastAppliedAt: appliedIso,            // bumped below only if newer (merge-friendly approximation)
              pipedriveDealIds: admin.firestore.FieldValue.arrayUnion(String(D.id)),
              ...(isDnc ? { dnc: true, dncReason: Number(D.stage_id) === 48 ? "Opt out (AI caller)" : "Wrong number (AI caller)" } : {}),
            };
            if (isDnc) dncN++;

            // Ownership: open, sales pipeline, added Aug 1 or later, owner maps to a rep.
            // v1 deals LIST uses `user_id` (object or number); single-get uses `owner_id`.
            const ownerRaw = D.user_id ?? D.owner_id;
            const ownerId = ownerRaw && typeof ownerRaw === "object" ? (ownerRaw.id ?? ownerRaw.value) : ownerRaw;
            const rep = byPdUser.get(String(ownerId));
            const eligible = D.status === "open" && Number(D.pipeline_id) === 5 && String(D.add_time || "") >= ownershipFrom && !!rep;
            if (eligible && rep) {
              const stage = STAGE_MAP[Number(D.stage_id)] || "attempting_contact";
              Object.assign(upd, {
                stage, owner: rep.id, ownerName: rep.name, assignedAt: appliedIso,
                attemptingSince: stage === "attempting_contact" ? (D.stage_change_time ? new Date(String(D.stage_change_time).replace(" ", "T") + "Z").toISOString() : appliedIso) : null,
                releasedAt: null, releasedFrom: null, releasedFromName: null, pipedriveDealId: String(D.id),
                activityLog: admin.firestore.FieldValue.arrayUnion({ text: `📥 Imported from Pipedrive as an open deal — ${rep.name}.`, by: "Pipedrive import", at: nowIso, kind: "note", pipedriveDealId: String(D.id) }),
              });
            }

            if (!dryRun) {
              const ref = db.collection("crmLeads").doc(targetId);
              // Two writes: missing-only fields (create-if-absent semantics via merge of a fill object
              // that we first strip of keys the doc already has), then the unconditional update.
              const cur = await ref.get();
              if (!cur.exists) { skippedNoDoc++; continue; }   // Deals NEVER create records — the persons pass owns creation. No stubs, ever.
              const have = cur.data() || {};
              const missing: any = {};
              for (const [k, v] of Object.entries(fill)) if (have[k] == null || have[k] === "") missing[k] = v;
              if (Object.keys(missing).length) backfilled++;
              if (eligible) owned++;
              batch.set(ref, { ...missing, ...upd }, { merge: true }); ops++;
            } else {
              const cur = await db.collection("crmLeads").doc(targetId).get();
              if (!cur.exists) { skippedNoDoc++; continue; }
              if (Object.keys(fill).length) backfilled++;
              if (eligible) owned++;
            }
            if (ops >= 250) { await batch.commit(); batch = db.batch(); ops = 0; }
          }
          if (!dryRun && ops > 0) await batch.commit();
        }
        return res.json({ ok: true, phase, nextStart: hasMore ? start : null, done: !hasMore, owned, backfilled, rekeyed, dnc: dncN, noPhoneNoPerson: noPhone, skippedNoRecord: skippedNoDoc, dryRun });
      }

      return res.status(400).json({ error: "Unknown phase. Use 'leads' or 'deals'." });
    } catch (err: any) {
      console.error("[PD-IMPORT] error:", err?.message || err);
      res.status(500).json({ error: String(err?.message || err).slice(0, 300) });
    }
  });

  // ---- Free-to-Call pool: paginated + server-side search (built for 35k+ imported leads) ----
  // Returns LIGHT rows only (no activityLog) — the drawer fetches the full lead on open.
  app.get("/api/crm/pool", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 50));
      const cursor = String(req.query.cursor || "");           // last releasedAt|id from the previous page
      const q = String(req.query.q || "").trim().toLowerCase();
      const province = String(req.query.province || "").trim();
      const lookingFor = String(req.query.lookingFor || "").trim();
      const credit = String(req.query.credit || "").trim();
      const month = String(req.query.month || "").trim();   // YYYY-MM — "everyone who applied in March 2024"

      let ref: any = ctx.db.collection("crmLeads").where("stage", "==", "free_to_call");
      if (month) ref = ref.where("appliedMonth", "==", month);
      if (province) ref = ref.where("province", "==", province);
      if (lookingFor) ref = ref.where("lookingFor", "==", lookingFor);
      if (credit) ref = ref.where("creditSelfRating", "==", credit);

      // Search: digits → phone key; text → token match (searchTokens is written on import/save).
      const digits = q.replace(/\D/g, "");
      if (q && digits.length >= 7) {
        ref = ref.where("phoneKey", "==", digits.slice(-10));
      } else if (q) {
        ref = ref.where("searchTokens", "array-contains", q.split(/\s+/)[0].slice(0, 24));
      }

      // Counts: whole pool (claimable) + the current filtered slice. count() is cheap — no docs read.
      const countOf = async (r: any) => { try { return (await r.count().get()).data().count as number; } catch { return null; } };
      const [totalPool, filteredTotal] = await Promise.all([
        countOf(ctx.db.collection("crmLeads").where("stage", "==", "free_to_call")),
        countOf(ref),   // same filters as the page, before ordering/limit
      ]);

      ref = ref.orderBy("releasedAt", "desc").limit(limit + 1);
      if (cursor) { try { ref = ref.startAfter(new Date(cursor).toISOString()); } catch {} }

      const snap = await ref.get();
      const docs = snap.docs.slice(0, limit);
      const rows = docs
        .filter((d: any) => d.get("dnc") !== true)      // Opt Out / Wrong Number never appear in the claimable pool
        .map((d: any) => ({
          id: d.id,
          firstName: d.get("firstName") || null, lastName: d.get("lastName") || null, title: d.get("title") || null,
          phone: d.get("phone") || null, email: d.get("email") || null,
          city: d.get("city") || null, province: d.get("province") || null,
          lookingFor: d.get("lookingFor") || null, budget: d.get("budget") || null,
          creditSelfRating: d.get("creditSelfRating") || null,
          releasedAt: d.get("releasedAt") || d.get("addTime") || null,
          releasedFrom: d.get("releasedFrom") || null, releasedFromName: d.get("releasedFromName") || null,
          releaseStats: d.get("releaseStats") || null, poolNote: d.get("poolNote") || null,
          addTime: d.get("addTime") || null, source: d.get("source") || null,
          firstAppliedAt: d.get("firstAppliedAt") || d.get("addTime") || null, lastAppliedAt: d.get("lastAppliedAt") || d.get("addTime") || null,
          appliedMonth: d.get("appliedMonth") || null, applications: d.get("applications") || null,
        }));
      const last = docs[docs.length - 1];
      res.json({
        rows,
        nextCursor: snap.docs.length > limit && last ? (last.get("releasedAt") || last.get("addTime") || null) : null,
        hasMore: snap.docs.length > limit,
        totalPool, filteredTotal,
      });
    } catch (err: any) {
      console.error("[CRM-POOL] error:", err?.message || err);
      res.status(500).json({ error: "Failed to load the pool.", detail: String(err?.message || err).slice(0, 200) });
    }
  });

  // One full lead (with thread) — used when opening a pool/nurture lead in the drawer.
  app.get("/api/crm/lead", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const id = String(req.query.id || "");
      if (!id) return res.status(400).json({ error: "Missing id." });
      const d = await ctx.db.collection("crmLeads").doc(id).get();
      if (!d.exists) return res.status(404).json({ error: "Lead not found." });
      res.json({ lead: { id: d.id, ...(d.data() || {}) } });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load lead." });
    }
  });

  // Public: resolve a trade-in token → who the customer is (name only, for the appraisal page greeting).
  app.get("/api/appraisal/lead", async (req, res) => {
    if (!rateLimit(`trade-lookup:${clientIp(req)}`, 60, 10 * 60 * 1000)) return res.status(429).json({ error: "Too many attempts." });
    const tok = String(req.query.lead || "").trim();
    if (!tok || tok.length < 10 || tok.length > 64) return res.status(400).json({ found: false });
    try {
      const { db } = await getFirestoreAdmin();
      const q = await db.collection("crmLeads").where("tradeToken", "==", tok).limit(1).get();
      if (q.empty) return res.json({ found: false });
      const d = q.docs[0];
      res.json({ found: true, firstName: d.get("firstName") || "", lastName: (d.get("lastName") || "").slice(0, 1), rep: d.get("ownerName") || null, hasTradeIn: d.get("hasTradeIn") || null });
    } catch (e: any) { res.json({ found: null }); }
  });

  app.post("/api/crm/claim", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { leadId, repId } = req.body || {};
      if (!leadId || typeof leadId !== "string") return res.status(400).json({ error: "Missing lead id." });
      const ref = ctx.db.collection("crmLeads").doc(leadId);
      const d = await ref.get();
      if (!d.exists) return res.status(404).json({ error: "Lead not found." });
      if (d.get("stage") !== "free_to_call") return res.status(409).json({ error: "This lead isn't in the Free-to-Call pool any more." });
      // Who's claiming: admins may pick a rep; reps claim for themselves.
      let rep: any = null;
      if (repId && ctx.role !== "sales_rep") { const r = await ctx.db.collection("crmReps").doc(String(repId)).get(); if (r.exists) rep = { id: r.id, name: r.get("name") }; }
      if (!rep) { const mine = await ctx.db.collection("crmReps").where("uid", "==", ctx.uid).limit(1).get(); if (!mine.empty) rep = { id: mine.docs[0].id, name: mine.docs[0].get("name") }; }
      if (!rep) return res.status(400).json({ error: "Your login isn't linked to a rep record yet." });
      if (d.get("releasedFrom") === rep.id) return res.status(403).json({ error: "You had this lead already — it's in the pool so someone else can try." });
      const now = new Date().toISOString();
      await ref.update({
        stage: "attempting_contact", owner: rep.id, ownerName: rep.name || null, assignedAt: now, updatedAt: now,
        attemptingSince: now, lastAttemptAt: now,                        // fresh 3-business-day clock for the new rep
        claimedAt: now, claimedBy: rep.id, poolClaims: ctx.admin.firestore.FieldValue.increment(1),
        stageHistory: ctx.admin.firestore.FieldValue.arrayUnion({ from: "free_to_call", to: "attempting_contact", by: ctx.email, byUid: ctx.uid, at: now }),
        activityLog: ctx.admin.firestore.FieldValue.arrayUnion({ text: `♻️ Claimed from the Free-to-Call pool by ${rep.name || ctx.email} — 3 business days to make contact.`, by: rep.name || ctx.email, byUid: ctx.uid, byRepId: rep.id, at: now, kind: "note" }),
      });
      try { await ctx.db.collection("crmReps").doc(rep.id).update({ lastAssignedAt: now }); } catch {}
      res.json({ success: true, owner: rep.id, ownerName: rep.name || null });
    } catch (err: any) {
      console.error("[CRM-CLAIM] error:", err?.message || err);
      res.status(500).json({ error: "Failed to claim lead." });
    }
  });

  app.post("/api/crm/send-text", async (req, res) => {
    try {
      const ctx = await requireStaff(req);
      if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      const { leadId, text, mediaUrls } = req.body || {};
      if (!leadId || typeof leadId !== "string") return res.status(400).json({ error: "Missing lead id." });
      const msg = String(text || "").trim();
      // Photos ride along as MMS — https URLs only (Quo fetches them), max 5.
      const media: string[] = Array.isArray(mediaUrls)
        ? mediaUrls.filter((u: any) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, 5)
        : [];
      if (!msg && media.length === 0) return res.status(400).json({ error: "Message is empty." });
      const apiKey = process.env.QUO_API_KEY;
      if (!apiKey) return res.status(503).json({ error: "Texting isn't configured yet (QUO_API_KEY not set)." });

      const leadRef = ctx.db.collection("crmLeads").doc(leadId);
      const leadSnap = await leadRef.get();
      if (!leadSnap.exists) return res.status(404).json({ error: "Lead not found." });
      const to = String(leadSnap.get("phone") || "").trim();
      if (!to) return res.status(400).json({ error: "This lead has no phone number." });

      // Send from the OWNING rep's own Quo line (so replies stay with them). Reps
      // without a Quo number fall back to the shared line.
      let fromNumber = process.env.QUO_FROM_NUMBER || "";
      let byName = ctx.name || ctx.email; let byRepId: string | undefined;
      const ownerId = String(leadSnap.get("owner") || "");
      if (ownerId) {
        try {
          const rep = await ctx.db.collection("crmReps").doc(ownerId).get();
          if (rep.exists) { byRepId = rep.id; byName = rep.get("name") || byName; if (rep.get("quoNumber")) fromNumber = rep.get("quoNumber"); }
        } catch {}
      }
      if (!fromNumber) return res.status(503).json({ error: "No Quo number to send from (QUO_FROM_NUMBER not set and rep has no line)." });

      // OpenPhone needs E.164 (+17828305313) — normalize however the number was typed.
      const toE164 = (n: string) => { const d = String(n).replace(/\D+/g, ""); return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : d ? `+${d}` : ""; };
      fromNumber = toE164(fromNumber);
      const toNum = toE164(to);
      if (!toNum || toNum.length < 12) return res.status(400).json({ error: `Customer phone "${to}" isn't a valid number.` });

      // OpenPhone send API — auth is the raw API key in the Authorization header.
      // OpenPhone rejects blank content — for a photo-only send, omit it (media carries the message).
      const payload: any = { from: fromNumber, to: [toNum] };
      if (msg) payload.content = msg;
      if (media.length) payload.mediaUrls = media;
      const r = await fetchWithTimeout("https://api.openphone.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify(payload),
      });
      const jd: any = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.error("[SEND-TEXT] OpenPhone error:", r.status, jd);
        return res.status(502).json({ error: (jd && (jd.message || jd.error)) || "Quo rejected the message." });
      }
      const msgId = jd?.data?.id || jd?.id || "";
      const now = new Date().toISOString();
      const entry: any = {
        text: msg ? `💬 Text sent: ${msg.slice(0, 1000)}` : `💬 Photo sent`, by: byName, at: now,
        kind: "text", direction: "outbound", from: fromNumber, to, externalId: String(msgId),
      };
      if (media.length) entry.media = media;
      if (byRepId) entry.byRepId = byRepId;
      await leadRef.update({
        activityLog: ctx.admin.firestore.FieldValue.arrayUnion(entry),
        lastAttemptAt: now, updatedAt: now,
      });
      res.json({ success: true, entry });
    } catch (err: any) {
      console.error("[SEND-TEXT] error:", err?.message || err);
      res.status(500).json({ error: `Failed to send text${err?.message ? ` — ${String(err.message).slice(0, 160)}` : "."}` });
    }
  });
  // ===================================================================

  app.get("/api/health", async (req, res) => {
    let pipedriveStatus = "untested";

    const pipedriveToken = process.env.PIPEDRIVE_API_TOKEN;
    const pipedriveFieldKeys = {
      dob: process.env.PIPEDRIVE_LEAD_DOB_FIELD_KEY ? `${process.env.PIPEDRIVE_LEAD_DOB_FIELD_KEY.slice(0, 4)}...` : null,
      income: process.env.PIPEDRIVE_INCOME_FIELD_KEY ? `${process.env.PIPEDRIVE_INCOME_FIELD_KEY.slice(0, 4)}...` : null,
      housing: process.env.PIPEDRIVE_HOUSING_FIELD_KEY ? `${process.env.PIPEDRIVE_HOUSING_FIELD_KEY.slice(0, 4)}...` : null,
      postal: process.env.PIPEDRIVE_POSTAL_FIELD_KEY ? `${process.env.PIPEDRIVE_POSTAL_FIELD_KEY.slice(0, 4)}...` : null,
      interestedIn: process.env.PIPEDRIVE_INTERESTED_IN_FIELD_KEY ? `${process.env.PIPEDRIVE_INTERESTED_IN_FIELD_KEY.slice(0, 4)}...` : null,
      appId: process.env.PIPEDRIVE_APPLICATION_ID_FIELD_KEY ? `${process.env.PIPEDRIVE_APPLICATION_ID_FIELD_KEY.slice(0, 4)}...` : null,
      street: process.env.PIPEDRIVE_STREET_FIELD_KEY ? `${process.env.PIPEDRIVE_STREET_FIELD_KEY.slice(0, 4)}...` : null,
      source: process.env.PIPEDRIVE_LEAD_SOURCE_FIELD_KEY ? `${process.env.PIPEDRIVE_LEAD_SOURCE_FIELD_KEY.slice(0, 4)}...` : null,
    };

    if (pipedriveToken) {
      try {
        const pdResponse = await fetch(`https://api.pipedrive.com/v1/users/me?api_token=${pipedriveToken}`);
        if (pdResponse.ok) {
          pipedriveStatus = "valid";
        } else {
          const pdError = await pdResponse.json();
          pipedriveStatus = `error: ${pdResponse.status} - ${JSON.stringify(pdError)}`;
        }
      } catch (err: any) {
        pipedriveStatus = `fetch-error: ${err.message}`;
      }
    } else {
      pipedriveStatus = "missing-token";
    }

    res.json({ 
      status: "ok", 
      site: "Vehicle Approval Centre",
      domain: "vehicleapprovalcentre.com",
      timestamp: new Date().toISOString(),
      hasPipedriveToken: !!pipedriveToken,
      pipedriveTokenLength: pipedriveToken?.length || 0,
      pipedriveStatus,
      pipedriveFieldKeys,
      env: process.env.NODE_ENV || 'development',
      headers: {
        host: req.headers.host,
        'x-forwarded-host': req.headers['x-forwarded-host'],
        'x-forwarded-proto': req.headers['x-forwarded-proto'],
        'user-agent': req.headers['user-agent']?.substring(0, 50) + '...'
      }
    });
  });

  // ---- "Request More Photos": public button on vehicle pages. Captures a hot
  // lead straight into the CRM Inbox (merged by phone, same rules as apply-now).
  app.post("/api/photo-request", async (req, res) => {
    try {
      const name = String(req.body?.name || "").trim().slice(0, 80);
      const phoneRaw = String(req.body?.phone || "").trim().slice(0, 25);
      const vehicle = String(req.body?.vehicle || "").trim().slice(0, 120);
      const link = String(req.body?.link || "").trim().slice(0, 300);
      const pk = phoneKeyOfRaw(phoneRaw);
      if (!name || pk.length !== 10) return res.status(400).json({ error: "Please give us your name and a valid phone number." });
      const { admin, db } = await getFirestoreAdmin();
      const nowIso2 = new Date().toISOString();
      const parts = name.split(/\s+/);
      const ref = db.collection("crmLeads").doc(`pd_${pk}`);
      const cur = await ref.get();
      const upd: any = {
        firstName: parts[0], lastName: parts.slice(1).join(" ") || null,
        phone: phoneRaw, phoneKey: pk, updatedAt: nowIso2,
        activityLog: admin.firestore.FieldValue.arrayUnion({
          text: `📸 Requested more photos of ${vehicle || "a vehicle"}${link ? `\n${link}` : ""}`,
          by: "Website", at: nowIso2, kind: "note",
        }),
      };
      const prevStage2 = cur.exists ? String(cur.get("stage") || "") : "";
      if (!cur.exists) Object.assign(upd, { stage: "new_lead", owner: null, ownerName: null, addTime: nowIso2, source: "photo-request", title: name, searchTokens: tokensFor({ firstName: parts[0], lastName: parts.slice(1).join(" ") }) });
      else if (prevStage2 === "free_to_call" || prevStage2 === "lost") Object.assign(upd, { stage: "new_lead", owner: null, ownerName: null, dnc: false, releasedAt: null, releasedFrom: null, releasedFromName: null });
      await ref.set(upd, { merge: true });
      return res.json({ ok: true });
    } catch (e: any) {
      console.error("[PHOTO-REQUEST]", e);
      return res.status(500).json({ error: "Something went wrong — please call us instead." });
    }
  });

  // ---- Auction import: paste an eBlock share link (graph.eblock.com/share/…) or an
  // OpenLane public VDP link and the vehicle lands in `inventory` fully populated —
  // specs parsed from the auction page, photos re-hosted to Firebase Storage so the
  // listing outlives the auction page. dryRun:true returns the parse without writing.
  app.post("/api/inventory/import-auction", async (req, res) => {
    try {
      const secret = process.env.CRM_TICK_SECRET || "";
      const viaSecret = secret && String(req.get("x-tick-secret") || "") === secret;
      if (!viaSecret) {
        const ctx = await requireAdmin(req);
        if ("error" in ctx) return res.status(ctx.error).json({ error: ctx.message });
      }
      const url = String(req.body?.url || "").trim();
      const price = Number(req.body?.price) || 0;
      const status = String(req.body?.status || "For Sale");
      const dryRun = req.body?.dryRun === true;
      if (!url) return res.status(400).json({ error: "Pass url." });
      const { admin, db } = await getFirestoreAdmin();

      const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
      const tc = (s: any) => String(s || "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
      const car: any = { source: null, vin: null, year: null, make: null, model: null, trim: "", mileage: null, bodyStyle: "", transmission: "", fuelType: "", exteriorColor: "", interiorColor: "", engine: "", drivetrain: "", features: [] as string[], photoUrls: [] as string[] };

      const ebShare = url.match(/graph\.eblock\.com\/share\/([A-Za-z0-9]+)/);
      const olPublic = url.match(/app\.openlane\.ca\/vdp\/retail\/public\/([a-f0-9-]{36})/i);

      if (ebShare) {
        car.source = "eblock";
        const r = await fetchWithTimeout(`https://graph.eblock.com/share/${ebShare[1]}`, { headers: { "User-Agent": UA, Accept: "text/html" } }, 30000);
        const html = await r.text();
        const field = (label: string) => {
          // value may embed a colour-swatch tag: <strong><b style=…></b>Gray</strong>
          const m = html.match(new RegExp(`<span>\\s*${label}\\s*</span>[\\s\\S]{0,160}?<strong>(?:<b[^>]*>\\s*</b>)?\\s*([^<]*)`, "i"));
          const v = m ? m[1].replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim() : "";
          return v === "-" ? "" : v;
        };
        car.year = Number(field("Year")) || null;
        car.make = field("Make"); car.model = field("Model"); car.trim = field("Trim");
        car.vin = field("VIN") || null;
        car.mileage = Number(field("Vehicle Mileage").replace(/[^\d]/g, "")) || null;
        car.bodyStyle = field("Body type"); car.exteriorColor = field("Exterior Colour"); car.interiorColor = field("Interior Colour");
        car.transmission = field("Transmission"); car.engine = field("Engine").replace(/\s+/g, " "); car.drivetrain = field("Drivetrain"); car.fuelType = field("Fuel Type");
        const opt = html.match(/Options\s*<\/h2>([\s\S]*?)<h2/i);
        if (opt) car.features = Array.from(new Set(Array.from(opt[1].matchAll(/<[^>]+>([A-Za-z][^<>{}]{2,40})<\//g)).map((m: any) => m[1].trim()))).slice(0, 40);
        const raw = Array.from(html.matchAll(/https:\/\/media\.prod\.eblock\.e\.inc\/[^"'\s)]+\/images\/([A-Z0-9]+)\.jpg/g)) as any[];
        const seen = new Set<string>();
        for (const m of raw) {
          if (seen.has(m[1])) continue; seen.add(m[1]);
          car.photoUrls.push(String(m[0]).replace(/w_\d+,h_\d+/, "w_1600,h_1200"));
        }
      } else if (olPublic) {
        car.source = "openlane";
        const r = await fetchWithTimeout(`https://prod-vdp-service.prd.kar-services.io/api/v1/retail/vdp/public/${olPublic[1]}?locale=en`, { headers: { "User-Agent": UA } }, 30000);
        const j: any = await r.json();
        car.year = Number(j.year) || null; car.make = tc(j.make); car.model = tc(j.model); car.trim = j.trim || "";
        car.mileage = Number(String(j.odometer?.value || "").replace(/[^\d]/g, "")) || null;
        car.exteriorColor = j.exteriorColor?.value || ""; car.interiorColor = j.interiorColor?.value || "";
        const pt = j.powerTrain || {};
        const ptv = (k: string) => pt[k]?.value || "";
        car.fuelType = ptv("fuelType"); car.transmission = ptv("transmission") || ptv("transmissionType");
        car.drivetrain = ptv("driveTrain") || ptv("drivetrain");
        car.engine = [ptv("engineDisplacement") && `${ptv("engineDisplacement")} L`, ptv("engineCylinderCount") && `${ptv("engineCylinderCount")}-Cyl`].filter(Boolean).join(" ");
        car.features = Array.from(new Set(((j.equipment || []) as any[]).flatMap((e) => (e.disclosures || []).map((d: any) => {
          const val = String(d.value || "").trim(); const label = String(d.displayName || "").trim();
          if (!val && !label) return "";
          if (/^(true|yes)$/i.test(val)) return label;            // boolean feature → just the name
          if (!label) return val;
          return `${label}: ${val}`;                              // e.g. "Air Type: Air Conditioning"
        })).filter(Boolean))).slice(0, 40);
        const olMedia = ([...(j.media || []), ...(j.conditionMedia || [])] as any[]).filter((m) => m?.url && m.type !== "Video").slice(0, 45);
        car.photoUrls = olMedia.map((m) => m.url);
        car.photoCaptions = olMedia.map((m) => String(m.caption || ""));
      } else {
        return res.status(400).json({ error: "Unrecognized link. Paste an eBlock share link (graph.eblock.com/share/…) or an OpenLane public vehicle link (app.openlane.ca/vdp/retail/public/…)." });
      }
      // eBlock photos arrive in page order with damage close-ups near the front —
      // classify them once and reorder the gallery: exteriors, interior, details,
      // documents, damage last. (OpenLane's media list already orders naturally.)
      if (ebShare && process.env.GEMINI_API_KEY && car.photoUrls.length > 3) {
        try {
          const gk2 = process.env.GEMINI_API_KEY;
          const thumbs2: string[] = car.photoUrls.map((u: string) => u.replace(/w_\d+,h_\d+/, "w_400,h_300"));
          const n2 = Math.min(thumbs2.length, 24);
          const parts2: any[] = [{ text: `These ${n2} photos of one car are numbered 0-${n2 - 1} in order. Reply ONLY with JSON: {"front34": <index of the best clean front three-quarter exterior shot, or -1>, "cats": [<one category per photo, in order: "exterior" | "interior" | "detail" | "damage" | "document">]}. "damage" = close-ups of scratches/dents/chips; "document" = window stickers, VIN plates, odometer readouts; "detail" = wheels, engine bay, badges.` }];
          for (let i = 0; i < n2; i++) {
            const rr = await fetchWithTimeout(thumbs2[i], { headers: { "User-Agent": UA } }, 20000);
            parts2.push({ inlineData: { mimeType: "image/jpeg", data: Buffer.from(await rr.arrayBuffer()).toString("base64") } });
          }
          const cr = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${gk2}`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: parts2 }] }) }, 60000);
          const cjj: any = await cr.json().catch(() => ({}));
          const txt2 = (cjj?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("");
          const mj = txt2.match(/\{[\s\S]*\}/);
          if (mj) {
            const parsed2 = JSON.parse(mj[0]);
            const cats: string[] = Array.isArray(parsed2.cats) ? parsed2.cats : [];
            if (cats.length >= 4) {
              const rank: Record<string, number> = { exterior: 0, interior: 1, detail: 2, document: 3, damage: 5 };
              const idxs = car.photoUrls.map((_: string, i: number) => i);
              const key = (i: number) => (i < cats.length ? (rank[cats[i]] ?? 4) : 4);
              idxs.sort((a: number, b: number) => key(a) - key(b) || a - b);
              const front = Number(parsed2.front34);
              if (front >= 0) { const pos = idxs.indexOf(front); if (pos > 0) { idxs.splice(pos, 1); idxs.unshift(front); } }
              car.photoUrls = idxs.map((i: number) => car.photoUrls[i]);
              (car as any).slotFront = 0;
              console.log(`[AUCTION-IMPORT] reordered ${cats.length} classified photos (damage last)`);
            }
          }
        } catch (oe) { console.error("[AUCTION-IMPORT] photo ordering skipped:", (oe as any)?.message); }
      }

      if (!car.year || !car.make) return res.status(422).json({ error: "Could not read the vehicle from that page.", parsed: car });

      const title = [car.year, car.make, car.model, car.trim].filter(Boolean).join(" ");

      // ---- Competitive Atlantic-Canada pricing. Maritime comps first; thin sample →
      // Canada-wide median with a small Atlantic uplift. Suggestion only becomes the
      // price when the admin leaves the price blank; a typed price always wins.
      let market: any = null;
      try {
        const mcKey = process.env.MARKETCHECK_API_KEY;
        if (mcKey && car.year && car.make && car.model) {
          const comps = async (opts: { provinces?: string; yearSpread?: boolean; kmBand?: boolean }) => {
            const u = new URL("https://api.marketcheck.com/v2/search/car/active");
            u.searchParams.set("api_key", mcKey); u.searchParams.set("country", "CA");
            if (opts.yearSpread) u.searchParams.set("year_range", `${car.year - 1}-${car.year + 1}`);
            else u.searchParams.set("year", String(car.year));
            u.searchParams.set("make", String(car.make)); u.searchParams.set("model", String(car.model));
            if (opts.provinces) u.searchParams.set("state", opts.provinces);
            if (opts.kmBand && car.mileage) u.searchParams.set("miles_range", `${Math.max(0, car.mileage - 35000)}-${car.mileage + 35000}`);
            u.searchParams.set("stats", "price"); u.searchParams.set("rows", "0");
            const r2 = await fetchWithTimeout(u.toString());
            if (!r2.ok) return null;
            const cj: any = await r2.json();
            const st = cj?.data?.stats?.price || cj?.stats?.price;
            return st?.median ? { median: Number(st.median), count: Number(st.count || 0), low: st.min, high: st.max } : null;
          };
          // Canada's sample sizes are thin — widen progressively until credible.
          const ladders: { o: any; need: number; scope: string; adj: number }[] = [
            { o: { provinces: "NS,NB,PE,NL", yearSpread: false, kmBand: true }, need: 8, scope: "atlantic", adj: 1 },
            { o: { provinces: "NS,NB,PE,NL", yearSpread: true, kmBand: true }, need: 8, scope: "atlantic±1yr", adj: 1 },
            { o: { yearSpread: false, kmBand: true }, need: 10, scope: "canada+5%", adj: 1.05 },
            { o: { yearSpread: true, kmBand: true }, need: 10, scope: "canada±1yr+5%", adj: 1.05 },
            { o: { yearSpread: true, kmBand: false }, need: 10, scope: "canada±1yr-anykm+5%", adj: 1.05 },
          ];
          for (const step of ladders) {
            const c2 = await comps(step.o);
            if (c2 && c2.count >= step.need) { market = { ...c2, median: Math.round(c2.median * step.adj), scope: step.scope }; break; }
          }
          if (market) {
            // dealer price point: nearest $500, minus $5 → …,995 / …,495
            market.suggested = Math.max(500, Math.round(market.median / 500) * 500 - 5);
          }
        }
      } catch (me) { console.error("[AUCTION-IMPORT] market comps skipped:", (me as any)?.message); }
      const finalPrice = price > 0 ? price : (market?.suggested || 0);

      // ---- AI listing description: warm, honest, grounded ONLY in the parsed facts.
      let aiDescription = "";
      try {
        const gk = process.env.GEMINI_API_KEY;
        if (gk) {
          const facts = {
            vehicle: title, kilometres: car.mileage, bodyStyle: car.bodyStyle || undefined,
            drivetrain: car.drivetrain || undefined, engine: car.engine || undefined,
            transmission: car.transmission || undefined, exteriorColor: car.exteriorColor || undefined,
            interiorColor: car.interiorColor || undefined, features: (car.features || []).slice(0, 18),
          };
          const dr = await fetchWithTimeout(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${gk}`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ text:
                `Write a used-car listing description for Vehicle Approval Centre, an Atlantic Canada dealership that delivers to the customer's door and works with every credit situation. FACTS (use ONLY these — never invent options, condition, history, or ownership claims): ${JSON.stringify(facts)}. The vehicle is newly listed — mention it just arrived, and that every VAC vehicle receives a full MVI and complete reconditioning before delivery. Tone: warm, confident, plain-spoken; 70-100 words; 2-3 short paragraphs or one paragraph plus a short feature line; no ALL-CAPS, no exclamation spam (max one), no emojis, no headings, no price. Return ONLY the description text.` }] }] }) },
            45000);
          const dj: any = await dr.json().catch(() => ({}));
          const txt = (dj?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("").trim();
          if (txt.length > 80 && txt.length < 1200) aiDescription = txt;
        }
      } catch (de) { console.error("[AUCTION-IMPORT] description skipped:", (de as any)?.message); }
      const marketFields: any = market ? {
        marketMedian: market.median, marketSampleSize: market.count,
        ...(finalPrice ? {
          marketPriceDifference: Math.round(market.median - finalPrice),
          marketPriceRating: (finalPrice / market.median) <= 0.94 ? "Great Price" : (finalPrice / market.median) <= 1.00 ? "Good Price" : (finalPrice / market.median) <= 1.08 ? "Fair Price" : "High Price",
        } : {}),
      } : {};

      if (dryRun) return res.json({ ok: true, dryRun: true, title, parsed: { ...car, photoUrls: undefined }, photoCount: car.photoUrls.length, photoSample: car.photoUrls.slice(0, 3), market, finalPrice });

      // Re-host photos so the listing doesn't depend on the auction page staying up.
      const bucket = admin.storage().bucket("gen-lang-client-0753805028.firebasestorage.app");
      const base = `inventory-imports/${(car.vin || Date.now().toString(36)).toLowerCase()}`;
      const crypto = await import("crypto");
      const urls: string[] = car.photoUrls.slice(0, 40);
      const out: (string | null)[] = new Array(urls.length).fill(null);
      let cursor = 0;
      const worker = async () => {
        while (cursor < urls.length) {
          const i = cursor++;
          try {
            const resp = await fetchWithTimeout(urls[i], { headers: { "User-Agent": UA } }, 30000);
            if (!resp.ok) continue;
            const buf = Buffer.from(await resp.arrayBuffer());
            if (buf.length < 2000) continue;
            const path = `${base}/${String(i).padStart(2, "0")}.jpg`;
            const token = crypto.randomUUID();
            await bucket.file(path).save(buf, { contentType: "image/jpeg", resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
            out[i] = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
          } catch { /* skip a failed photo, keep the rest */ }
        }
      };
      await Promise.all(Array.from({ length: 5 }, worker));
      let images = out.filter(Boolean) as string[];

      // ---- VAC virtual showroom: composite the hero angles onto the FIXED studio plate
      // (vac-showroom-plate.png — never changes). Failures never block the import.
      const geminiKey = process.env.GEMINI_API_KEY || "";
      if (geminiKey && images.length && req.body?.studio !== false) {
        try {
          const fs = await import("fs");
          const plate = fs.readFileSync("./vac-showroom-plate.jpg");
          const fetchBuf = async (u: string) => {
            const r2 = await fetchWithTimeout(u, { headers: { "User-Agent": UA } }, 30000);
            return Buffer.from(await r2.arrayBuffer());
          };
          const gemini = async (parts: any[], wantImage: boolean): Promise<any> => {
            for (let attempt = 0; attempt < 3; attempt++) {
              const r2 = await fetchWithTimeout(
                `https://generativelanguage.googleapis.com/v1beta/models/${wantImage ? "gemini-2.5-flash-image" : "gemini-3.6-flash"}:generateContent?key=${geminiKey}`,
                { method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ contents: [{ parts }], ...(wantImage ? { generationConfig: { responseModalities: ["IMAGE"] } } : {}) }) },
                90000);
              const j2: any = await r2.json().catch(() => ({}));
              if (r2.status === 429 || j2?.error?.status === "RESOURCE_EXHAUSTED") {
                console.error(`[AUCTION-IMPORT] gemini rate-limited (attempt ${attempt + 1}) — backing off`);
                await new Promise((rs) => setTimeout(rs, 20000 * (attempt + 1)));
                continue;
              }
              if (j2?.error) { console.error("[AUCTION-IMPORT] gemini error:", JSON.stringify(j2.error).slice(0, 200)); return wantImage ? null : ""; }
              const cand = j2?.candidates?.[0];
              const ps = cand?.content?.parts || [];
              if (wantImage) {
                const p = ps.find((x: any) => x.inlineData?.data);
                if (!p) { console.error("[AUCTION-IMPORT] gemini returned no image, finishReason:", cand?.finishReason, String(ps.map((x: any) => x.text || "").join(" ")).slice(0, 120)); return null; }
                return Buffer.from(p.inlineData.data, "base64");
              }
              return ps.map((x: any) => x.text || "").join("");
            }
            return wantImage ? null : "";
          };

          // Map the auction photos onto the standard dealership angle set — the site
          // shows ONLY studio shots; raw auction photos are kept on the doc for staff.
          const SLOTS: { key: string; angle: string; kind: "exterior" | "interior" | "detail" }[] = [
            // HYBRID MODE: one branded showroom hero for the card; the real auction
            // photos stay in the gallery behind it. The vision pass just picks the
            // nicest front three-quarter source shot.
            { key: "front34", angle: "front three-quarter exterior", kind: "exterior" },
          ];
          let picks: { idx: number; angle: string; kind: string }[] = [];
          const caps: string[] = car.photoCaptions || [];
          if (caps.length) {
            // OpenLane captions its photos — map angles directly, no vision call needed.
            const CAP_RES: Record<string, RegExp> = {
              front34: /front.*(3\/4|quarter)|driver.*front.*photo/i,
              rear34: /rear.*(3\/4|quarter)|passenger.*rear.*photo/i,
              side: /side.*(profile|photo)|profile/i,
              dash: /dash|instrument|front interior/i,
              frontseats: /front seat|driver seat/i,
            };
            for (const s2 of SLOTS) {
              const idx = caps.findIndex((c) => CAP_RES[s2.key]?.test(c));
              if (idx >= 0) picks.push({ idx, angle: s2.angle, kind: s2.kind });
            }
          }
          if (!picks.length && typeof (car as any).slotFront === "number") {
            picks = [{ idx: (car as any).slotFront, angle: "front three-quarter exterior", kind: "exterior" }];
          }
          if (!picks.length) {
            // eBlock: pick angles by eye, from SMALL thumbnails (full-size blows the request cap).
            const thumbs: string[] = (car.photoUrls as string[]).map((u: string) => u.replace(/w_\d+,h_\d+/, "w_400,h_300"));
            const sampleN = Math.min(thumbs.length, 24);
            const sampleParts: any[] = [{ text: `These ${sampleN} photos of the same car are numbered 0-${sampleN - 1} in order. Reply ONLY with a JSON object mapping these keys to the best photo index (or -1 if that angle is missing): ${SLOTS.map((s2) => s2.key + " = " + s2.angle).join("; ")}. Example: {"front34":0,"rear34":3,"side":-1,"dash":5,"frontseats":8}. Only assign an index if that photo GENUINELY shows that angle — use -1 rather than a near-miss. Prefer clean, well-lit, complete shots; never pick close-ups of damage for exterior slots.` }];
            for (let i = 0; i < sampleN; i++) {
              try { sampleParts.push({ inlineData: { mimeType: "image/jpeg", data: (await fetchBuf(thumbs[i])).toString("base64") } }); }
              catch { sampleParts.push({ text: `(photo ${i} unavailable)` }); }
            }
            try {
              const ans = String(await gemini(sampleParts, false)).match(/\{[\s\S]*?\}/);
              if (ans) {
                const p = JSON.parse(ans[0]);
                for (const s2 of SLOTS) {
                  const idx = Number(p[s2.key]);
                  if (idx >= 0 && idx < images.length) picks.push({ idx, angle: s2.angle, kind: s2.kind });
                }
              }
            } catch (se) { console.error("[AUCTION-IMPORT] angle selection failed:", (se as any)?.message); }
          }
          if (!picks.length) picks = [{ idx: 0, angle: "front three-quarter exterior", kind: "exterior" }];

          const studio: string[] = [];
          let genN = 0;
          for (const pick of picks.slice(0, 5)) {
            try {
              if (genN++) await new Promise((rs) => setTimeout(rs, 3000));
              const srcBuf = await fetchBuf(images[pick.idx]);
              const prompt = pick.kind === "interior"
                ? `Image 1 is a fixed dealership showroom background plate. Image 2 is a ${pick.angle} photo of a car. Produce a photorealistic version of image 2 where anything visible THROUGH the windshield or windows is replaced by the showroom from image 1 (purple wall with white V logo, white wall). Keep the entire interior 100% identical — seats, dash, trim, wear. Same framing as image 2. No text, no people.`
                : pick.kind === "detail"
                ? `Image 1 is a fixed dealership showroom background plate. Image 2 is a ${pick.angle} photo of a car. Recreate image 2 exactly, but replace the ground and background with the showroom environment from image 1 (polished light-grey floor, studio lighting). Keep the wheel/car parts 100% identical. No text, no people.`
                : `Image 1 is a fixed dealership showroom background plate (purple wall with white V logo, white wall, circular floor turntable). Image 2 is a dealer photo of a car. The turntable in image 1 is large. Produce a photorealistic composite: the EXACT car from image 2 parked centered ON the turntable (all four wheels inside the circle), seen from the SAME camera angle and framing as image 2 — do not rotate or re-pose the car. Keep the turntable exactly as in image 1 (same size and position in frame; never enlarge, shrink, or move it) and size the car like a showroom display — spanning roughly THREE-QUARTERS of the platform width, prominent, with a visible ring of turntable around it. CRITICAL: the background must remain EXACTLY image 1 — identical walls, logo, floor, lighting, framing, nothing moved or restyled. Keep the car completely unchanged (body, wheels, badges, trim, colour). Adapt only the car's lighting/reflections to indoor studio light and add a natural soft shadow and subtle floor reflection under it. No text, no people, no extra objects.`;
              const genParts = [
                { text: prompt },
                { inlineData: { mimeType: "image/jpeg", data: plate.toString("base64") } },
                { inlineData: { mimeType: "image/jpeg", data: srcBuf.toString("base64") } },
              ];
              let outBuf = await gemini(genParts, true);
              if (!outBuf || outBuf.length < 20000) {              // one more try — NO_IMAGE happens
                await new Promise((rs) => setTimeout(rs, 5000));
                outBuf = await gemini(genParts, true);
              }
              if (!outBuf || outBuf.length < 20000) continue;
              // Guard: the generated shot must show the SAME vehicle as the source —
              // if the model invented a car, throw the shot away.
              try {
                const verdict = String(await gemini([
                  { text: `Photo A and photo B: do they show the exact same vehicle (same colour, body style, wheels, trim)? Ignore the background. Reply ONLY JSON: {"same":true} or {"same":false}.` },
                  { inlineData: { mimeType: "image/jpeg", data: srcBuf.toString("base64") } },
                  { inlineData: { mimeType: "image/jpeg", data: outBuf.toString("base64") } },
                ], false));
                if (!/"same"\s*:\s*true/i.test(verdict)) { console.error(`[AUCTION-IMPORT] studio shot rejected (vehicle mismatch) for ${pick.angle}`); continue; }
              } catch (ve) {
                // FAIL CLOSED: if we can't verify it's the same car, we don't publish it.
                console.error(`[AUCTION-IMPORT] studio shot dropped (verification unavailable) for ${pick.angle}:`, (ve as any)?.message);
                continue;
              }
              const sPath = `${base}/studio-${studio.length}.jpg`;
              const sToken = crypto.randomUUID();
              await bucket.file(sPath).save(outBuf, { contentType: "image/jpeg", resumable: false, metadata: { metadata: { firebaseStorageDownloadTokens: sToken } } });
              studio.push(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(sPath)}?alt=media&token=${sToken}`);
            } catch (se) { console.error("[AUCTION-IMPORT] studio shot failed:", (se as any)?.message); }
          }
          // Hero-only public gallery: the branded showroom shot is the listing; the
          // raw auction photos stay on the doc (auctionImages) for reps to share on
          // request and for the condition record. If no hero could be generated and
          // verified, the real photos remain the gallery so the car still shows well.
          if (studio.length) { (car as any).auctionImages = images; images = studio; }
        } catch (se) { console.error("[AUCTION-IMPORT] studio stage skipped:", (se as any)?.message); }
      }

      const nowIso2 = new Date().toISOString();
      const data: any = {
        vin: car.vin || null, stockNumber: null,
        year: car.year, make: car.make, model: car.model, trim: car.trim || "",
        mileage: car.mileage || 0, price: finalPrice, ...marketFields,
        bodyStyle: car.bodyStyle || "", drivetrain: car.drivetrain || "", engine: car.engine || "",
        transmission: /auto|cvt/i.test(car.transmission) ? "Automatic" : (car.transmission || "Automatic"),
        fuelType: /gas/i.test(car.fuelType) ? "Gasoline" : (car.fuelType || "Gasoline"),
        exteriorColor: car.exteriorColor || "", interiorColor: car.interiorColor || "",
        images, auctionImages: (car as any).auctionImages || null, features: car.features,
        description: aiDescription || `Newly arrived: ${title}${car.mileage ? ` with ${Number(car.mileage).toLocaleString()} km` : ""}. Every VAC vehicle receives a full MVI and complete reconditioning before delivery.`,
        status, source: `auction-import:${car.source}`, auctionUrl: url,
        createdAt: new Date(), updatedAt: nowIso2,
      };
      const ref = await db.collection("inventory").add(data);
      return res.json({ ok: true, id: ref.id, title, photos: images.length, photosAttempted: urls.length, status, price: finalPrice, autoPriced: price <= 0 && finalPrice > 0, market });
    } catch (e: any) {
      console.error("[AUCTION-IMPORT]", e);
      return res.status(500).json({ error: e?.message || "Import failed." });
    }
  });

  // Google Merchant Center & Facebook Catalog Inventory Feed (XML)
  app.get("/api/inventory-feed.xml", async (req, res) => {
    try {
      const { db } = await getFirestoreAdmin();
      
      const inventorySnapshot = await db.collection('inventory').get();
      const baseUrl = getFeedBaseUrl(req);
 
      let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>DriveVac Inventory</title>
    <link>${baseUrl}</link>
    <description>Quality pre-owned vehicles from DriveVac.</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`;
 
      inventorySnapshot.forEach((doc) => {
        const car = doc.data();
        if (car.status === 'Sold') return;
 
        const id = doc.id;
        const vin = car.vin || id;
        const title = `${car.year} ${car.make} ${car.model} ${car.trim || ''}`.trim();
        const description = (car.description || `Beautiful ${car.year} ${car.make} ${car.model} with ${car.mileage}km.`).substring(0, 5000);
        
        const slug = slugify(title);
        const link = slug ? `${baseUrl}/inventory/${slug}-${id}` : `${baseUrl}/inventory/${id}`;
        
        const imageLink = car.images?.[0] || '';
        const price = (car.price === 0 || !car.price) ? 19995 : car.price;
        const availability = car.status === 'Sold' ? 'out of stock' : 'in stock';
 
        let additionalImagesXml = '';
        if (Array.isArray(car.images) && car.images.length > 1) {
          car.images.slice(1, 10).forEach((img: string) => {
            if (img && typeof img === 'string') {
              additionalImagesXml += `\n      <g:additional_image_link>${img}</g:additional_image_link>`;
            }
          });
        }

        xml += `
    <item>
      <g:id>${id}</g:id>
      <g:title><![CDATA[${title}]]></g:title>
      <g:description><![CDATA[${description}]]></g:description>
      <g:link>${link}</g:link>
      <g:image_link>${imageLink}</g:image_link>${additionalImagesXml}
      <g:condition>used</g:condition>
      <g:availability>${availability}</g:availability>
      <g:price>${price} CAD</g:price>
      <g:brand><![CDATA[${car.make}]]></g:brand>
      <g:google_product_category>Vehicles &amp; Parts &gt; Vehicles &gt; Motor Vehicles &gt; Cars, Trucks &amp; Vans</g:google_product_category>
      <g:vin>${vin}</g:vin>
      <g:year>${car.year}</g:year>
      <g:make><![CDATA[${car.make}]]></g:make>
      <g:model><![CDATA[${car.model}]]></g:model>
      <g:mileage>${car.mileage}</g:mileage>
      <g:color><![CDATA[${car.exteriorColor || ''}]]></g:color>
      <g:transmission><![CDATA[${car.transmission || ''}]]></g:transmission>
      <g:fuel_type><![CDATA[${car.fuelType || ''}]]></g:fuel_type>
      <g:body_style><![CDATA[${car.bodyStyle || ''}]]></g:body_style>
      <g:item_group_id><![CDATA[${car.make}_${car.model}]]></g:item_group_id>
    </item>`;
      });
 
      xml += `
  </channel>
</rss>`;
 
      res.header('Content-Type', 'application/xml');
      res.send(xml);
    } catch (error) {
      console.error("[FEED] Error generating inventory feed:", error);
      res.status(500).send('Error generating inventory feed');
    }
  });
 
  // JSON Version of the Feed for DataFeedWatch / Facebook / Google Marketing consumption
  app.get("/api/inventory-feed.json", async (req, res) => {
    try {
      const { db } = await getFirestoreAdmin();
      
      const inventorySnapshot = await db.collection('inventory').get();
      const baseUrl = getFeedBaseUrl(req);

      const items: any[] = [];

      inventorySnapshot.forEach((doc) => {
        const car = doc.data();
        if (car.status === 'Sold') return;

        const id = doc.id;
        const title = `${car.year} ${car.make} ${car.model} ${car.trim || ''}`.trim();
        const slug = slugify(title);
        const link = slug ? `${baseUrl}/inventory/${slug}-${id}` : `${baseUrl}/inventory/${id}`;
        
        items.push({
          id,
          vin: car.vin || id,
          title,
          description: car.description || `Beautiful ${car.year} ${car.make} ${car.model} with ${car.mileage}km.`,
          link,
          image_link: car.images?.[0] || '',
          additional_image_links: Array.isArray(car.images) ? car.images.slice(1) : [],
          condition: 'used',
          availability: 'in stock',
          price: `${(car.price === 0 || !car.price) ? 19995 : car.price} CAD`,
          brand: car.make,
          google_product_category: 'Vehicles & Parts > Vehicles > Motor Vehicles > Cars, Trucks & Vans',
          year: car.year,
          make: car.make,
          model: car.model,
          trim: car.trim || '',
          mileage: car.mileage ? `${car.mileage} km` : '',
          color: car.exteriorColor || '',
          interior_color: car.interiorColor || '',
          transmission: car.transmission || '',
          fuel_type: car.fuelType || '',
          body_style: car.bodyStyle || '',
          drivetrain: car.drivetrain || '',
          engine: car.engine || '',
          status: car.status || 'For Sale'
        });
      });

      res.setHeader('Content-Type', 'application/json');
      res.json(items);
    } catch (error) {
      console.error("[FEED] Error generating JSON feed:", error);
      res.status(500).json({ error: 'Error generating inventory feed' });
    }
  });

  // CSV Version of the Feed for Spreadsheet / DataFeedWatch consumption
  app.get("/api/inventory-feed.csv", async (req, res) => {
    try {
      const { db } = await getFirestoreAdmin();
      
      const inventorySnapshot = await db.collection('inventory').get();
      const baseUrl = getFeedBaseUrl(req);
 
      const headers = [
        'ID', 'Title', 'Description', 'Link', 'Image Link', 'Condition', 'Availability', 
        'Price', 'Brand', 'Google Product Category', 'VIN', 'Year', 'Make', 'Model', 
        'Mileage', 'Color', 'Transmission', 'Fuel Type', 'Body Style'
      ];
 
      let csv = headers.join(',') + '\n';
 
      inventorySnapshot.forEach((doc) => {
        const car = doc.data();
        if (car.status === 'Sold') return;
 
        const id = doc.id;
        const title = `${car.year} ${car.make} ${car.model} ${car.trim || ''}`.trim();
        const description = (car.description || '').replace(/"/g, '""').substring(0, 5000);
        
        const slug = slugify(title);
        const link = slug ? `${baseUrl}/inventory/${slug}-${id}` : `${baseUrl}/inventory/${id}`;
        
        const imageLink = car.images?.[0] || '';
        const price = `${(car.price === 0 || !car.price) ? 19995 : car.price} CAD`;
        const availability = 'in stock';
 
        const row = [
          id,
          `"${title}"`,
          `"${description}"`,
          link,
          imageLink,
          'used',
          availability,
          price,
          car.make,
          'Vehicles & Parts > Vehicles > Motor Vehicles > Cars, Trucks & Vans',
          car.vin || id,
          car.year,
          car.make,
          car.model,
          `${car.mileage} km`,
          car.exteriorColor || '',
          car.transmission || '',
          car.fuelType || '',
          car.bodyStyle || ''
        ];
 
        csv += row.join(',') + '\n';
      });
 
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename="inventory-feed.csv"');
      res.send(csv);
    } catch (error) {
      console.error("[FEED] Error generating CSV feed:", error);
      res.status(500).send('Error generating inventory feed');
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    // Background Job: Release expired leads (48h)
    // Runs every hour
    setInterval(async () => {
      try {
        const { admin, db } = await getFirestoreAdmin();
        const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
        
        const expiredLeads = await db.collection('leads')
          .where('isDeal', '!=', true)
          .where('assignedTo', '!=', '')
          .where('createdAt', '<', fortyEightHoursAgo)
          .get();
          
        const batch = db.batch();
        let count = 0;
        
        expiredLeads.forEach(doc => {
          const data = doc.data();
          // Only release if no recent activity (notes/updates) in last 12 hours
          const lastActivity = data.updatedAt?.toDate() || data.createdAt.toDate();
          const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
          
          if (lastActivity < twelveHoursAgo) {
            batch.update(doc.ref, {
              assignedTo: '',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              notes: (data.notes || '') + `\n\n[${new Date().toLocaleString()}] Lead released to Public Pool due to inactivity (48h rule).`
            });
            count++;
          }
        });
        
        if (count > 0) {
          await batch.commit();
          console.log(`Released ${count} expired leads to Public Pool.`);
        }
      } catch (err) {
        console.error("Error in background lead release job:", err);
      }
    }, 60 * 60 * 1000); 
  });
}

startServer();
