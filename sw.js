/* =========================================================================
 * NTトレーニングメニュー  Service Worker
 *
 *  - App Shell（HTML/CSS/JS/アイコン/manifest/offline.html）
 *      → Stale While Revalidate
 *  - メニューデータ（data/training-data.json）
 *      → Network First（取得失敗時のみキャッシュへ）
 *
 *  自オリジン以外（YouTube等）のリクエストには一切介入しない。
 *  skipWaiting() は画面の［更新する］が押されたときだけ実行する。
 * ========================================================================= */
'use strict';

var CACHE_VERSION = 'tramp-training-v1';
var SHELL_CACHE = CACHE_VERSION + '-shell';
var DATA_CACHE  = CACHE_VERSION + '-data';

/* すべて sw.js からの相対パス。サブディレクトリ配信でも正しく解決される。 */
var SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './offline.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

var DATA_PATH = new URL('./data/training-data.json', self.location.href).href;
var INDEX_URL = new URL('./index.html', self.location.href).href;
var OFFLINE_URL = new URL('./offline.html', self.location.href).href;

/* ---------------------------------------------------------------- install */

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    var cache = await caches.open(SHELL_CACHE);
    // 1件でも失敗したら全部やり直しになる addAll は避け、個別に入れる
    await Promise.all(SHELL_ASSETS.map(function (path) {
      return cache.add(new Request(path, { cache: 'reload' })).catch(function (err) {
        console.warn('[sw] キャッシュできませんでした: ' + path, err);
      });
    }));

    // メニューデータも初回に確保しておく（失敗しても install は成功させる）
    try {
      var dataCache = await caches.open(DATA_CACHE);
      await dataCache.add(new Request(DATA_PATH, { cache: 'reload' }));
    } catch (err) {
      console.warn('[sw] メニューデータの初回キャッシュに失敗しました。', err);
    }
    // skipWaiting() はここでは呼ばない（閲覧中に強制切り替えしないため）
  })());
});

/* --------------------------------------------------------------- activate */

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    var names = await caches.keys();
    await Promise.all(names.map(function (name) {
      if (name.indexOf(CACHE_VERSION + '-') === 0) return Promise.resolve();
      return caches.delete(name);
    }));
    // clients.claim() は呼ばない。次回起動時から新しいSWが担当する。
  })());
});

/* ---------------------------------------------------------------- message */

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* ------------------------------------------------------------------ fetch */

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 自オリジン以外（YouTube / ytimg / googlevideo 等）には一切介入しない
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigate(req));
    return;
  }

  if (url.href.split('?')[0] === DATA_PATH) {
    event.respondWith(networkFirst(req));
    return;
  }

  event.respondWith(staleWhileRevalidate(req));
});

/* ---------------------------------------------------------------- 戦略 */

async function handleNavigate(request) {
  var cache = await caches.open(SHELL_CACHE);

  // App Shell は Stale While Revalidate：まずキャッシュを返し、裏で更新する
  var cached = (await cache.match(request)) || (await cache.match(INDEX_URL));

  var networkPromise = fetch(request).then(function (res) {
    if (res && res.ok) cache.put(INDEX_URL, res.clone());
    return res;
  }).catch(function () { return null; });

  if (cached) return cached;

  var fresh = await networkPromise;
  if (fresh) return fresh;

  var offline = await cache.match(OFFLINE_URL);
  if (offline) return offline;

  return new Response(
    '<!doctype html><meta charset="utf-8"><p>オフラインのため表示できません。</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/** メニューデータ：必ず通信を優先し、失敗したときだけキャッシュを使う */
async function networkFirst(request) {
  var cache = await caches.open(DATA_CACHE);
  try {
    var res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    var cached = await cache.match(request) || await cache.match(DATA_PATH);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
    );
  }
}

/** App Shell：キャッシュを即返し、裏で最新に差し替える */
async function staleWhileRevalidate(request) {
  var cache = await caches.open(SHELL_CACHE);
  var cached = await cache.match(request);

  var networkPromise = fetch(request).then(function (res) {
    if (res && res.ok && res.type === 'basic') cache.put(request, res.clone());
    return res;
  }).catch(function () { return null; });

  if (cached) return cached;

  var fresh = await networkPromise;
  if (fresh) return fresh;

  return new Response('', { status: 504, statusText: 'offline' });
}
