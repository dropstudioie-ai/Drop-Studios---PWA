/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, matchPrecache } from 'workbox-precaching';
import { NavigationRoute, registerRoute, setCatchHandler } from 'workbox-routing';
import { NetworkFirst, NetworkOnly } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// App shell for client-side routes.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/auth\//] }));

// Public timetable/catalogue reads: network first, fall back to the last copy
// so the timetable can still be viewed offline.
registerRoute(
  ({ url, request }) =>
    request.method === 'GET' &&
    url.pathname.startsWith('/rest/v1/') &&
    /\/rest\/v1\/(class_sessions|dance_styles|instructors|membership_plans|app_settings)/.test(url.pathname),
  new NetworkFirst({
    cacheName: 'drop-catalogue',
    networkTimeoutSeconds: 5,
    plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 7 * 24 * 3600 })],
  }),
);

// Never cache personal data, auth, RPCs (bookings) or payment functions.
registerRoute(({ url }) => /\/(auth|functions)\/v1\/|\/rest\/v1\/rpc\//.test(url.pathname), new NetworkOnly(), 'POST');
registerRoute(({ url }) => /\/(auth|functions)\/v1\//.test(url.pathname), new NetworkOnly());

setCatchHandler(async ({ request }) => {
  if (request.destination === 'document') {
    return (await matchPrecache('offline.html')) ?? Response.error();
  }
  return Response.error();
});

// ---- Push notifications (groundwork) -------------------------------------
self.addEventListener('push', (event) => {
  const data = (() => {
    try { return event.data?.json() ?? {}; } catch { return { body: event.data?.text() }; }
  })() as { title?: string; body?: string; url?: string };
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Drop Studios', {
      body: data.body ?? '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-72.png',
      data: { url: data.url ?? '/account' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const existing = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) return existing.navigate(url).then((w) => w?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
