import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function checkDatabase() {
  console.log("Checking database:", firebaseConfig.firestoreDatabaseId);
  try {
    const querySnapshot = await getDocs(collection(db, 'inventory'));
    console.log("Found", querySnapshot.size, "documents in inventory.");
    querySnapshot.forEach((doc) => {
      console.log(doc.id, " => ", doc.data().make, doc.data().model);
    });
  } catch (error) {
    console.error("Error reading inventory:", error);
  }
}
checkDatabase();
