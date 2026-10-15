/* POP TV — Service Worker do player.
 * 1) guarda o próprio player (HTML/JS/logo/fontes) para abrir mesmo sem internet;
 * 2) serve as mídias guardadas em /tv/media/<chave>, com suporte a Range (necessário para <video>).
 * A API (/api/...) nunca é guardada em cache.
 */
var SHELL = 'pop-shell-v1';
var MEDIA = 'pop-media-v1';
var SHELL_FILES = ['./', 'index.html', 'player.js', 'logo.png', 'poppins-700.woff2', 'poppins-900.woff2'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== MEDIA; }).map(function (k) { return caches['delete'](k); }));
  }).then(function () { return self.clients.claim(); }));
});

function rangeResponse(req, res) {
  var range = req.headers.get('range');
  if (!range) return res;
  var m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return res;
  return res.blob().then(function (blob) {
    var size = blob.size;
    var start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
    var end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1;
    if (start >= size || start > end) return new Response('', { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    return new Response(blob.slice(start, end + 1), {
      status: 206,
      headers: {
        'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
        'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes'
      }
    });
  });
}

self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;           // R2 e outros: direto na rede
  if (url.pathname.indexOf('/api/') === 0) return;           // API: sempre rede

  if (url.pathname.indexOf('/tv/media/') === 0) {
    e.respondWith(caches.open(MEDIA).then(function (c) {
      return c.match(url.pathname).then(function (hit) {
        if (!hit) return new Response('', { status: 404 });  // o player cai para a URL da rede
        return rangeResponse(e.request, hit);
      });
    }));
    return;
  }

  if (url.pathname.indexOf('/tv/') === 0 && e.request.method === 'GET') {
    // rede primeiro (atualizações do player chegam), cache se estiver offline
    e.respondWith(fetch(e.request).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(e.request, copy); }); }
      return res;
    })['catch'](function () {
      return caches.match(e.request).then(function (hit) { return hit || caches.match('index.html'); });
    }));
  }
});
