// Service Worker for Dead Man's Switch Web Push
self.addEventListener('push', (event) => {
  let body = 'アクティビティの更新が確認されていません。生存確認を行ってください。';
  if (event.data) {
    try {
      body = event.data.text();
    } catch (e) {
      // fallback
    }
  }

  const options = {
    body: body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'dms-warning-notification',
    renotify: true,
  };

  event.waitUntil(
    self.registration.showNotification('【Dead Man\'s Switch】生存確認リマインダー', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/checkin')
  );
});
