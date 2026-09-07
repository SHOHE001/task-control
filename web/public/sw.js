// No fetch handler: authenticated pages and APIs are never cached by this worker.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() || {};
  } catch {
    /* use generic text */
  }
  event.waitUntil(
    self.registration.showNotification("今の一手", {
      body:
        typeof data.body === "string"
          ? data.body
          : "ページを開いて、次の一手を確認するところから",
      tag: data.tag || "task-control",
      icon: "/icon-192.png",
      data: {
        url:
          typeof data.url === "string" && data.url.startsWith("/?job=")
            ? data.url
            : "/",
      },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(
      new URL(event.notification.data?.url || "/", self.location.origin).href,
    ),
  );
});
