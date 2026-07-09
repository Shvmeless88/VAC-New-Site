import { initializeApp } from 'firebase/app';
import { getFirestore, doc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore';
import * as fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const vin = '2T3B1RFV0MC206032';
const images = [
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/0.jpg?v=' + Date.now(),
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1.jpeg',
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036789.jpeg',
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036788.jpeg',
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036787.jpeg',
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036784.jpeg',
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036785.jpeg',
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036786.jpeg',
    'https://vologous.sirv.com/2T3B1RFV0MC206032/2T3B1RFV0MC206032/2T3B1RFV0MC206032/1000036783.jpeg'
];

async function restoreImages() {
  console.log("Restoring images for VIN:", vin);
  console.log("Database ID:", db.type);
  const q = query(collection(db, 'inventory'), where('vin', '==', vin));
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    console.error("Vehicle not found.");
    return;
  }
  const docRef = querySnapshot.docs[0];
  await updateDoc(doc(db, 'inventory', docRef.id), { images });
  console.log("Images restored for:", docRef.id);
}
restoreImages();
