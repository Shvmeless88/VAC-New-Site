import { useState, useEffect } from 'react';
import { db, collection, query, where, onSnapshot, orderBy } from '../lib/firebase';

export interface Invitation {
  id: string;
  email: string;
  role: 'super_admin' | 'general_manager' | 'finance_manager' | 'sales_rep' | 'user';
  status: 'pending' | 'accepted' | 'expired';
  invitedBy: string;
  createdAt: any;
  acceptedAt?: any;
  uid?: string;
}

export function useInvitations() {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'invitations'),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invitesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Invitation[];
      
      setInvitations(invitesData);
      setLoading(false);
    }, (err) => {
      console.error('Error fetching invitations:', err);
      setError('Failed to load invitations.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { invitations, loading, error };
}
