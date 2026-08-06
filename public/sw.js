// Service Worker for Dead Man's Switch Web Push
self.addEventListener('push', (event) => {
  let title = "【Dead Man's Switch】生存確認リマインダー";
  let body = '生存シグナルが途絶えています。生存報告を行ってください。';
  let url = '/checkin';

  if (event.data) {
    try {
      const data = event.data.json();
      if (data.title) title = data.title;
      if (data.body) body = data.body;
      if (data.url) url = data.url;
    } catch {
      try {
        body = event.data.text();
      } catch {
        // fallback
      }
    }
  }

  const options = {
    body: body,
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'dms-warning-notification',
    renotify: true,
    data: { url: url },
  };

  event.waitUntil(
    self.registration.showNotification(title, options),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/checkin';
  event.waitUntil(
    clients.openWindow(targetUrl),
  );
});
