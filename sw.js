// Offline support, and fast start.
// The app always opens from the copy saved on the phone, without waiting for the
// network (on a cold start the browser can take many seconds before its first
// network request goes out). Meanwhile the latest version is downloaded in the
// background and saved for next time; the page asks whether one arrived, and
// offers a reload.
const CACHE = 'shopping-list-v3';
const FILES = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

let newVersion = Promise.resolve(false); // did the latest app launch find a new version?

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  const nav = req.mode === 'navigate';
  const key = nav ? new URL('./', self.location).href : req.url; // any page URL is the app itself

  const fresh = fetch(key, { cache: 'no-cache' }).then(async (res) => {
    if (!res.ok) return { res, changed: false };
    const old = nav && (await caches.match(key, { ignoreSearch: true }));
    const changed = !!old && (await res.clone().text()) !== (await old.text());
    await (await caches.open(CACHE)).put(key, res.clone());
    return { res, changed };
  });
  if (nav) newVersion = fresh.then((f) => f.changed, () => false);
  e.waitUntil(fresh.catch(() => {}));

  e.respondWith(
    caches.match(key, { ignoreSearch: true }).then((cached) => cached || fresh.then((f) => f.res))
  );
});

self.addEventListener('message', (e) => {
  if (e.data !== 'check') return;
  e.waitUntil(newVersion.then((yes) => { if (yes) e.source.postMessage('updated'); }));
});
