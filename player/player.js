/* POP TV — player das Smart TVs.
 * ES5 puro, sem build e sem dependências: precisa rodar em navegadores antigos de TV.
 * Responsabilidade única: parear, receber o manifesto, guardar mídia quando possível e tocar em loop.
 */
(function () {
  'use strict';

  var API = '/api/player/';
  var LOAD_TIMEOUT = 15000;      // item que não carrega em 15 s é pulado
  var STALL_TIMEOUT = 20000;     // vídeo parado sem avançar
  var MAX_VIDEO_MS = 30 * 60000; // trava de segurança
  var CACHE = 'pop-media-v1';
  var bootAt = Date.now();

  // ---------------- utilidades seguras ----------------
  function $(id) { return document.getElementById(id); }
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* sem storage */ } }
  };
  function log(msg) { try { console.log('[POP TV] ' + msg); } catch (e) { /* sem console */ } }

  function xhr(method, url, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    x.open(method, url, true);
    x.timeout = 20000;
    x.setRequestHeader('Content-Type', 'application/json');
    var token = store.get('pop_token') || mem.token;
    if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || done) return;
      done = true;
      var json = null;
      try { json = JSON.parse(x.responseText); } catch (e) { /* vazio */ }
      cb(x.status === 0 ? 'rede' : null, x.status, json);
    };
    x.ontimeout = function () { if (!done) { done = true; cb('tempo', 0, null); } };
    x.send(body ? JSON.stringify(body) : '{}');
  }

  // ---------------- detecção de capacidades ----------------
  function detect() {
    var v = document.createElement('video');
    var can = function (t) { try { return v.canPlayType(t) || 'no'; } catch (e) { return 'no'; } };
    var webp = false;
    try { webp = document.createElement('canvas').toDataURL('image/webp').indexOf('data:image/webp') === 0; } catch (e) { /* */ }
    var c = {
      ua: navigator.userAgent,
      screen: (window.screen ? screen.width + 'x' + screen.height : '?') + ' @' + (window.devicePixelRatio || 1),
      viewport: window.innerWidth + 'x' + window.innerHeight,
      h264: can('video/mp4; codecs="avc1.42E01E"'),
      h264_high: can('video/mp4; codecs="avc1.640028"'),
      hevc: can('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      webp: webp,
      localStorage: store.set('pop_test', '1'),
      promise: typeof window.Promise === 'function',
      cacheApi: typeof window.caches !== 'undefined',
      serviceWorker: !!(navigator.serviceWorker),
      swActive: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      secure: !!window.isSecureContext,
      fullscreen: !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen),
      objectFit: 'objectFit' in document.documentElement.style,
      version: 'player-1.0.0'
    };
    c.minimumOk = c.h264 !== 'no';
    c.offlineCache = c.cacheApi && c.serviceWorker && c.promise && c.secure;
    return c;
  }
  var caps = detect();
  var capsSentAt = 0;
  var mem = { token: null }; // credencial em memória quando o localStorage não funciona (o cookie também vale)

  // ---------------- Service Worker (cache do app e das mídias) ----------------
  var swReady = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  if (caps.serviceWorker && caps.secure) {
    try {
      navigator.serviceWorker.register('sw.js', { scope: './' }).then(function () {
        swReady = swReady || !!navigator.serviceWorker.controller;
        navigator.serviceWorker.addEventListener('controllerchange', function () { swReady = true; caps.swActive = true; });
      })['catch'](function (e) { log('SW indisponível: ' + e); });
    } catch (e) { log('SW indisponível'); }
  }

  var cached = {}; // key → true quando já está no Cache API
  function mediaKeyUrl(it) { return '/tv/media/' + it.key; }
  function srcFor(it) { return (swReady && cached[it.key]) ? mediaKeyUrl(it) : it.url; }

  /** baixa para o cache os itens que faltam, um por vez (protege memória e banda); cb quando terminar */
  function precache(items, cb) {
    if (!caps.offlineCache) { cb(); return; }
    var i = 0;
    var open = window.caches.open(CACHE);
    function next() {
      if (i >= items.length) { cb(); return; }
      var it = items[i++];
      open.then(function (cache) {
        return cache.match(mediaKeyUrl(it)).then(function (hit) {
          if (hit) { cached[it.key] = true; return; }
          return fetch(it.url, { mode: 'cors', credentials: 'omit' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return cache.put(mediaKeyUrl(it), res).then(function () { cached[it.key] = true; });
          });
        });
      })['catch'](function (e) { reportError('Não foi possível guardar "' + it.name + '" no cache: ' + e.message); })
        .then(next, next);
    }
    next();
  }

  function pruneCache(items) {
    if (!caps.offlineCache) return;
    var keep = {};
    for (var i = 0; i < items.length; i++) keep[mediaKeyUrl(items[i])] = true;
    window.caches.open(CACHE).then(function (cache) {
      return cache.keys().then(function (reqs) {
        for (var j = 0; j < reqs.length; j++) {
          var path = reqs[j].url.replace(/^https?:\/\/[^/]+/, '');
          if (!keep[path]) { cache['delete'](reqs[j]); delete cached[path.replace('/tv/media/', '')]; }
        }
      });
    })['catch'](function () { /* sem cache */ });
  }

  // ---------------- estado reportado ----------------
  var status = { state: 'starting', item: '', error: '' };
  function reportError(msg) { log(msg); status.error = String(msg).slice(0, 900); }

  // ---------------- pareamento ----------------
  var pairTimer = null;
  var pairingMode = false;   // na tela de código nada pode voltar a tocar
  var session = 0;           // invalida downloads iniciados antes de uma revogação
  function showScreen(id) {
    $('pairing').className = 'brand' + (id === 'pairing' ? ' show' : '');
    $('idle').className = 'brand' + (id === 'idle' ? ' show' : '');
  }
  function startPairing() {
    pairingMode = true; session++; preparingVersion = null;
    stopPlayback();
    status.state = 'pairing';
    showScreen('pairing');
    if (!caps.minimumOk) {
      var w = $('capWarn');
      w.style.display = 'block';
      w.innerHTML = 'Atenção: este navegador não reproduz vídeo MP4 (H.264). Imagens funcionam; para vídeos use um player externo (veja o manual do POP TV).';
    }
    $('code').innerHTML = '······';
    xhr('POST', API + 'pair/start', null, function (err, st, json) {
      if (err || st !== 200 || !json) {
        $('pairInfo').innerHTML = st === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Sem conexão com o servidor. Tentando de novo…';
        pairTimer = setTimeout(startPairing, 15000);
        return;
      }
      var c = json.code;
      $('code').innerHTML = c.slice(0, 3) + '<span>' + c.slice(3) + '</span>';
      $('pairInfo').innerHTML = 'O código vale por 10 minutos.';
      pollPairing(json.poll_token, Date.now() + json.ttl_seconds * 1000);
    });
  }
  function pollPairing(pollToken, expiresAt) {
    clearTimeout(pairTimer);
    pairTimer = setTimeout(function () {
      if (Date.now() > expiresAt) { startPairing(); return; }
      xhr('POST', API + 'pair/poll', { poll_token: pollToken }, function (err, st, json) {
        if (!err && json && json.status === 'paired') {
          if (!store.set('pop_token', json.device_token)) mem.token = json.device_token;
          pairingMode = false;
          showScreen('idle');
          $('idleInfo').innerHTML = 'Tela conectada! Carregando programação…';
          sync();
          return;
        }
        if (!err && json && json.status === 'expired') { startPairing(); return; }
        pollPairing(pollToken, expiresAt);
      });
    }, 3000);
  }

  // ---------------- sincronização (heartbeat + versão) ----------------
  var manifest = null;     // em reprodução
  var pending = null;      // novo manifesto preparado, entra na próxima troca de item
  var syncTimer = null;
  var preparingVersion = null; // manifesto novo sendo baixado (evita baixar o mesmo de novo a cada sync)
  var online = true;
  try { manifest = JSON.parse(store.get('pop_manifest') || 'null'); } catch (e) { manifest = null; }

  function sync() {
    clearTimeout(syncTimer);
    var body = { version: preparingVersion || (pending || manifest || {}).version || '', url_epoch: (pending || manifest || {}).url_epoch || 0,
      state: status.state, item: status.item };
    if (status.error) body.error = status.error;
    if (Date.now() - capsSentAt > 30 * 60000) { caps.swActive = swReady; caps.viewport = window.innerWidth + 'x' + window.innerHeight; body.capabilities = caps; }
    xhr('POST', API + 'sync', body, function (err, st, json) {
      var wait = ((manifest && manifest.poll_seconds) || 30) * 1000;
      if (st === 401) {
        log('credencial inválida/revogada: voltando ao pareamento');
        store.del('pop_token'); store.del('pop_manifest'); mem.token = null;
        manifest = null; pending = null;
        startPairing();
        return;
      }
      if (err || st !== 200 || !json) {
        online = false;
        status.state = manifest ? 'offline' : 'waiting';
        syncTimer = setTimeout(sync, wait);
        return;
      }
      online = true;
      status.error = '';
      if (body.capabilities) capsSentAt = Date.now();
      if (json.changed && json.manifest) receive(json.manifest);
      syncTimer = setTimeout(sync, (json.poll_seconds || (json.manifest && json.manifest.poll_seconds) || 30) * 1000);
    });
  }

  function receive(m) {
    var prev = pending || manifest;
    // mesma programação, só URLs renovadas: troca sem reiniciar a sequência
    if (prev && prev.version === m.version) {
      if (pending) pending = m; else manifest = m;
      store.set('pop_manifest', JSON.stringify(m));
      return;
    }
    if (m.version === preparingVersion) return; // já está sendo preparado
    preparingVersion = m.version;
    var mySession = session;
    precache(m.items, function () {
      if (mySession !== session || pairingMode) return;
      preparingVersion = null;
      pending = m;
      store.set('pop_manifest', JSON.stringify(m));
      if (!playing) { clearTimers(); applyPending(); start(); }
    });
  }

  function applyPending() {
    if (!pending) return false;
    manifest = pending; pending = null;
    pruneCache(manifest.items);
    index = -1;
    applyOrientation();
    return true;
  }

  function applyOrientation() {
    var portrait = manifest && manifest.screen && manifest.screen.orientation === 'portrait';
    // TV física deitada exibindo conteúdo vertical: gira o palco 90°
    $('stage').className = portrait && window.innerWidth > window.innerHeight ? 'rot' : '';
  }

  // ---------------- reprodução ----------------
  var layers = [$('la'), $('lb')];
  var front = 0;          // camada visível
  var index = -1;
  var playing = false;
  var gen = 0;            // invalida callbacks antigos (evita reprodução duplicada)
  var stepTimer = null, watchTimer = null;
  var failsInRow = 0;

  function clearTimers() { clearTimeout(stepTimer); clearTimeout(watchTimer); }

  function emptyLayer(l) {
    var v = l.getElementsByTagName('video')[0];
    if (v) { try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* */ } }
    l.innerHTML = '';
  }

  function stopPlayback() {
    gen++; clearTimers(); playing = false;
    emptyLayer(layers[0]); emptyLayer(layers[1]);
    layers[0].className = layers[1].className = 'layer';
  }

  function idle(msg) {
    if (pairingMode) return;
    stopPlayback();
    status.state = 'idle'; status.item = '';
    showScreen('idle');
    $('idleInfo').innerHTML = msg;
    stepTimer = setTimeout(function () { if (pending) applyPending(); start(); }, 30000);
  }

  function start() {
    if (pairingMode) return;
    if (!manifest || !manifest.items || !manifest.items.length) {
      idle(manifest ? 'Sem conteúdo publicado para esta tela.' : 'Aguardando programação…');
      return;
    }
    showScreen(null);
    playing = true;
    failsInRow = 0;
    advance();
  }

  function advance() {
    clearTimers();
    var myGen = ++gen;
    if (applyPending() && (!manifest.items || !manifest.items.length)) { start(); return; }
    maybeDailyReload();
    var items = manifest.items;
    if (failsInRow >= items.length) {
      reportError('Nenhum item da playlist conseguiu ser exibido.');
      failsInRow = 0;
      idle('Não foi possível exibir a programação. Tentando novamente…');
      return;
    }
    index = (index + 1) % items.length;
    var it = items[index];
    var cur = layers[front], back = layers[1 - front];
    var curVideo = cur.getElementsByTagName('video')[0];

    if (it.kind === 'video' && curVideo) {
      // vídeo → vídeo: reusa o MESMO elemento (muitas TVs têm um único decodificador de vídeo)
      playVideo(curVideo, it, myGen, null);
      return;
    }
    emptyLayer(back);
    var el;
    if (it.kind === 'image') {
      el = document.createElement('img');
      el.alt = '';
      var t = setTimeout(function () { fail(it, myGen, 'demorou para carregar'); }, LOAD_TIMEOUT);
      el.onload = function () {
        clearTimeout(t);
        if (myGen !== gen) return;
        swap();
        stepTimer = setTimeout(function () { ok(); advance(); }, it.duration_ms || 10000);
      };
      el.onerror = function () { clearTimeout(t); fail(it, myGen, 'erro ao abrir a imagem'); };
      back.appendChild(el);
      el.src = srcFor(it);
    } else {
      el = document.createElement('video');
      back.appendChild(el);
      // libera o decodificador do vídeo anterior antes de abrir o próximo
      if (curVideo) { try { curVideo.pause(); } catch (e) { /* */ } }
      playVideo(el, it, myGen, swap);
    }
    status.item = it.name || it.key;
    status.state = online ? 'playing' : 'offline';
  }

  function swap() {
    var old = front;
    front = 1 - front;
    layers[front].className = 'layer on';
    layers[old].className = 'layer';
    setTimeout(function () { if (front !== old) emptyLayer(layers[old]); }, 800);
  }

  function ok() { failsInRow = 0; }

  function fail(it, myGen, why) {
    if (myGen !== gen) return;
    failsInRow++;
    reportError('Item "' + (it.name || it.key) + '" pulado: ' + why);
    // se veio do cache e falhou, tenta a rede da próxima vez
    if (cached[it.key]) delete cached[it.key];
    advance();
  }

  function playVideo(v, it, myGen, onFirstFrame) {
    var started = false, lastTime = -1, pausedChecks = 0;
    v.muted = true; v.setAttribute('muted', ''); v.autoplay = true;
    v.setAttribute('playsinline', ''); v.preload = 'auto';
    v.onended = function () { if (myGen === gen) { ok(); advance(); } };
    v.onerror = function () { fail(it, myGen, 'erro ao abrir o vídeo'); };
    v.onplaying = function () {
      if (myGen !== gen || started) return;
      started = true;
      if (onFirstFrame) onFirstFrame();
    };
    // vigia: carregamento, travamento e duração máxima
    var startedAt = Date.now();
    function watch() {
      if (myGen !== gen) return;
      if (!started && Date.now() - startedAt > LOAD_TIMEOUT) { fail(it, myGen, 'não começou a tocar'); return; }
      if (started) {
        if (v.paused && !v.ended) {
          // o navegador pausou sozinho: tenta retomar; se continuar pausado, pula
          if (++pausedChecks > 1) { fail(it, myGen, 'pausou e não retomou'); return; }
          try { var pp = v.play(); if (pp && pp['catch']) pp['catch'](function () { /* */ }); } catch (e) { /* */ }
        } else pausedChecks = 0;
        if (v.currentTime === lastTime && !v.paused) { fail(it, myGen, 'travou'); return; }
        lastTime = v.currentTime;
        if (Date.now() - startedAt > MAX_VIDEO_MS) { ok(); advance(); return; }
      }
      watchTimer = setTimeout(watch, started ? STALL_TIMEOUT : 1000);
    }
    watchTimer = setTimeout(watch, 1000);
    v.src = srcFor(it);
    try { v.load(); } catch (e) { /* */ }
    var p = v.play && v.play();
    if (p && p['catch']) p['catch'](function () { /* autoplay bloqueado: o vigia pula se não começar */ });
  }

  // reinício diário de madrugada (limpa vazamentos de memória dos navegadores de TV)
  function maybeDailyReload() {
    var h = new Date().getHours();
    if (online && Date.now() - bootAt > 20 * 3600000 && h >= 3 && h < 5) location.reload();
  }

  // ---------------- tela cheia ----------------
  function fullscreen() {
    var d = document.documentElement;
    try {
      if (d.requestFullscreen) d.requestFullscreen();
      else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen();
    } catch (e) { /* */ }
    $('hint').style.display = 'none';
  }
  document.addEventListener('keydown', function (e) { if (e.keyCode === 13 || e.keyCode === 32) fullscreen(); });
  document.addEventListener('click', fullscreen);
  if (caps.fullscreen && !document.fullscreenElement) {
    $('hint').style.display = 'block';
    setTimeout(function () { $('hint').style.display = 'none'; }, 10000);
  }
  window.addEventListener('resize', applyOrientation);

  // ---------------- início ----------------
  // 1) se há programação salva, toca já (funciona mesmo sem internet)
  // 2) sincroniza: o servidor diz se a credencial vale (header ou cookie) e o que tocar
  // (precache só confere o que já está guardado; sem rede, segue com o que houver)
  if (manifest) { applyOrientation(); var bootSession = session; precache(manifest.items, function () { if (!playing && bootSession === session) start(); }); } else { showScreen('idle'); }
  // a credencial pode estar no localStorage ou só no cookie HttpOnly: o primeiro sync resolve os dois casos
  xhr('POST', API + 'sync', { state: 'starting', capabilities: caps }, function (err, st, json) {
    if (st === 401) { store.del('pop_token'); store.del('pop_manifest'); manifest = null; startPairing(); return; }
    capsSentAt = Date.now();
    if (!err && st === 200 && json) {
      if (json.changed && json.manifest) receive(json.manifest);
      else if (!playing && manifest) start();
    }
    syncTimer = setTimeout(sync, ((json && (json.poll_seconds || (json.manifest && json.manifest.poll_seconds))) || 30) * 1000);
  });

  // exposto só para testes automatizados
  window.__popTv = { status: status, caps: caps, current: function () { return manifest; }, index: function () { return index; } };
})();
