// Lets people share a product photo from another app (gallery, browser, shopping app) into Drape.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'POST' || !url.pathname.endsWith('/share')) return;
  e.respondWith((async () => {
    const form = await e.request.formData();
    const file = form.get('image');
    const text = ['title', 'text', 'url'].map(k => form.get(k)).filter(Boolean).join(' ');
    const cache = await caches.open('drape-share');
    if (file && file.size) await cache.put('shared-image', new Response(file, { headers: { 'content-type': file.type || 'image/jpeg' } }));
    if (text) await cache.put('shared-text', new Response(text));
    return Response.redirect(new URL('./?shared=1', self.registration.scope).href, 303);
  })());
});
