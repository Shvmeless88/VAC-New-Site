import { useState, useEffect } from 'react';
import { auth, db, doc, getDoc, setDoc, updateDoc, onAuthStateChanged, User, serverTimestamp, query, collection, where, getDocs, logout, onSnapshot } from '@/lib/firebase';
import { toast } from 'sonner';

export type UserRole = 'super_admin' | 'general_manager' | 'finance_manager' | 'sales_rep' | 'user';

export function useAdmin() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole>('user');
  const [simulatedRole, setSimulatedRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    let unsubscribeDoc: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = null;
      }

      if (currentUser) {
        setLoading(true);
        // 1. Enforce @drivevac.ca domain
        const email = (currentUser.email || '').toLowerCase();
        if (!email.endsWith('@drivevac.ca')) {
          toast.error('Access restricted to authorized accounts only.');
          await logout();
          setUser(null);
          setRole('user');
          setLoading(false);
          return;
        }

        setUser(currentUser);
        // Check if user is the default admin or authorized staff
        const isDefaultAdmin = email === 'j.jackson@drivevac.ca';
        const isStaffMember = email === 'k.gillespie@drivevac.ca';
        
        const userDocRef = doc(db, 'users', currentUser.uid);
        
        // Use onSnapshot for real-time role updates
        unsubscribeDoc = onSnapshot(userDocRef, async (userDoc) => {
          if (userDoc.exists()) {
            const userRole = userDoc.data().role as UserRole;
            
            // Auto-fix role for default admin if it's somehow wrong in DB
            if (isDefaultAdmin && userRole !== 'super_admin') {
              await updateDoc(userDocRef, { role: 'super_admin' });
              return;
            }

            // Auto-fix role for staff if it's currently 'user'
            if (isStaffMember && userRole === 'user') {
              await updateDoc(userDocRef, { role: 'sales_rep' });
              return;
            }
            
            setRole(userRole);
            setLoading(false);
          } else {
            try {
              // Check for invitations using email as document ID
              const inviteDocRef = doc(db, 'invitations', email);
              const inviteDoc = await getDoc(inviteDocRef);
              
              let inviteData = null;
              let finalInviteRef = inviteDocRef;

              if (inviteDoc.exists() && inviteDoc.data().status === 'pending') {
                inviteData = inviteDoc.data();
              } else {
                // Fallback for legacy auto-generated IDs
                const inviteQuery = query(collection(db, 'invitations'), where('email', '==', email), where('status', '==', 'pending'));
                const inviteSnap = await getDocs(inviteQuery);
                if (!inviteSnap.empty) {
                  inviteData = inviteSnap.docs[0].data();
                  finalInviteRef = doc(db, 'invitations', inviteSnap.docs[0].id);
                }
              }

              if (inviteData || isDefaultAdmin) {
                const assignedRole: UserRole = isDefaultAdmin ? 'super_admin' : (inviteData?.role || 'sales_rep');
                
                // Initialize user in Firestore (either invited or default admin)
                await setDoc(userDocRef, {
                  email: email,
                  role: assignedRole,
                  displayName: currentUser.displayName,
                  isActive: true,
                  isClockedIn: false,
                  weight: 1,
                  leadsReceivedCount: 0,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp()
                });

                // If it was an invitation, mark it as accepted
                if (inviteData) {
                  await updateDoc(finalInviteRef, {
                    status: 'accepted',
                    acceptedAt: serverTimestamp(),
                    uid: currentUser.uid
                  });
                }

                setRole(assignedRole);
              } else {
                // Regular user (not admin, not invited)
                // We still create a profile but with 'user' role
                await setDoc(userDocRef, {
                  email: email,
                  role: 'user',
                  displayName: currentUser.displayName,
                  isActive: true,
                  isClockedIn: false,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp()
                });
                setRole('user');
              }
            } catch (error) {
              console.error('Error checking admin status:', error);
              // Fallback to default admin check if Firestore fails
              if (isDefaultAdmin) {
                setRole('super_admin');
              } else {
                setRole('user');
              }
            } finally {
              setLoading(false);
            }
          }
        }, (error) => {
          console.error('User doc snapshot error:', error);
          if (isDefaultAdmin) {
            setRole('super_admin');
          } else {
            setRole('user');
          }
          setLoading(false);
        });
      } else {
        setUser(null);
        setRole('user');
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeDoc) unsubscribeDoc();
    };
  }, []);

  const isDefaultAdmin = user?.email?.toLowerCase() === 'j.jackson@drivevac.ca';
  const effectiveRole = simulatedRole || (isDefaultAdmin ? 'super_admin' : role);
  const effectiveIsAdmin = ['super_admin', 'general_manager', 'finance_manager', 'sales_rep'].includes(effectiveRole);

  return { 
    user, 
    isAdmin: effectiveIsAdmin, 
    role: effectiveRole, 
    realRole: isDefaultAdmin ? 'super_admin' : role,
    loading, 
    setSimulatedRole 
  };
}
