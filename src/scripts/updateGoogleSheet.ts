import { initializeApp as initializeClientApp } from 'firebase/app';
import { getFirestore as getClientFirestore, collection, getDocsFromServer } from 'firebase/firestore';
import admin from 'firebase-admin';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import { mapInventoryToFacebookCatalog } from '../lib/facebookCatalog';
import firebaseConfig from '../../firebase-applet-config.json';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1WQ8Rq_P2Dii0ceGGCsCHiLeZDAMdynOleqR0X0XmCng';

async function updateGoogleSheet() {
  console.log('Starting Google Sheets sync...');

  // 1. Initialize Firebase 
  // We use the Client SDK for fetching because /inventory is public 'if true'
  // and it avoids Admin SDK permission issues in some environments.
  const app = initializeClientApp(firebaseConfig);
  const db = getClientFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

  // 2. Fetch Inventory
  console.log('Fetching inventory from Firestore (using Client SDK)...');
  const inventory: any[] = [];
  try {
    const snapshot = await getDocsFromServer(collection(db, 'inventory'));
    snapshot.forEach(doc => {
      inventory.push({ id: doc.id, ...doc.data() });
    });
    if (inventory.length > 0) {
      console.log('Sample Doc:', JSON.stringify(inventory[0], null, 2));
    }
  } catch (error: any) {
    console.error('Error fetching inventory:', error.message);
    process.exit(1);
  }

  console.log(`Found ${inventory.length} items in inventory.`);

  // 3. Map to Facebook Catalog format
  const mappedData = mapInventoryToFacebookCatalog(inventory);
  console.log(`Mapped ${mappedData.length} items (filtering out Sold).`);

  if (mappedData.length === 0) {
    console.log('No data to write. Exiting.');
    return;
  }

  // 4. Initialize Google Sheets API
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  // Handle private key potentially containing escaped newlines
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    console.error('Missing Google Sheets credentials (GOOGLE_SHEETS_CLIENT_EMAIL or GOOGLE_SHEETS_PRIVATE_KEY)');
    process.exit(1);
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  try {
    // 5. Get Spreadsheet metadata to find the sheet name for GID 1238310575
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    });

    const targetGid = 1238310575;
    const sheet = spreadsheet.data.sheets?.find(s => s.properties?.sheetId === targetGid);
    const sheetName = sheet?.properties?.title || 'Sheet1';

    console.log(`Targeting sheet: "${sheetName}" (GID: ${targetGid})`);

    // 6. Prepare data for writing
    // Header row
    const headers = [
      'id', 
      'title', 
      'description', 
      'price', 
      'image_link', 
      'link', 
      'make', 
      'model', 
      'year', 
      'brand',
      'body_style', 
      'state_of_vehicle', 
      'mileage.value', 
      'mileage.unit',
      'vin',
      'transmission',
      'fuel_type',
      'exterior_color',
      'condition',
      'availability'
    ];

    const values = [
      headers,
      ...mappedData.map(item => [
        item.id,
        item.title,
        item.description,
        item.price,
        item.image_link,
        item.link,
        item.make,
        item.model,
        item.year,
        item.brand,
        item.body_style,
        item.state_of_vehicle,
        item['mileage.value'],
        item['mileage.unit'],
        item.vin,
        item.transmission,
        item.fuel_type,
        item.exterior_color,
        item.condition,
        item.availability
      ])
    ];

    // 7. Clear the existing sheet content first
    console.log('Clearing existing content...');
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A:Z`,
    });

    // 8. Write the new data
    console.log('Writing new data to Google Sheet...');
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      requestBody: {
        values,
      },
    });

    console.log('Google Sheet updated successfully!');
  } catch (error: any) {
    console.error('Error updating Google Sheet:', error.message);
    if (error.response) {
      console.error('API Error details:', error.response.data);
    }
    process.exit(1);
  }
}

updateGoogleSheet();
