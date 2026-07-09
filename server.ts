import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Resend } from 'resend';
import dotenv from 'dotenv';
import { syncInventoryToGoogleSheets } from './src/lib/googleSheets';

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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Redirect applynow.vehicleapprovalcentre.com to /financing
  app.use((req, res, next) => {
    const host = req.headers.host || "";
    if (host.toLowerCase().startsWith("applynow.vehicleapprovalcentre.com")) {
      return res.redirect(301, "https://vehicleapprovalcentre.com/financing");
    }
    next();
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

      // Generate Application ID: First 4 of last name + 4 random digits
      let applicationId = '';
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

      const leadPayload: any = {
        title: title // Always use the new title, but don't append history
      };

      if (finalPersonId) leadPayload.person_id = finalPersonId;
      if (organization_id) leadPayload.organization_id = organization_id;
      if (value) leadPayload.value = value;
      if (expected_close_date) leadPayload.expected_close_date = expected_close_date;

      // Application ID
      const appIdKey = process.env.PIPEDRIVE_APPLICATION_ID_FIELD_KEY;
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

      // Only create a note if it's a NEW lead OR if it's a final submission
      // This prevents "Note Spam" during the multi-step application process
      const shouldCreateNote = !recentLead || isFinal;

      if (leadId && shouldCreateNote) {
        console.log("Creating note for lead (isUpdate:", !!recentLead, "isFinal:", !!isFinal, "):", leadId);
        try {
          let notePrefix = '';
          if (isTradeIn) {
            notePrefix = recentLead ? '*** COMPLETED TRADE-IN REQUEST ***\n' : '*** NEW TRADE-IN REQUEST ***\n';
          } else {
            notePrefix = recentLead ? '*** COMPLETED FINANCING APPLICATION ***\n' : '*** NEW FINANCING APPLICATION (Started) ***\n';
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
          
          await fetchWithTimeout(`https://api.pipedrive.com/v1/notes?api_token=${apiToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: noteContent,
              lead_id: leadId
            }),
          });
        } catch (noteErr) {
          console.error("Failed to create Pipedrive note:", noteErr);
        }
      }

      res.json({ success: true, isUpdate: !!recentLead, personId: finalPersonId, leadId: leadId });
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

            // Strict Filter
            const ignoreList = ['vin', 'weights', 'dimensions', 'curb', 'chassis', 'suspension', 'warranty', 'axle', 'gvwr', 'capacities'];
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

          // Search common locations for features and equipment
          const searchKeys = [
            'features', 
            'installed_equipment', 
            'high_value_features', 
            'comfort_and_convenience', 
            'entertainment_and_media', 
            'safety_and_security', 
            'standard_features',
            'optional_features',
            'std_features',
            'opt_features',
            'build', 
            'extra', 
            'equipment', 
            'specs'
          ];
          
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

          // Also check for 'features' at the root if it's an array of strings
          if (Array.isArray(itemData.features)) {
            itemData.features.forEach((f: string) => {
              if (typeof f === 'string') mapCategory('features', { description: f });
            });
          }

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
            marketPriceRating: itemData.market_rank_data?.rank_text || itemData.market_rank_data?.rank || (itemData.market_rank_data?.vdp_market_value ? "Fair Price" : undefined),
            marketPriceDifference: itemData.market_rank_data?.diff_from_median || itemData.market_rank_data?.price_diff,
            accidents: itemData.history_data?.accident_count || (itemData.history_data?.has_accidents ? 1 : 0),
            owners: itemData.history_data?.owner_count || itemData.history_data?.owners_count || 1
          };
        };

        // Use NeoVIN exclusively as requested
        const neoResponse = await fetchWithTimeout(`https://api.marketcheck.com/v2/decode/car/neovin/${vin}?api_key=${apiKey}&include_generic=true&include_available_options=true`, {
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

        // Always try to fetch specs to supplement features
        const specResponse = await fetchWithTimeout(`https://mc-api.marketcheck.com/v2/decode/car/${vin}/specs?api_key=${apiKey}&include_generic=true&include_available_options=true`);
        if (specResponse.ok) {
          const specData = await specResponse.json();
          console.log(`Successfully fetched Marketcheck specs for ${vin}`);
          
          // Merge specs into finalData
          finalData = { ...finalData, ...specData };
        }

        // Fetch Market Rank and Price Rating
        try {
          const rankResponse = await fetchWithTimeout(`https://api.marketcheck.com/v2/market/rank/car/${vin}?api_key=${apiKey}`);
          if (rankResponse.ok) {
            const rankData = await rankResponse.json();
            console.log(`Successfully fetched Marketcheck rank for ${vin}`);
            finalData.market_rank_data = rankData;
          }
        } catch (rankErr) {
          console.log("Marketcheck Rank API skip:", rankErr);
        }

        // Fetch History Indicators
        try {
          const historyResponse = await fetchWithTimeout(`https://api.marketcheck.com/v2/history/car/${vin}?api_key=${apiKey}`);
          if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            console.log(`Successfully fetched Marketcheck history for ${vin}`);
            finalData.history_data = historyData;
          }
        } catch (histErr) {
          console.log("Marketcheck History API skip:", histErr);
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
