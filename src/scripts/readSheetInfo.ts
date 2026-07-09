import { google } from 'googleapis';
import dotenv from 'dotenv';
dotenv.config();

const SPREADSHEET_ID = '1g0TyWK9fU4AgADxwRALBGUa1uVAqwSAUzwe-sb6Shbw';

async function readSheetInfo() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!clientEmail || !privateKey) {
    console.error('Missing Google Sheets credentials');
    return;
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  try {
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const targetSheet = spreadsheet.data.sheets?.find(s => s.properties?.title === 'Issue report');
    if (targetSheet) {
      console.log(`\nReading Issue Report: ${targetSheet.properties?.title}`);
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${targetSheet.properties?.title}!A1:H100`,
      });
      console.log('Issues:');
      response.data.values?.slice(1).forEach((row, i) => {
        if (row.length > 0) {
           console.log(`Row ${i+2}: ${row[4]} - ${row[5]}`);
        }
      });
    }
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

readSheetInfo();
