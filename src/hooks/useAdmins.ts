import { useState, useEffect } from 'react';
import { db, collection, query, where, onSnapshot } from '../lib/firebase';

export type AdminRole = 'super_admin' | 'general_manager' | 'finance_manager' | 'sales_rep';

export interface AdminUser {
  id: string;
  email: string;
  displayName?: string;
  role: AdminRole;
  isActive?: boolean;
  weight?: number;
  leadsReceivedCount?: number;
  lastAssignedTimestamp?: any;
}

export function useAdmins() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query(
      collection(db, 'users'),
      where('role', 'in', ['super_admin', 'general_manager', 'finance_manager', 'sales_rep'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const adminsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as AdminUser[];
      
      setAdmins(adminsData);
      setLoading(false);
    }, (err) => {
      console.error('Error fetching admins:', err);
      setError('Failed to load sales team.');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { admins, loading, error };
}
