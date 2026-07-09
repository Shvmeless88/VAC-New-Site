import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, collection, getDocs, query, where } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const vin = '2T3B1RFV0MC206032';

async function checkThumbnail() {
  const q = query(collection(db, 'inventory'), where('vin', '==', vin));
  const querySnapshot = await getDocs(q);
  
  if (querySnapshot.empty) {
    console.log("Vehicle not found.");
    return;
  }
  
  const docRef = querySnapshot.docs[0];
  const data = docRef.data();
  console.log("Found:", docRef.id, data.make, data.model);
  console.log("Current images:", data.images);
}
checkThumbnail();
