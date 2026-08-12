var CACHE_NAME = "flashcards-v67";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./fonts/roboto-latin.woff2",
  "./fonts/roboto-latin-ext.woff2",
  "./fonts/roboto-cyrillic.woff2",
  "./fonts/roboto-cyrillic-ext.woff2"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// These small text files determine the app's actual behavior/appearance -
// GitHub Pages serves everything with Cache-Control: max-age=600, and a
// default fetch() is allowed to reuse the browser's own HTTP cache within
// that window even on a genuine relaunch of the installed home-screen app
// (which is the primary target here, not just a browser tab), so these
// always bypass it. Icons/manifest change rarely and are heavier, so they
// stay on normal caching to keep ordinary loads fast. Built from the
// worker's own registration scope rather than a hardcoded path so this
// doesn't silently break if the repo/hosting path ever changes.
var ALWAYS_FRESH_URLS = ["", "index.html", "app.js", "styles.css"].map(function (p) {
  return new URL(p, self.registration.scope).href;
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var forceFresh = event.request.mode === "navigate" ||
    ALWAYS_FRESH_URLS.indexOf(event.request.url) !== -1;
  var fetchOptions = forceFresh ? { cache: "reload" } : undefined;

  event.respondWith(
    fetch(event.request, fetchOptions).then(function (response) {
      if (response && response.status === 200) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
