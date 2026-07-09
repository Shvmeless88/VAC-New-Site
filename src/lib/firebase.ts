import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, Timestamp, getDocFromServer, setDoc, serverTimestamp, increment, limit, deleteField } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
// Note: firestoreDatabaseId is used for named databases
console.log("Initializing Firestore with DB ID:", firebaseConfig.firestoreDatabaseId);
const databaseId = firebaseConfig.firestoreDatabaseId || "(default)";
console.log("Using databaseId:", databaseId);
export const db = getFirestore(app, databaseId);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Auth Helpers
export const loginWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result;
  } catch (error: any) {
    console.error('Firebase Auth Error:', error.code, error.message);
    if (error.code === 'auth/popup-blocked') {
      throw new Error('Sign-in popup was blocked by your browser. Please allow popups for this site.');
    }
    throw error;
  }
};
export const logout = () => signOut(auth);

// Types
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const originalMessage = error instanceof Error ? error.message : String(error);
  const isQuotaError = originalMessage.includes('Quota limit exceeded') || originalMessage.includes('quota-exhausted') || originalMessage.includes('resource-exhausted');
  
  const errInfo: FirestoreErrorInfo = {
    error: isQuotaError ? "QUOTA_EXCEEDED: Your daily free database limits have been reached. The site will resume full functionality automatically within 24 hours. Consider upgrading to the Blaze plan for unlimited access." : originalMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  
  const jsonError = JSON.stringify(errInfo);
  console.error('Firestore Error: ', jsonError);
  
  // We throw the JSON string as required by the system instructions
  throw new Error(jsonError);
}

// Connection Test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}
testConnection();

// Smart Lead Distribution (Weighted Round Robin)
export async function assignLeadRoundRobin(): Promise<string | null> {
  try {
    // 1. Get all active and clocked-in users
    const adminsQuery = query(
      collection(db, 'users'),
      where('isActive', '==', true),
      where('isClockedIn', '==', true),
      where('role', 'in', ['super_admin', 'general_manager', 'finance_manager', 'sales_rep'])
    );
    const adminsSnapshot = await getDocs(adminsQuery);
    const activeAdmins = adminsSnapshot.docs.map(doc => ({
      uid: doc.id,
      ...doc.data() as any
    }));

    if (activeAdmins.length === 0) {
      console.warn('No active admins found for round robin assignment.');
      return null;
    }

    // 2. Find the admin who is "due" for a lead
    // Logic: Pick the one with the lowest (leadsReceivedCount / weight)
    // If tied, pick the one with the oldest lastAssignedTimestamp
    const sortedAdmins = [...activeAdmins].sort((a, b) => {
      const weightA = a.weight || 1;
      const weightB = b.weight || 1;
      const countA = a.leadsReceivedCount || 0;
      const countB = b.leadsReceivedCount || 0;
      
      const ratioA = countA / weightA;
      const ratioB = countB / weightB;

      if (ratioA !== ratioB) {
        return ratioA - ratioB;
      }

      // Tie-breaker: oldest assignment first
      const timeA = a.lastAssignedTimestamp?.toMillis() || 0;
      const timeB = b.lastAssignedTimestamp?.toMillis() || 0;
      return timeA - timeB;
    });

    const assignedAdmin = sortedAdmins[0];

    // 3. Update the admin's stats
    const adminRef = doc(db, 'users', assignedAdmin.uid);
    await updateDoc(adminRef, {
      leadsReceivedCount: increment(1),
      lastAssignedTimestamp: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    // 4. Update global settings (for audit/tracking)
    const settingsRef = doc(db, 'settings', 'roundRobin');
    await setDoc(settingsRef, {
      lastAssignedAdminId: assignedAdmin.uid,
      updatedAt: serverTimestamp()
    }, { merge: true });

    return assignedAdmin.uid;
  } catch (error) {
    console.error('Error in smart lead distribution:', error);
    return null;
  }
}

export async function toggleShiftStatus(userId: string, isClockedIn: boolean) {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      isClockedIn,
      lastShiftToggle: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
  }
}

export async function claimLead(leadId: string, userId: string) {
  try {
    const leadRef = doc(db, 'leads', leadId);
    await updateDoc(leadRef, {
      assignedTo: userId,
      status: 'contacted', // Move to contacted when claimed
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp()
    });
    
    // Update admin stats
    const adminRef = doc(db, 'users', userId);
    await updateDoc(adminRef, {
      leadsReceivedCount: increment(1),
      lastAssignedTimestamp: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `leads/${leadId}`);
  }
}

export async function promoteToDeal(leadId: string) {
  try {
    const leadRef = doc(db, 'leads', leadId);
    await updateDoc(leadRef, {
      isDeal: true,
      status: 'contacted',
      updatedAt: serverTimestamp(),
      lastActivityAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `leads/${leadId}`);
  }
}

export { collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, onSnapshot, Timestamp, onAuthStateChanged, setDoc, serverTimestamp, increment, limit, ref, uploadBytes, getDownloadURL, deleteObject, deleteField, app };
export type { User };
