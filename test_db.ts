import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function test() {
  try {
    const querySnapshot = await getDocs(collection(db, 'inventory'));
    console.log("Success! Docs:", querySnapshot.size);
  } catch (error) {
    console.error("Error reading inventory:", error);
  }
}
test();
