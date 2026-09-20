// Retire the legacy cache-first worker: authentication and booking require live data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('krishi-seva-')).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
// Deliberately no fetch handler: never cache Auth, Firestore, Functions or session data.
