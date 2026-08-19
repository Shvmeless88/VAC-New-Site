/**
 * Gmail via domain-wide delegation — KEYLESS.
 *
 * Cloud Run's runtime identity impersonates the `vac-crm-gmail` service account
 * (roles/iam.serviceAccountTokenCreator) to sign a JWT that asserts a @drivevac.ca
 * user (`sub`). Google swaps that JWT for an access token scoped to that user's
 * Gmail. No JSON key file anywhere; tokens are short-lived and minted per call.
 *
 * Requires (already done):
 *  - Workspace Admin → Domain-wide delegation: client 108406060301868320248 with
 *    gmail.send / gmail.readonly / gmail.modify
 *  - IAM: <run SA> has serviceAccountTokenCreator on vac-crm-gmail@…
 *  - APIs: gmail.googleapis.com, iamcredentials.googleapis.com
 */
import { google } from "googleapis";

const DELEGATE_SA = process.env.GMAIL_DELEGATE_SA || "vac-crm-gmail@gen-lang-client-0753805028.iam.gserviceaccount.com";
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
];

// Small in-memory cache: one token per user, refreshed a minute before expiry.
const cache = new Map<string, { token: string; exp: number }>();

/** Get a Gmail access token acting AS the given @drivevac.ca user. */
export async function delegatedAccessToken(userEmail: string): Promise<string> {
  const key = userEmail.toLowerCase();
  const hit = cache.get(key);
  if (hit && hit.exp - 60_000 > Date.now()) return hit.token;

  // 1) Runtime creds (metadata server on Cloud Run; ADC locally).
  const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();

  // 2) Ask IAM Credentials to sign a JWT AS the delegate SA, with sub = the user.
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: DELEGATE_SA,
    sub: key,
    scope: SCOPES.join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const iam = google.iamcredentials({ version: "v1", auth: client as any });
  const signed = await iam.projects.serviceAccounts.signJwt({
    name: `projects/-/serviceAccounts/${DELEGATE_SA}`,
    requestBody: { payload: JSON.stringify(claims) },
  });
  const jwt = signed.data.signedJwt;
  if (!jwt) throw new Error("signJwt returned no token");

  // 3) Exchange the signed JWT for a Gmail access token for that user.
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(`Gmail delegation failed for ${key}: ${j.error || r.status} ${j.error_description || ""}`.trim());
  }
  cache.set(key, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

/** A Gmail client acting as the given user. */
export async function gmailAs(userEmail: string) {
  const token = await delegatedAccessToken(userEmail);
  const oauth = new google.auth.OAuth2();
  oauth.setCredentials({ access_token: token });
  return google.gmail({ version: "v1", auth: oauth });
}

/**
 * Company-standard signature — mirrors the WiseStamp "My company signature" layout
 * (V-mark · Name / Title, Vehicle Approval Centre · socials · Phone/Mobile/Website/Email/Address).
 * Filled from the rep's record so every rep is consistently branded, no per-rep setup.
 */
export function vacSignatureHtml(rep: { name: string; title?: string | null; phone?: string | null; mobile?: string | null; email: string }) {
  const e = (s: any) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const base = "https://vehicleapprovalcentre.com";
  const label = (t: string) => `<span style="color:#4A57D6;font-weight:700">${t}</span>`;
  const row = (parts: string[]) => `<div style="margin:2px 0;font-size:13px;color:#1f2337;line-height:1.5">${parts.filter(Boolean).join('&nbsp;&nbsp;&nbsp;')}</div>`;
  const icon = (href: string, src: string, alt: string) => `<a href="${href}" style="text-decoration:none;margin-left:6px"><img src="${src}" width="22" height="22" alt="${alt}" style="display:inline-block;border-radius:3px;vertical-align:middle;border:0"></a>`;
  const socials = [
    icon("https://www.facebook.com/vehicleapprovalcentre", `${base}/sig/facebook.png`, "Facebook"),
    icon("https://www.instagram.com/vehicleapprovalcentre", `${base}/sig/instagram.png`, "Instagram"),
    icon("https://www.youtube.com/channel/UCmcQm7uYRQB7mAh2IWDxFAQ", `${base}/sig/youtube.png`, "YouTube"),
    icon("https://ca.linkedin.com/company/vehicle-approval-centre", `${base}/sig/linkedin.png`, "LinkedIn"),
  ].join("");
  // Display phones WiseStamp-style (902.441.4208) regardless of how they're stored (+19024414208, (902) 441-4208…).
  const fmtPhone = (p: any) => { const d = String(p ?? "").replace(/\D/g, ""); const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d; return n.length === 10 ? `${n.slice(0, 3)}.${n.slice(3, 6)}.${n.slice(6)}` : String(p ?? ""); };
  const phones = [rep.phone ? `${label("Phone")} ${e(fmtPhone(rep.phone))}` : "", rep.mobile ? `${label("Mobile")} ${e(fmtPhone(rep.mobile))}` : ""];
  return `
<table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;margin-top:22px">
  <tr>
    <td style="vertical-align:top;padding-right:18px"><img src="${base}/vac-logo-mark.png" width="78" alt="Vehicle Approval Centre" style="display:block;border:0"></td>
    <td style="vertical-align:top">
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:top">
          <div style="font-size:19px;font-weight:700;color:#4A57D6;line-height:1.2">${e(rep.name)}</div>
          <div style="font-size:14px;font-weight:700;color:#1f2337;line-height:1.35">${rep.title ? e(rep.title) + "," : ""}</div>
          <div style="font-size:14px;font-weight:700;color:#1f2337;line-height:1.35">Vehicle Approval Centre</div>
        </td>
        <td style="vertical-align:bottom;padding-left:26px;white-space:nowrap">${socials}</td>
      </tr></table>
      <div style="border-top:2px solid #4A57D6;margin:8px 0 6px;width:100%"></div>
      ${row(phones)}
      ${row([`${label("Website")} <a href="${base}" style="color:#1f2337;text-decoration:none">vehicleapprovalcentre.com</a>`, `${label("Email")} <a href="mailto:${e(rep.email)}" style="color:#1f2337;text-decoration:none">${e(rep.email)}</a>`])}
      ${row([`${label("Address")} Unit 3B - 110 Chain Lake Drive, Halifax, NS B3S 1A9`])}
      <div style="border-top:2px solid #4A57D6;margin:6px 0 0;width:100%"></div>
    </td>
  </tr>
</table>`;
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encHeader = (s: string) => (/[^\x20-\x7e]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=` : s);

/** Send an email AS a user (optional attachments). Returns Gmail message id + threadId. */
export async function sendAs(opts: {
  from: string; fromName?: string; to: string; subject: string; html: string; text?: string;
  inReplyTo?: string; references?: string; threadId?: string;
  attachments?: { filename: string; mimeType: string; data: Buffer }[];
}) {
  const gmail = await gmailAs(opts.from);
  const altB = "vac_alt_" + Math.random().toString(36).slice(2);
  const mixB = "vac_mix_" + Math.random().toString(36).slice(2);
  const fromHdr = opts.fromName ? `${encHeader(opts.fromName)} <${opts.from}>` : opts.from;
  const text = opts.text || opts.html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
  const alt = [
    `--${altB}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    "",
    `--${altB}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(opts.html, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
    "",
    `--${altB}--`,
  ];
  const headers = [
    `From: ${fromHdr}`,
    `To: ${opts.to}`,
    `Subject: ${encHeader(opts.subject)}`,
    "MIME-Version: 1.0",
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`] : []),
    ...(opts.references ? [`References: ${opts.references}`] : []),
  ];
  let lines: string[];
  if (opts.attachments && opts.attachments.length) {
    lines = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixB}"`,
      "",
      `--${mixB}`,
      `Content-Type: multipart/alternative; boundary="${altB}"`,
      "",
      ...alt,
      "",
    ];
    for (const a of opts.attachments) {
      const fn = a.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\r\n]/g, "");   // ASCII-safe name (macOS screenshots carry a narrow no-break space)
      lines.push(
        `--${mixB}`,
        `Content-Type: ${a.mimeType || "application/octet-stream"}; name="${fn}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${fn}"`,
        "",
        a.data.toString("base64").replace(/(.{76})/g, "$1\r\n"),
        "",
      );
    }
    lines.push(`--${mixB}--`);
  } else {
    lines = [...headers, `Content-Type: multipart/alternative; boundary="${altB}"`, "", ...alt];
  }
  const raw = b64url(lines.join("\r\n"));
  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) } });
  return { id: res.data.id || "", threadId: res.data.threadId || "" };
}
