'use client';

import { create } from 'zustand';
import type { Notification } from '@/types';

interface NotificationStore {
  notifications: Notification[];
  unreadCount: number;
  isOpen: boolean;

  // Actions
  setNotifications: (notifications: Notification[]) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'read' | 'created_at'> & { id?: string; read?: boolean; created_at?: string }) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  togglePanel: () => void;
  setOpen: (open: boolean) => void;
  clearNotifications: () => void;
  removeNotification: (id: string) => void;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isOpen: false,

  setNotifications: (notifications) => {
    const unread = notifications.filter((n) => !n.read).length;
    set({
      notifications: notifications.slice(0, 80),
      unreadCount: unread,
    });
  },

  addNotification: (notification) => {
    const newNotification: Notification = {
      ...notification,
      id: notification.id || Date.now().toString() + Math.random().toString(36).substring(2, 7),
      read: notification.read ?? false,
      created_at: notification.created_at || new Date().toISOString(),
    };

    set((state) => {
      // تجنب التكرار بالـ id
      const existingIdx = state.notifications.findIndex((n) => n.id === newNotification.id);
      let updated: Notification[];
      if (existingIdx >= 0) {
        updated = [...state.notifications];
        updated[existingIdx] = newNotification;
      } else {
        updated = [newNotification, ...state.notifications];
      }
      return {
        notifications: updated.slice(0, 80),
        unreadCount: updated.filter((n) => !n.read).length,
      };
    });
  },

  markAsRead: (id) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      const wasUnread = notification && !notification.read;
      return {
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: wasUnread ? state.unreadCount - 1 : state.unreadCount,
      };
    });
  },

  markAllAsRead: () => {
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  togglePanel: () => {
    set((state) => ({ isOpen: !state.isOpen }));
  },

  setOpen: (open) => {
    set({ isOpen: open });
  },

  clearNotifications: () => {
    set({ notifications: [], unreadCount: 0 });
  },

  removeNotification: (id) => {
    set((state) => {
      const notification = state.notifications.find((n) => n.id === id);
      const wasUnread = notification && !notification.read;
      return {
        notifications: state.notifications.filter((n) => n.id !== id),
        unreadCount: wasUnread ? state.unreadCount - 1 : state.unreadCount,
      };
    });
  },
}));
