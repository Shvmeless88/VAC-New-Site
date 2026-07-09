import { useState, useEffect } from 'react';
import { db, collection, query, orderBy, onSnapshot, handleFirestoreError, OperationType } from '@/lib/firebase';
import { SoldStory } from '@/types';

export function useSoldStories() {
  const [stories, setStories] = useState<SoldStory[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const path = 'soldStories';
    const q = query(collection(db, path), orderBy('timestamp', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: SoldStory[] = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SoldStory[];
      setStories(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
      setError(err.message);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { stories, loading, error };
}
