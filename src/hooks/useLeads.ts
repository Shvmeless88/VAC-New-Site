import { useState, useEffect } from 'react';
import { db, collection, query, orderBy, onSnapshot, handleFirestoreError, OperationType } from '@/lib/firebase';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  type: 'inquiry' | 'financing';
  status: 'new' | 'day1' | 'day2' | 'day3' | 'not_interested' | 'dnc' | 'bought_elsewhere' | 'archived' | 'contacted' | 'in-progress' | 'closed';
  isDeal?: boolean;
  dealStatus?: 'submitted' | 'approved' | 'agreed' | 'delivery' | 'complete';
  vehicleId?: string;
  assignedTo?: string;
  originalOwner?: string;
  owner?: string;
  labels?: string[];
  notes?: string;
  // Financing quiz fields
  dateOfBirth?: string;
  annualIncome?: string;
  monthlyHousing?: string;
  fullAddress?: string;
  postalCode?: string;
  createdAt: any;
  updatedAt: any;
}

export function useLeads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = 'leads';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const leadsData: Lead[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Lead[];
      setLeads(leadsData);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
      setError(err.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { leads, loading, error };
}
