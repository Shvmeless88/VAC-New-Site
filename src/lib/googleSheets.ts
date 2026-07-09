import { google } from 'googleapis';
import { initializeApp as initializeClientApp, getApp, getApps } from 'firebase/app';
import { getFirestore as getClientFirestore, collection, getDocsFromServer } from 'firebase/firestore';
import { mapInventoryToFacebookCatalog } from './facebookCatalog';
import firebaseConfig from '../../firebase-applet-config.json';
import dotenv from 'dotenv';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '1WQ8Rq_P2Dii0ceGGCsCHiLeZDAMdynOleqR0X0XmCng';
const TARGET_GID = 1238310575;

export async function syncInventoryToGoogleSheets() {
  console.log('Starting Google Sheets sync (Triggered)...');

  // 1. Initialize Firebase 
  const app = getApps().length === 0 ? initializeClientApp(firebaseConfig) : getApp();
  const db = getClientFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

  // 2. Fetch Inventory
  const inventory: any[] = [];
  const snapshot = await getDocsFromServer(collection(db, 'inventory'));
  snapshot.forEach(doc => {
    inventory.push({ id: doc.id, ...doc.data() });
  });

  if (inventory.length === 0) {
    console.log('No inventory found to sync.');
    return;
  }

  // 3. Map to Facebook Catalog format
  const mappedData = mapInventoryToFacebookCatalog(inventory);

  if (mappedData.length === 0) {
    console.log('No eligible inventory (non-sold) to sync.');
    return;
  }

  // 4. Initialize Google Sheets API
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    throw new Error('Missing Google Sheets credentials');
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // 5. Get Spreadsheet metadata
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
  });

  const sheet = spreadsheet.data.sheets?.find(s => s.properties?.sheetId === TARGET_GID);
  const sheetName = sheet?.properties?.title || 'catalog_vehicles';

  // 6. Prepare data
  const headers = [
    'id', 'title', 'description', 'price', 'image_link', 'link', 'make', 'model', 'year', 'brand',
    'body_style', 'state_of_vehicle', 'mileage.value', 'mileage.unit', 'vin', 'transmission',
    'fuel_type', 'exterior_color', 'condition', 'availability'
  ];

  const values = [
    headers,
    ...mappedData.map(item => [
      item.id, item.title, item.description, item.price, item.image_link, item.link, 
      item.make, item.model, item.year, item.brand, item.body_style, item.state_of_vehicle, 
      item['mileage.value'], item['mileage.unit'], item.vin, item.transmission, 
      item.fuel_type, item.exterior_color, item.condition, item.availability
    ])
  ];

  // 7. Clear and Update
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });

  console.log('Sync completed successfully.');
  return { success: true, count: mappedData.length };
}
