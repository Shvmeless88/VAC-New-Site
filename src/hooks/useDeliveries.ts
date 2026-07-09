import { useState, useEffect } from 'react';
import { db, collection, query, orderBy, onSnapshot, handleFirestoreError, OperationType } from '@/lib/firebase';
import { Delivery } from '@/types';

export function useDeliveries() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = 'deliveries';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Delivery[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Delivery[];
      setDeliveries(data);
      setLoading(false);
    }, (err) => {
      setError(err.message);
      setLoading(false);
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        console.error("Diagnostic error caught:", e);
      }
    });

    return () => unsubscribe();
  }, []);

  return { deliveries, loading, error };
}
