// Service Worker for Dead Man's Switch Web Push
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.text() : 'Dead Man\'s Switch Notification';
  event.waitUntil(
    self.registration.showNotification('Dead Man\'s Switch', {
      body: data,
      icon: '/favicon.ico',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/checkin')
  );
});
