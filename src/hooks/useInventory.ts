import { useState, useEffect } from 'react';
import { db, collection, query, orderBy, onSnapshot, handleFirestoreError, OperationType } from '@/lib/firebase';
import { Car } from '@/types';

export function useInventory() {
  const [inventory, setInventory] = useState<Car[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = 'inventory';
    const q = query(collection(db, path), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const oneWeekInMs = 7 * 24 * 60 * 60 * 1000;
      
      const cars: Car[] = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          price: data.price
        };
      }) as Car[];
      
      setInventory(cars);
      setLoading(false);
    }, (err) => {
      setError(err.message);
      setLoading(false);
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (e) {
        // We log the error but swallow the throw here to prevent the UI from crashing
        // since we've already set the error state for the UI to handle.
        console.error("Diagnostic error caught:", e);
      }
    });

    return () => unsubscribe();
  }, []);

  return { inventory, loading, error };
}
