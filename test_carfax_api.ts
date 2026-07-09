import dotenv from 'dotenv';
import { Car } from './src/types';
dotenv.config();

async function testCarfax() {
  const vin = 'JTENU5JR2R6288159';
  const clientId = process.env.CARFAX_CLIENT_ID;
  const clientSecret = process.env.CARFAX_CLIENT_SECRET;
  const accountNumber = process.env.CARFAX_ACCOUNT_NUMBER;

  console.log("Config check:");
  console.log("Client ID:", clientId ? 'OK' : 'MISSING');
  console.log("Client Secret:", clientSecret ? 'OK' : 'MISSING');
  console.log("Account Number:", accountNumber ? 'OK' : 'MISSING');

  if (!clientId || !clientSecret || !accountNumber) {
    console.error("Missing credentials");
    process.exit(1);
  }

  try {
    console.log("Attempting to get token...");
    const tokenResponse = await fetch('https://20.175.216.5/connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Host': 'identity.carfax.ca'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Token failure:", tokenResponse.status, await tokenResponse.text());
      process.exit(1);
    }

    const tokenData: any = await tokenResponse.json();
    const token = tokenData.access_token;
    console.log("Token obtained successfully");

    console.log(`Checking report for VIN: ${vin} and Account: ${accountNumber}`);
    const reportResponse = await fetch(`https://api.carfax.ca/v1/partners/car-details/report-info?vin=${vin}&accountNumber=${accountNumber}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log("Report response status:", reportResponse.status);
    const reportData = await reportResponse.text();
    console.log("Report response data:", reportData);

  } catch (err: any) {
    console.error("Error during test:", err);
    if (err.cause) console.error("Cause:", err.cause);
  }
}

testCarfax();
