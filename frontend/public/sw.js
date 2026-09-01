// Minimal Web Push service worker. Registered from
// hooks/usePushSubscription.ts. Kept dependency-free (no Workbox) since
// this app isn't an offline-first PWA — push delivery is the only job.

self.addEventListener("push", (event) => {
  let payload = { title: "HRMS", body: "You have a new notification." };
  try {
    payload = event.data.json();
  } catch {
    // non-JSON payload — fall back to the default above
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "HRMS", {
      body: payload.body,
      icon: "/favicon.ico",
      data: { url: "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsList) => {
      for (const client of clientsList) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
