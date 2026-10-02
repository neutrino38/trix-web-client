/*
 * Trix's service worker. Two jobs, and the first one comes first:
 *
 * 1. **Show a notification when the page no longer can** (ADR 0006, D2 bis).
 *    A plain `new Notification(...)` is not displayed on the spot: the engine
 *    prepares its resources and **posts a task** that will do the display —
 *    and the page's task queues are exactly what freezing suspends. A
 *    notification raised from the `freeze` handler therefore never shows up.
 *    The service worker lives in its own context, which is not frozen with
 *    the page: it is the only place the alert can still leave from.
 *
 * 2. **Keep the whole client in the browser's cache**, so that Trix loads
 *    without the network. Every file of the build is cached at install;
 *    `config.json` joins them on its first successful fetch.
 *
 * The cache never decides which version the person runs. Pages (`index.html`,
 * `share_account.html`) and `config.json` go to the **network first**, and
 * the cached copy only answers when the server cannot — offline, or too slow
 * to answer. A reachable server therefore always serves today's Trix, and
 * today's deployment configuration. Only the files under `assets/` are served
 * from the cache first: their names carry a hash of their content, so a
 * cached copy cannot be stale.
 *
 * A failed precache never costs the notifications: install succeeds whatever
 * the network does, and a file that could not be cached is merely fetched
 * again later.
 *
 * Nothing to do with SIP push (RFC 8599): no Web Push subscription, no server
 * to warn, no message from outside. Only the page talks to it.
 */

/**
 * What to cache, written by the build (`build/precache.ts`): the build's
 * files, relative to the scope, and a version derived from their content.
 * Each build that changes a file changes this script too, which is how the
 * browser learns that there is a new version to install.
 *
 * `null` under `vite dev`: nothing is cached, and the dev server stays in
 * charge of every request.
 */
const PRECACHE = /*__TRIX_PRECACHE__*/ null;

/** Every cache this worker owns starts with this prefix; the others are not ours to delete. */
const CACHE_PREFIX = "trix-";
const CACHE = PRECACHE ? `${CACHE_PREFIX}${PRECACHE.version}` : null;

/**
 * How long a network-first request waits before the cached copy answers.
 * Long enough for a slow but working connection, short enough that a dead
 * one (captive portal, a train in a tunnel) does not leave a blank page.
 */
const NETWORK_TIMEOUT_MS = 4000;

/**
 * How every lookup is made. `ignoreVary`: the copy cached at install was
 * fetched without the headers the page's own requests carry — a module
 * script sends `Origin`, and a server answering `Vary: Origin` (`vite
 * preview`) or `Vary: Accept-Encoding` (Apache's mod_deflate) would make
 * every lookup miss. Our files do not vary on any of them.
 */
const MATCH = { ignoreVary: true };

/** Fetched at install on top of the build's files, absent or not. */
const OPTIONAL = ["config.json"];

// Take over right away: otherwise a freshly installed service worker would
// only control the page from the next load on — and the first freeze would
// be the very one we could not report.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  if (CACHE) event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([self.clients.claim(), CACHE ? dropOldCaches() : null]));
});

/**
 * Caches every file of the build, one by one. `allSettled` rather than
 * `cache.addAll`: a single missing file would fail the whole install, and
 * with it the notifications, which have nothing to do with the cache.
 *
 * `cache: "no-cache"` revalidates against the server: an `index.html` that
 * the HTTP cache still holds from yesterday must not become the offline copy.
 */
async function precache() {
  const cache = await caches.open(CACHE);
  const paths = [...PRECACHE.files, ...OPTIONAL];
  const results = await Promise.allSettled(
    paths.map(async (path) => {
      const res = await fetch(scoped(path), { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await cache.put(scoped(path), res);
    }),
  );
  results.forEach((r, i) => {
    const path = paths[i];
    if (r.status === "rejected" && !OPTIONAL.includes(path)) {
      console.warn(`[trix sw] not cached: ${path}`, r.reason);
    }
  });
}

/** Removes the caches of the previous versions of Trix, and only those. */
async function dropOldCaches() {
  const names = await caches.keys();
  await Promise.all(
    names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE).map((n) => caches.delete(n)),
  );
}

/** A path from the manifest, as an absolute URL within this worker's scope. */
function scoped(path) {
  return new URL(path, self.registration.scope).href;
}

self.addEventListener("fetch", (event) => {
  if (!CACHE) return;
  const req = event.request;
  // Only our own files. The WebSocket to the SIP proxy never comes through
  // here, and nothing else cross-origin is ours to cache.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !req.url.startsWith(self.registration.scope)) return;
  // The browser fetches the worker itself, outside of us.
  if (url.href === scoped("sw.js")) return;

  if (url.href.startsWith(scoped("assets/"))) {
    event.respondWith(cacheFirst(req));
  } else {
    event.respondWith(networkFirst(event, cacheKey(req, url)));
  }
});

/**
 * Where a request is kept. A navigation to the scope's root is `index.html`;
 * the query string of a page is dropped, a link to Trix can carry one and the
 * page served is the same. (A shared account travels in the fragment, which
 * never reaches the network nor the cache.)
 */
function cacheKey(req, url) {
  if (req.mode !== "navigate") return req.url;
  const page = new URL(url.pathname, url.origin);
  return page.href === self.registration.scope ? scoped("index.html") : page.href;
}

/** Hashed assets: the cached copy is the right one by construction. */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, MATCH);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

/**
 * The server's answer when it gives one in time, kept for the day it will
 * not; the cached copy otherwise. A server that answers late still refreshes
 * the cache for the next load.
 *
 * Only a successful answer replaces the cached copy: a 404 on `config.json`
 * or a 502 from a proxy in maintenance must not wipe out the copy that works.
 */
async function networkFirst(event, key) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(async (res) => {
    if (res.ok) await cache.put(key, res.clone());
    return res;
  });
  // the worker must outlive the cached answer long enough for the late one
  // to fill the cache; its failure, offline, is not an error
  event.waitUntil(network.catch(() => {}));

  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch {
    // offline: the cached copy, if any, answers below
  }
  const hit = await cache.match(key, MATCH);
  if (hit) return hit;
  // nothing cached: wait for the network after all, and let it fail if it must
  return network;
}

/**
 * The only message the page sends. `close` clears whatever already carries
 * this tag — `reachability.ts` needs that to take back a `requireInteraction`
 * alert that has become false, even when the page that raised it is gone (D8).
 */
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.kind !== "trix:notify") return;
  event.waitUntil(handle(msg));
});

async function handle(msg) {
  if (msg.close) {
    const open = await self.registration.getNotifications({ tag: msg.tag });
    for (const note of open) note.close();
  }
  if (!msg.title) return;
  await self.registration.showNotification(msg.title, {
    body: msg.body,
    tag: msg.tag,
    requireInteraction: msg.keep === true,
    // the sound, when there is one, is the application's
    silent: true,
  });
}

// Clicking the alert brings back **the Trix tab that already exists**, and
// no other.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(backToTrix());
});

/**
 * Resume the original tab, and never open a second one.
 *
 * `clients.matchAll` sees the live tabs, frozen ones included: `focus()`
 * thaws them and brings them to the front, which is exactly what the click
 * asks for. A **discarded** tab, however, is no longer a client — it still
 * sits in the tab strip, and a click on it reloads it.
 *
 * Hence the rule: when no tab can be resumed, open nothing. `openWindow()`
 * would create a **second** Trix — a second registration and a second
 * contact at the registrar (D4 tolerates it, but nobody asks for it by
 * clicking "come back to Trix") — and the first one would stay there, next
 * to it, impossible to tell apart. Doing nothing is less useful, but it is
 * not wrong.
 */
async function backToTrix() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) {
    if (typeof client.focus !== "function") continue;
    try {
      await client.focus();
      return;
    } catch (err) {
      // this one cannot be brought back (window closed in the meantime,
      // page on its way out): next
      console.warn("[trix sw] tab cannot be resumed", err);
    }
  }
  console.warn(`[trix sw] no Trix tab to resume (${windows.length} client(s))`);
}
