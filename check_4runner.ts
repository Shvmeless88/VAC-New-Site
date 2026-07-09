import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkVin() {
  const docRef = doc(db, 'inventory', 'pbWS0SYfMUgwQ4YokbFQ');
  const docSnap = await getDoc(docRef);
  
  if (docSnap.exists()) {
    console.log("Document data:", JSON.stringify(docSnap.data(), null, 2));
  } else {
    console.log("No such document!");
  }
  process.exit(0);
}
checkVin();
