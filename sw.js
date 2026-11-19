// Grateful — minimal service worker.
// It lets Android install the app. It does NOT cache the app, so every
// update you publish shows up straight away. If there's no internet,
// it shows a gentle offline message instead of the browser's error page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // everything else: normal browser behaviour
  event.respondWith(
    fetch(event.request).catch(() => new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Grateful</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'background:#f7f9fc;color:#34405a;font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:24px">' +
      '<div><div style="font-size:40px">🌿</div><h1 style="font-weight:600;font-size:22px">You\'re offline</h1>' +
      '<p style="color:#6b7690">Grateful needs an internet connection. Take a breath — try again in a moment.</p>' +
      '<button onclick="location.reload()" style="margin-top:12px;padding:12px 22px;border:0;border-radius:14px;background:#6f8bc7;color:#fff;font-size:16px">Try again</button>' +
      '</div></body></html>',
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    ))
  );
});

// ---------- Daily reminder notifications ----------
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Grateful", {
    body: data.body || "What's one good thing today? 🌿",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",   // small white leaf in Android's status bar
    tag: "grateful-daily",          // never stacks more than one reminder
    data: { url: data.url || "./" }
  }));
});

// Tapping the notification opens Grateful (or brings it to the front).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
