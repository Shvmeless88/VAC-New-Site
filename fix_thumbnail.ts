import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

const vin = '2T3B1RFV0MC206032';

async function fixThumbnail() {
  console.log("Looking for vehicle with VIN:", vin);
  
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
  
  // Apply fix: append ?v=1 to the first image if it's a sirv URL and doesn't have it
  if (data.images && data.images.length > 0) {
    let images = [...data.images];
    if (!images[0].includes('?v=')) {
        images[0] = images[0] + '?v=' + Date.now();
        await updateDoc(doc(db, 'inventory', docRef.id), { images });
        console.log("Updated images:", images);
    } else {
        // Increment version
        const parts = images[0].split('?v=');
        images[0] = parts[0] + '?v=' + Date.now();
        await updateDoc(doc(db, 'inventory', docRef.id), { images });
        console.log("Updated images (version incremented):", images);
    }
  }
}
fixThumbnail();
