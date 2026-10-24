/* ============================================================
   ROBO-ADVISOR-P2: Service Worker — دعم الإشعارات في الخلفية
   ============================================================
   - بيسجّل نفسه عشان يقدر يعرض إشعارات حتى لو المتصفح في الخلفية
   - بيستقبل رسائل showNotification من الـ main thread
   ============================================================ */

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// لما المستخدم يضغط على الإشعار، ركّز على التبويب
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});

// رسالة من الـ main thread لعرض إشعار
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, icon } = event.data;
    self.registration.showNotification(title, { body, icon, tag: 'robo-advisor', renotify: true }).catch(() => {});
  }
});
