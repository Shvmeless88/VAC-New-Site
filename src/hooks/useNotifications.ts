import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy, 
  limit,
  updateDoc,
  doc,
  Timestamp
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { toast } from 'sonner';

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'new_lead' | 'status_change';
  leadId?: string;
  isRead: boolean;
  createdAt: Timestamp;
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.currentUser) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', auth.currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newNotifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Notification[];

      setNotifications(newNotifications);
      setUnreadCount(newNotifications.filter(n => !n.isRead).length);
      setLoading(false);

      // Check for new unread notifications to show toast
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as Notification;
          if (!data.isRead && data.createdAt.toMillis() > Date.now() - 10000) {
            toast(data.title, {
              description: data.message,
              action: {
                label: 'View',
                onClick: () => {
                  // Navigation logic could go here if needed
                }
              }
            });
          }
        }
      });
    });

    return () => unsubscribe();
  }, []);

  const markAsRead = async (notificationId: string) => {
    try {
      await updateDoc(doc(db, 'notifications', notificationId), {
        isRead: true
      });
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unread = notifications.filter(n => !n.isRead);
      await Promise.all(unread.map(n => 
        updateDoc(doc(db, 'notifications', n.id), { isRead: true })
      ));
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  return { notifications, unreadCount, loading, markAsRead, markAllAsRead };
}
