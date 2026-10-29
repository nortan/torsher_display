/*
 * Панель управления витриной (Bootstrap 5).
 *
 * Два режима работы:
 *  - «Сервер»: есть PHP-бэкенд (api/). Вход по логину, данные — в MySQL, фото — в uploads/.
 *    Правки копятся в черновике браузера и уходят на экраны кнопкой «Опубликовать на экраны».
 *  - «Локально»: бэкенда нет (GitHub Pages, файл с диска). Данные в localStorage, фото в IndexedDB,
 *    публикация — ZIP-сборкой, JSON или коммитом в GitHub.
 * Предпросмотр — плеер ../index.html?preview=1 в iframe (postMessage).
 */
(function () {
  'use strict';

  var M = window.TorsherModel;
  var API = '../api/';
  var LOCAL_KEY = 'torsher-admin-data-v2';
  var DRAFT_KEY = 'torsher-admin-draft-server';
  var GIT_KEY = 'torsher-admin-git';
  var DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  var data = null;                       // текущие данные витрины
  var media = {};                        // локальный режим: path → dataURL (IndexedDB)
  var server = { on: false, csrf: '', user: null, revision: 0, updatedAt: '', dirty: false };
  var ui = { tab: 'slides', slideId: null, dishFilter: '', dishPhoto: 'all', showPast: false, displayId: '' };

  /* ---------- DOM-хелперы ---------- */

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { append(el, x); });
    else el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  var uidN = 0;
  function field(label, control, hint) {
    var id = 'f' + (++uidN);
    if (control && control.tagName && /^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) && !control.id) control.id = id;
    return h('div', { class: 'col' },
      h('label', { class: 'form-label small fw-semibold text-body-secondary mb-1', for: control && control.id || null, text: label }),
      control, hint ? h('div', { class: 'form-text', text: hint }) : null);
  }
  function row() { var r = h('div', { class: 'row g-3 row-cols-1 row-cols-md-2 row-cols-xxl-3' }); append(r, [].slice.call(arguments)); return r; }
  function card(title, body, extra) {
    return h('div', { class: 'card shadow-sm mb-3' }, h('div', { class: 'card-body' },
      title ? h('div', { class: 'd-flex align-items-center justify-content-between gap-2 mb-3' }, h('h2', { class: 'h5 mb-0', text: title }), extra || null) : null, body));
  }
  function btn(text, onclick, cls, attrs) {
    return h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || 'btn-outline-secondary'), text: text, onclick: onclick }, attrs || {}));
  }

  /* Поля ввода, связанные со свойством объекта. */
  function input(obj, key, opts) {
    opts = opts || {};
    var type = opts.type || 'text';
    var el = h('input', { type: type, class: 'form-control' + (opts.sm ? ' form-control-sm' : ''), placeholder: opts.placeholder, min: opts.min, max: opts.max, step: opts.step });
    var v = obj[key];
    el.value = v == null ? '' : v;
    el.addEventListener('input', function () {
      var val = el.value;
      if (type === 'number') val = val === '' ? (opts.nullable ? null : 0) : Number(val);
      obj[key] = val;
      changed(opts.rerender);
      if (opts.onChange) opts.onChange(val);
    });
    return el;
  }
  function textarea(obj, key, opts) {
    opts = opts || {};
    var el = h('textarea', { class: 'form-control' + (opts.sm ? ' form-control-sm' : ''), rows: opts.rows || 2, placeholder: opts.placeholder });
    el.value = obj[key] || '';
    el.addEventListener('input', function () { obj[key] = el.value; changed(); });
    return el;
  }
  function select(obj, key, options, opts) {
    opts = opts || {};
    var el = h('select', { class: 'form-select' + (opts.sm ? ' form-select-sm' : '') });
    if (opts.empty != null) el.appendChild(h('option', { value: '', text: opts.empty }));
    Object.keys(options).forEach(function (k) {
      var o = options[k];
      el.appendChild(h('option', { value: k, text: o && typeof o === 'object' && o.label != null ? o.label : o }));
    });
    el.value = obj[key] == null ? '' : String(obj[key]);
    el.addEventListener('change', function () {
      var v = el.value;
      obj[key] = v === '' ? '' : (opts.number ? Number(v) : v);
      changed(opts.rerender);
      if (opts.onChange) opts.onChange(v);
    });
    return el;
  }
  function checkbox(obj, key, label, opts) {
    opts = opts || {};
    var id = 'c' + (++uidN);
    var on = obj[key] == null ? !!opts.defaultOn : obj[key] !== false && !!obj[key];
    var el = h('input', { class: 'form-check-input', type: 'checkbox', id: id, role: opts.switch !== false ? 'switch' : null, checked: on });
    el.addEventListener('change', function () { obj[key] = el.checked; changed(opts.rerender); });
    return h('div', { class: 'form-check form-switch mb-0' + (label ? '' : ' d-flex justify-content-center') }, el,
      label ? h('label', { class: 'form-check-label', for: id, text: label }) : null);
  }
  function range(obj, key, min, max, step, fmt) {
    var out = h('span', { class: 'badge text-bg-light border ms-2', style: 'min-width:64px', text: fmt(obj[key]) });
    var el = h('input', { type: 'range', class: 'form-range', min: min, max: max, step: step });
    el.value = obj[key];
    el.addEventListener('input', function () { obj[key] = Number(el.value); out.textContent = fmt(obj[key]); changed(); });
    return h('div', { class: 'd-flex align-items-center' }, el, out);
  }

  var toastObj = null;
  function toast(msg) {
    document.getElementById('toastBody').textContent = msg;
    toastObj = toastObj || bootstrap.Toast.getOrCreateInstance(document.getElementById('toast'), { delay: 2800 });
    toastObj.show();
  }

  /* ---------- Хранилище: локальный режим ---------- */

  var idb = null;
  function openDB() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('torsher-admin', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('media'); };
        req.onsuccess = function () { idb = req.result; resolve(); };
        req.onerror = function () { resolve(); };
      } catch (e) { resolve(); }
    });
  }
  function dbAll() {
    return new Promise(function (resolve) {
      if (!idb) return resolve({});
      var out = {}, cur = idb.transaction('media', 'readonly').objectStore('media').openCursor();
      cur.onsuccess = function () { var c = cur.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
      cur.onerror = function () { resolve(out); };
    });
  }
  function dbPut(path, dataURL) {
    media[path] = dataURL;
    if (idb) idb.transaction('media', 'readwrite').objectStore('media').put(dataURL, path);
  }

  var saveTimer, previewTimer;
  function changed(rerender) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 250);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 350);
    if (server.on && !server.dirty) { server.dirty = true; renderNavRight(); }
    if (rerender) render();
  }

  function saveDraft() {
    try {
      if (server.on) localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: server.revision, data: data }));
      else localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      setStatus(server.on ? (server.dirty ? 'Черновик сохранён · не опубликован' : 'Опубликовано') : 'Сохранено в браузере · ' + new Date().toLocaleTimeString('ru-RU'));
    } catch (e) {
      setStatus('Не удалось сохранить черновик: ' + e.message);
    }
  }
  function setStatus(t) { document.getElementById('saveStatus').textContent = t; }

  function normalize(d) {
    d = d || {};
    d.version = 2;
    d.cafe = d.cafe || { name: 'Кафе', tagline: '' };
    d.settings = Object.assign(M.defaultSettings(), d.settings || {});
    d.settings.animation = M.normalizeAnimation(d.settings.animation || {});
    if (!Array.isArray(d.settings.palette) || !d.settings.palette.length) d.settings.palette = M.defaultPalette();
    if (!d.settings.colors || Array.isArray(d.settings.colors)) d.settings.colors = {};
    d.settings.bg = Object.assign({ color1: 'lime', color2: 'orange', speed: 1, intensity: 1 }, d.settings.bg && !Array.isArray(d.settings.bg) ? d.settings.bg : {});
    d.settings.newBadge = Object.assign({ text: 'NEW', anim: 'pulse' }, d.settings.newBadge && !Array.isArray(d.settings.newBadge) ? d.settings.newBadge : {});
    d.settings.transition = Object.assign({ effect: 'fade', speed: 1100 }, d.settings.transition || {});
    d.settings.fonts = Object.assign(M.defaultFonts(), d.settings.fonts || {});
    d.settings.header = Object.assign(M.defaultHeader(), d.settings.header && !Array.isArray(d.settings.header) ? d.settings.header : {});
    delete d.settings.headingFont;
    d.ticker = d.ticker || [];
    d.dishes = d.dishes || [];
    d.events = d.events || [];
    d.slides = d.slides || [];
    d.displays = d.displays || [];
    d.displays.forEach(function (p) {
      p.slides = Array.isArray(p.slides) ? p.slides : [];
      if (!M.ORIENTATIONS[p.orientation]) p.orientation = 'vertical';
      if (p.resolution === '2k') p.resolution = 1920;
      if (p.resolution === '4k') p.resolution = 3840;
      if (!M.DISPLAY_RESOLUTIONS[p.resolution]) p.resolution = 1920;
      p.settings = p.settings && typeof p.settings === 'object' && !Array.isArray(p.settings) ? p.settings : null;
      if (p.settings && p.settings.animation) p.settings.animation = M.normalizeAnimation(p.settings.animation);
      p.cafe = p.cafe && typeof p.cafe === 'object' && !Array.isArray(p.cafe) ? p.cafe : null;
      p.ticker = Array.isArray(p.ticker) ? p.ticker : null;
      p.slideEnabled = p.slideEnabled && typeof p.slideEnabled === 'object' && !Array.isArray(p.slideEnabled) ? p.slideEnabled : {};
    });
    // поля-объекты: пустой {} мог прийти как [] (PHP) — приводим к объекту
    var obj = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    d.cafe = obj(d.cafe);
    d.slides.forEach(function (s) {
      s.elements = obj(s.elements);
      s.colors = obj(s.colors);
      s.bg = obj(s.bg);
      if (s.sizes != null) s.sizes = Object.assign({ title: null, dish: null, text: null }, obj(s.sizes));
      if (s.show != null) s.show = obj(s.show);
      if (s.nearest != null) s.nearest = obj(s.nearest);
      if (s.schedule != null) { s.schedule = obj(s.schedule); s.schedule.days = s.schedule.days || []; }
      if (!Array.isArray(s.photoPos)) s.photoPos = [];
      if (s.animation) s.animation = M.normalizeAnimation(s.animation);
      if (M.LAYOUT_ALIASES[s.layout]) s.layout = M.LAYOUT_ALIASES[s.layout];
    });
    delete d.revision; delete d.updatedAt;
    return d;
  }

  function loadFromRepo() {
    return fetch('../content/data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  /* ---------- Сервер (PHP + MySQL) ---------- */

  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (opts.method && opts.method !== 'GET') headers['X-CSRF-Token'] = server.csrf;
    if (opts.json !== undefined) { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
    return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body, credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) {
        return r.text().then(function (t) {
          var j; try { j = JSON.parse(t); } catch (e) { j = null; }
          if (!j) { var err = new Error('Бэкенд не отвечает JSON (' + r.status + ')'); err.noBackend = true; throw err; }
          if (!r.ok) { var e2 = new Error(j.error || ('Ошибка ' + r.status)); e2.status = r.status; e2.body = j; throw e2; }
          return j;
        });
      });
  }

  /* ---------- Вход без базы данных (локальный режим) ----------
     Если бэкенда или базы нет, панель всё равно просит вход: по умолчанию admin / pass123.
     Пароль хранится только в виде SHA-256 в этом браузере и меняется в меню пользователя.
     Это защита от случайного доступа к панели: данные локального режима и так живут только
     в этом браузере, а публикация в GitHub/FTP требует своих токенов и паролей. */
  var LOCAL_AUTH_KEY = 'torsher-admin-local-auth';
  var LOCAL_SESSION_KEY = 'torsher-admin-local-session';
  var DEFAULT_LOCAL = { login: 'admin', hash: '9b8769a4a742959a2d0298c36fb70623f2dfacda8436237df08d8dfd5b37374c' }; // sha256('pass123')

  function sha256(text) {
    var bytes = new TextEncoder().encode(text);
    if (window.crypto && crypto.subtle) {
      return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
    }
    return Promise.resolve(sha256sync(bytes));
  }
  /* Запасной SHA-256 для file:// и http без TLS, где нет crypto.subtle. */
  function sha256sync(bytes) {
    var K = [], H = [], i, j;
    var isPrime = function (n) { for (var f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    for (var n = 2, c = 0; c < 64; n++) if (isPrime(n)) { if (c < 8) H[c] = (Math.pow(n, 1 / 2) * 4294967296) | 0; K[c++] = (Math.pow(n, 1 / 3) * 4294967296) | 0; }
    var l = bytes.length, words = [];
    for (i = 0; i < l; i++) words[i >> 2] |= bytes[i] << ((3 - i % 4) * 8);
    words[l >> 2] |= 0x80 << ((3 - l % 4) * 8);
    words[((l + 8) >> 6) * 16 + 15] = l * 8;
    var rot = function (x, r) { return (x >>> r) | (x << (32 - r)); };
    for (j = 0; j < words.length; j += 16) {
      var w = [], a = H.slice(0);
      for (i = 0; i < 16; i++) w[i] = words[j + i] | 0;
      for (i = 0; i < 64; i++) {
        if (i >= 16) {
          var w15 = w[i - 15], w2 = w[i - 2];
          w[i] = (w[i - 16] + (rot(w15, 7) ^ rot(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rot(w2, 17) ^ rot(w2, 19) ^ (w2 >>> 10))) | 0;
        }
        var t1 = (a[7] + (rot(a[4], 6) ^ rot(a[4], 11) ^ rot(a[4], 25)) + ((a[4] & a[5]) ^ (~a[4] & a[6])) + K[i] + (w[i] | 0)) | 0;
        var t2 = ((rot(a[0], 2) ^ rot(a[0], 13) ^ rot(a[0], 22)) + ((a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]))) | 0;
        a = [(t1 + t2) | 0].concat(a.slice(0, 7)); a[4] = (a[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) H[i] = (H[i] + a[i]) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  function localAuth() {
    try { return Object.assign({}, DEFAULT_LOCAL, JSON.parse(localStorage.getItem(LOCAL_AUTH_KEY) || '{}')); } catch (e) { return DEFAULT_LOCAL; }
  }
  function localLogin(login, password) {
    var cfg = localAuth();
    return sha256(password).then(function (hash) {
      if (login !== cfg.login || hash !== cfg.hash) throw new Error('Неверный логин или пароль');
      try { sessionStorage.setItem(LOCAL_SESSION_KEY, '1'); } catch (e) { /* нет */ }
      server.user = { login: cfg.login };
    });
  }
  function localSession() {
    try { return sessionStorage.getItem(LOCAL_SESSION_KEY) === '1'; } catch (e) { return false; }
  }

  function serverLoad() {
    return api('data.php').then(function (d) {
      server.revision = d.revision; server.updatedAt = d.updatedAt;
      var draft = null;
      try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { draft = null; }
      if (draft && draft.base === d.revision && JSON.stringify(normalize(M.clone(draft.data))) !== JSON.stringify(normalize(M.clone(d)))) {
        data = normalize(draft.data); server.dirty = true;
        setTimeout(function () { toast('Восстановлен неопубликованный черновик'); }, 300);
      } else {
        data = normalize(d); server.dirty = false;
        if (draft && draft.base !== d.revision) localStorage.removeItem(DRAFT_KEY);
      }
    });
  }

  function publishToServer() {
    var btnEl = document.getElementById('publishBtn');
    if (btnEl) btnEl.disabled = true;
    return api('data.php', { method: 'PUT', json: data }).then(function (r) {
      server.revision = r.revision; server.dirty = false; server.updatedAt = new Date().toISOString();
      localStorage.removeItem(DRAFT_KEY);
      renderNavRight(); setStatus('Опубликовано · ревизия ' + r.revision);
      toast('Опубликовано: экраны обновятся после очередной проверки данных');
      if (ui.tab === 'publish') render();
    }).catch(function (e) {
      if (e.status === 401) { toast('Сессия истекла — войдите снова'); showLogin(); }
      else toast('Ошибка публикации: ' + e.message);
    }).then(function () { if (btnEl) btnEl.disabled = false; });
  }

  function renderNavRight() {
    var box = document.getElementById('navRight');
    box.innerHTML = '';
    box.appendChild(h('span', { class: 'navbar-text small me-2', id: 'saveStatus' }));
    if (server.on) {
      box.appendChild(h('span', { class: 'badge text-bg-success', title: 'Где хранятся данные — меняется в «Публикация → Хранение данных»',
        text: 'Сервер · ' + (server.storage === 'files' ? 'файлы' : 'БД') }));
      box.appendChild(h('button', { type: 'button', id: 'publishBtn', class: 'btn btn-sm ' + (server.dirty ? 'btn-warning' : 'btn-outline-light'),
        text: server.dirty ? 'Опубликовать на экраны' : 'Опубликовано ✓', disabled: !server.dirty, onclick: publishToServer }));
      box.appendChild(h('div', { class: 'dropdown' },
        h('button', { type: 'button', class: 'btn btn-sm btn-outline-light dropdown-toggle', 'data-bs-toggle': 'dropdown', text: server.user ? server.user.login : '' }),
        h('ul', { class: 'dropdown-menu dropdown-menu-end' },
          h('li', null, h('a', { class: 'dropdown-item', href: '#', text: 'Сменить пароль', onclick: function (e) { e.preventDefault(); changePassword(); } })),
          h('li', null, h('a', { class: 'dropdown-item', href: '#', text: 'Выйти', onclick: function (e) { e.preventDefault(); logout(); } })))));
    } else {
      box.appendChild(h('span', { class: 'badge text-bg-secondary', title: 'Бэкенд не найден: данные хранятся в этом браузере', text: 'Локально' }));
    }
    if (!server.on && server.user) {
      box.appendChild(h('div', { class: 'dropdown' },
        h('button', { type: 'button', class: 'btn btn-sm btn-outline-light dropdown-toggle', 'data-bs-toggle': 'dropdown', text: server.user.login }),
        h('ul', { class: 'dropdown-menu dropdown-menu-end' },
          h('li', null, h('a', { class: 'dropdown-item', href: '#', text: 'Сменить пароль', onclick: function (e) { e.preventDefault(); changePassword(); } })),
          h('li', null, h('a', { class: 'dropdown-item', href: '#', text: 'Выйти', onclick: function (e) { e.preventDefault(); logout(); } })))));
    }
    saveDraft();
  }

  function showLogin(msg) {
    document.getElementById('app').hidden = true;
    document.getElementById('login').hidden = false;
    var err = document.getElementById('loginError');
    err.hidden = !msg; err.textContent = msg || '';
    document.getElementById('loginMode').textContent = server.localAuth
      ? 'База данных не подключена: вход по локальной учётной записи этого браузера.' : '';
    document.getElementById('loginName').focus();
  }

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var login = document.getElementById('loginName').value.trim(), pass = document.getElementById('loginPass').value;
    var go = server.localAuth
      ? localLogin(login, pass).then(enterLocalMode)
      : api('auth.php', { method: 'POST', json: { action: 'login', login: login, password: pass } })
        .then(function (r) { server.csrf = r.csrf; server.user = r.user; server.storage = r.storage; return enterServerMode(); });
    go.catch(function (e2) { showLogin(e2.message); });
  });

  function logout() {
    if (server.localAuth) { try { sessionStorage.removeItem(LOCAL_SESSION_KEY); } catch (e) { /* нет */ } location.reload(); return; }
    if (server.dirty && !confirm('Есть неопубликованные изменения. Они останутся черновиком в этом браузере. Выйти?')) return;
    api('auth.php', { method: 'POST', json: { action: 'logout' } }).catch(function () {}).then(function () { location.reload(); });
  }

  function changePassword() {
    var cur = h('input', { class: 'form-control', type: 'password', autocomplete: 'current-password' });
    var nxt = h('input', { class: 'form-control', type: 'password', autocomplete: 'new-password', minlength: 8 });
    var err = h('div', { class: 'alert alert-danger py-2 small mt-3', hidden: true });
    var modalEl = h('div', { class: 'modal fade', tabindex: '-1' }, h('div', { class: 'modal-dialog' }, h('div', { class: 'modal-content' },
      h('div', { class: 'modal-header' }, h('h5', { class: 'modal-title', text: 'Смена пароля' }), h('button', { type: 'button', class: 'btn-close', 'data-bs-dismiss': 'modal' })),
      h('div', { class: 'modal-body' }, field('Текущий пароль', cur), h('div', { class: 'mt-3' }, field('Новый пароль (от 8 символов)', nxt)), err),
      h('div', { class: 'modal-footer' }, btn('Отмена', null, 'btn-outline-secondary', { 'data-bs-dismiss': 'modal' }),
        btn('Сохранить', function () {
          if (server.localAuth) {
            if (nxt.value.length < 6) { err.hidden = false; err.textContent = 'Новый пароль — не короче 6 символов'; return; }
            var cfg = localAuth();
            sha256(cur.value).then(function (h1) {
              if (h1 !== cfg.hash) throw new Error('Текущий пароль неверен');
              return sha256(nxt.value);
            }).then(function (h2) {
              localStorage.setItem(LOCAL_AUTH_KEY, JSON.stringify({ login: cfg.login, hash: h2 }));
              modal.hide(); toast('Пароль изменён (для этого браузера)');
            }).catch(function (e) { err.hidden = false; err.textContent = e.message; });
            return;
          }
          api('auth.php', { method: 'POST', json: { action: 'password', current: cur.value, next: nxt.value } })
            .then(function () { modal.hide(); toast('Пароль изменён'); })
            .catch(function (e) { err.hidden = false; err.textContent = e.message; });
        }, 'btn-primary')))));
    document.body.appendChild(modalEl);
    var modal = new bootstrap.Modal(modalEl);
    modalEl.addEventListener('hidden.bs.modal', function () { modalEl.remove(); });
    modal.show();
  }

  /* ---------- Предпросмотр ---------- */

  var frame = document.getElementById('previewFrame');
  var previewReady = false;

  function resolvedData() {
    var d = M.clone(data);
    function fix(o) { if (o && o.photo && media[o.photo]) o.photo = media[o.photo]; }
    d.dishes.forEach(fix); d.events.forEach(fix); d.slides.forEach(fix);
    if (d.cafe.logo && media[d.cafe.logo]) d.cafe.logo = media[d.cafe.logo];
    (d.displays || []).forEach(function (p) {
      if (p.cafe && p.cafe.logo && media[p.cafe.logo]) p.cafe.logo = media[p.cafe.logo];
    });
    return d;
  }

  function sendPreview() {
    if (!previewReady || !data) return;
    scalePreview();
    var mode = document.getElementById('previewMode').value;
    var slideId = mode === 'slide' ? (ui.slideId || (data.slides[0] && data.slides[0].id)) : null;
    frame.contentWindow.postMessage({ type: 'torsher:data', data: resolvedData(), slideId: slideId, ignoreSchedule: mode === 'show', displayId: ui.displayId || null }, '*');
  }
  function replay() { frame.contentWindow.postMessage({ type: 'torsher:replay' }, '*'); }

  /* Размер холста предпросмотра: вертикальный дисплей или без дисплея — 1080×1920,
     горизонтальный — 1920×1080; для 4K эти размеры удваиваются. */
  function previewSize() {
    var d = (data.displays || []).filter(function (x) { return x.id === ui.displayId; })[0];
    var size = M.displaySize(d);
    return [size.width, size.height];
  }
  function scalePreview() {
    var box = document.getElementById('previewScreen');
    var sz = previewSize();
    var wide = sz[0] > sz[1];
    var card = box.closest('.preview');
    if (card) card.classList.toggle('preview--wide', wide);
    // Горизонтальный экран не растягиваем на всю высоту колонки — рамка повторяет его пропорции.
    if (wide) {
      box.style.height = Math.round((box.clientWidth || 760) * sz[1] / sz[0]) + 'px';
      box.style.minHeight = '0';
    } else {
      box.style.height = '';
      box.style.minHeight = '';
    }
    frame.style.width = sz[0] + 'px';
    frame.style.height = sz[1] + 'px';
    var k = Math.min(box.clientWidth / sz[0], box.clientHeight / sz[1]);
    frame.style.transform = 'translate(' + ((box.clientWidth - sz[0] * k) / 2) + 'px,' + ((box.clientHeight - sz[1] * k) / 2) + 'px) scale(' + k + ')';
    var note = document.getElementById('previewNote');
    if (note) note.textContent = 'Экран ' + sz[0] + '×' + sz[1] + (sz[0] > sz[1] ? ' (горизонтальный)' : ' (вертикальный)') + ', масштаб уменьшен.';
  }

  /* Список дисплеев в шапке предпросмотра: выбор управляет ?display и ориентацией iframe. */
  function fillPreviewDisplays() {
    var sel = document.getElementById('previewDisplay');
    if (!sel || !data) return;
    sel.innerHTML = '';
    sel.appendChild(h('option', { value: '', text: 'Все слайды · вертикально' }));
    (data.displays || []).forEach(function (d) {
      var size = M.displaySize(d);
      sel.appendChild(h('option', { value: d.id, text: (d.name || 'Дисплей') + ' · ' + (d.orientation === 'horizontal' ? 'горизонтально' : 'вертикально') + ' · ' + size.width + '×' + size.height }));
    });
    sel.value = ui.displayId || '';
  }
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'torsher:ready') { previewReady = true; fillPreviewDisplays(); sendPreview(); }
  });
  document.getElementById('previewDisplay').addEventListener('change', function (e) {
    setDisplay(e.target.value);
  });
  document.getElementById('previewMode').addEventListener('change', sendPreview);
  document.getElementById('replay').addEventListener('click', replay);
  window.addEventListener('resize', scalePreview);

  /* ---------- Фото: обязательно обтравленные (прозрачный фон) ---------- */

  function hasAlpha(ctx, w, hgt) {
    var d = ctx.getImageData(0, 0, w, hgt).data, transparent = 0, total = 0;
    for (var y = 0; y < hgt; y += Math.max(1, Math.floor(hgt / 60))) {
      for (var x = 0; x < w; x += Math.max(1, Math.floor(w / 60))) {
        if (!(x < w * 0.05 || x > w * 0.95 || y < hgt * 0.05 || y > hgt * 0.95)) continue;
        total++;
        if (d[(y * w + x) * 4 + 3] < 20) transparent++;
      }
    }
    return total > 0 && transparent / total > 0.3;
  }

  /* Простое удаление однотонного фона: заливка от краёв по цвету углов с допуском. */
  function removeFlatBackground(c) {
    var ctx = c.getContext('2d'), w = c.width, hgt = c.height;
    var img = ctx.getImageData(0, 0, w, hgt), d = img.data;
    function px(x, y) { var i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; }
    var corners = [px(0, 0), px(w - 1, 0), px(0, hgt - 1), px(w - 1, hgt - 1)];
    var ref = [0, 1, 2].map(function (k) { return corners.reduce(function (a, c2) { return a + c2[k]; }, 0) / 4; });
    var tol = 42, seen = new Uint8Array(w * hgt), stack = [];
    for (var x = 0; x < w; x++) stack.push(x, 0, x, hgt - 1);
    for (var y = 0; y < hgt; y++) stack.push(0, y, w - 1, y);
    while (stack.length) {
      var yy = stack.pop(), xx = stack.pop();
      if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
      var k = yy * w + xx;
      if (seen[k]) continue;
      seen[k] = 1;
      var i = k * 4;
      if (Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]) > tol * 3) continue;
      d[i + 3] = 0;
      stack.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1);
    }
    ctx.putImageData(img, 0, 0);
  }

  function readImage(file, opts) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var k = Math.min(1, ((opts && opts.max) || 1200) / Math.max(img.width || 512, img.height || 512));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        if (opts && opts.removeBg) removeFlatBackground(c);
        URL.revokeObjectURL(url);
        resolve({ canvas: c, alpha: hasAlpha(c.getContext('2d'), c.width, c.height) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
      img.src = url;
    });
  }

  function storeImage(res) {
    if (!server.on) {
      var path = 'media/' + M.uid('img') + '.webp';
      dbPut(path, res.canvas.toDataURL('image/webp', 0.88));
      return Promise.resolve(path);
    }
    return new Promise(function (resolve) { res.canvas.toBlob(resolve, 'image/webp', 0.88); }).then(function (blob) {
      var fd = new FormData();
      fd.append('file', blob, 'photo.webp');
      if (res.alpha) fd.append('hasAlpha', '1');
      return api('upload.php', { method: 'POST', body: fd });
    }).then(function (r) { return r.path; });
  }

  function photoSrc(path) {
    if (!path) return '';
    return media[path] || (/^(data:|https?:)/.test(path) ? path : '../' + path);
  }

  /* Загрузка фото в поле объекта. opts.key — имя поля (по умолчанию photo), opts.logo — логотип (без проверки обтравки). */
  function photoPicker(obj, opts) {
    opts = opts || {};
    var key = opts.key || 'photo';
    var fileInput = h('input', { type: 'file', accept: opts.logo ? 'image/svg+xml,image/png,image/webp,image/*' : 'image/png,image/webp,image/*' });
    var box = h('label', { class: 'thumb' + (opts.logo ? ' thumb--logo' : ''), title: opts.logo ? 'Загрузить логотип (лучше PNG/SVG с прозрачным фоном)' : 'Загрузить обтравленное фото (PNG/WebP с прозрачным фоном)' }, fileInput);
    if (obj[key]) {
      box.appendChild(h('img', { src: photoSrc(obj[key]), alt: '' }));
      box.appendChild(h('button', { class: 'thumb__x', type: 'button', title: 'Убрать', text: '×', onclick: function (e) {
        e.preventDefault(); obj[key] = null; changed(true);
      } }));
    } else {
      box.appendChild(h('span', { text: opts.logo ? '+ логотип' : '+ фото' }));
    }
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0];
      if (!f) return;
      readImage(f, { max: opts.logo ? 512 : 1200 }).then(function (res) {
        if (!opts.logo && !opts.plain && !res.alpha && confirm('У фото нет прозрачного фона. Для витрины нужны обтравленные фото (PNG/WebP с альфа-каналом).\n\n' +
            'ОК — попробовать убрать однотонный фон автоматически\nОтмена — загрузить как есть')) {
          return readImage(f, { removeBg: true });
        }
        return res;
      }).then(function (res) {
        return storeImage(res).then(function (path) {
          obj[key] = path;
          changed(true);
          toast(opts.logo ? 'Логотип загружен' : (res.alpha || opts.plain) ? 'Фото загружено' : 'Фото загружено без прозрачного фона');
        });
      }).catch(function (e) { toast('Ошибка загрузки: ' + e.message); });
    });
    return box;
  }

  /* ---------- Вкладки ---------- */

  function render() {
    var main = document.getElementById('main');
    var scroll = window.scrollY;
    main.innerHTML = '';
    var pages = { slides: renderSlides, displays: renderDisplays, dishes: renderDishes, events: renderEvents, design: renderDesign, publish: renderPublish };
    main.appendChild(pages[ui.tab]());
    window.scrollTo(0, scroll);
    Array.prototype.forEach.call(document.querySelectorAll('#nav .nav-link'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === ui.tab);
    });
  }

  document.getElementById('nav').addEventListener('click', function (e) {
    var t = e.target.getAttribute('data-tab');
    if (t) { e.preventDefault(); ui.tab = t; window.scrollTo(0, 0); render(); }
  });

  function pageHead(title, sub, tools) {
    return h('div', { class: 'd-flex flex-wrap align-items-end justify-content-between gap-2 mb-3' },
      h('div', null, h('h1', { class: 'h3 mb-1', text: title }), sub ? h('p', { class: 'text-body-secondary mb-0', text: sub }) : null),
      tools ? h('div', { class: 'd-flex flex-wrap gap-2' }, tools) : null);
  }

  /* ===== Экраны (слайды) ===== */

  function slideSummary(s) {
    if (s.type === 'dishes') return (M.LAYOUTS[s.layout] || {}).label || s.layout;
    if (s.type === 'countdown') {
      var ev = M.countdownEvent(data.events, s, new Date());
      return 'Обратный отсчёт · ' + (ev ? ev.title + ', ' + ev.date + ' ' + (ev.time || '') : 'сейчас нет подходящего мероприятия — слайд пропускается');
    }
    if (s.type === 'announce') return 'Объявление · ' + (M.ANNOUNCE_STYLES[s.variant] || '') + (s.photo ? ' · с фото' : '');
    if (s.type === 'events') return (s.range === '2weeks' ? 'Афиша на 2 недели' : 'Афиша на неделю') + ' · до ' + (s.max || 7) + ' · ' + (M.EVENT_STYLES[s.style] || '');
    return 'Информация · ' + ((s.lines || []).length) + ' строк';
  }

  function scheduleSummary(s) {
    var sc = s.schedule || {}, parts = [];
    if (sc.days && sc.days.length && sc.days.length < 7) parts.push(sc.days.map(function (d) { return DAYS[d - 1]; }).join(','));
    if (sc.from || sc.to) parts.push((sc.from || '…') + '–' + (sc.to || '…'));
    if (sc.dateFrom || sc.dateTo) parts.push((sc.dateFrom || '…') + ' → ' + (sc.dateTo || '…'));
    return parts.join(' · ');
  }

  /* Обновляет значок расписания в списке без перерисовки всего редактора. */
  function refreshScheduleBadge(s) {
    var t = scheduleSummary(s), badges = document.querySelectorAll('[data-schedule-for]');
    for (var i = 0; i < badges.length; i++) {
      if (badges[i].getAttribute('data-schedule-for') !== s.id) continue;
      badges[i].textContent = t ? '⏰ ' + t : '';
      badges[i].style.display = t ? '' : 'none';
      return;
    }
  }

  /* Бегунок «С–По»: часы показа слайда. Пустые from/to — все сутки. */
  function timeRange(sc, s) {
    var from = M.minutes(sc.from), to = M.minutes(sc.to);
    if (from == null) from = 0;
    if (to == null) to = 24 * 60;
    var fmt = function (m) {
      var h = Math.floor(m / 60), mm = m % 60;
      return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
    };
    var fromVal = h('b', { text: fmt(from) });
    var toVal = h('b', { text: fmt(to) });
    var status = h('div', { class: 'time-range__status' });
    var fill = h('div', { class: 'time-range__fill' });
    var fromInput = h('input', { type: 'range', min: 0, max: 24 * 60, step: 15, value: from, class: 'time-range__input time-range__input--from', 'aria-label': 'С, время начала' });
    var toInput = h('input', { type: 'range', min: 0, max: 24 * 60, step: 15, value: to, class: 'time-range__input time-range__input--to', 'aria-label': 'По, время окончания' });

    function update(change) {
      var a = Math.max(0, Math.min(24 * 60, Number(fromInput.value)));
      var b = Math.max(0, Math.min(24 * 60, Number(toInput.value)));
      fromVal.textContent = fmt(a);
      toVal.textContent = fmt(b);
      fromInput.setAttribute('aria-valuetext', fmt(a));
      toInput.setAttribute('aria-valuetext', fmt(b));
      var pa = a / (24 * 60) * 100, pb = b / (24 * 60) * 100;
      if (a === 0 && b === 24 * 60) {
        fill.style.left = '0';
        fill.style.width = '100%';
        fill.style.background = '';
        status.textContent = 'Все сутки';
      } else if (a === b) {
        fill.style.left = pa + '%';
        fill.style.width = '0';
        fill.style.background = '';
        status.textContent = 'Интервал пуст — слайд не показывается';
      } else if (a < b) {
        fill.style.left = pa + '%';
        fill.style.width = (pb - pa) + '%';
        fill.style.background = '';
        status.textContent = 'Показ с ' + fmt(a) + ' до ' + fmt(b);
      } else {
        fill.style.left = '0';
        fill.style.width = '100%';
        fill.style.background = 'linear-gradient(to right, #5b6b12 0 ' + pb + '%, transparent ' + pb + '% ' + pa + '%, #5b6b12 ' + pa + '% 100%)';
        status.textContent = 'Показ с ' + fmt(a) + ' до ' + fmt(b) + ' — через полночь';
      }
      // Правый бегунок сверху, чтобы его можно было схватить при пересечении.
      fromInput.style.zIndex = a > b ? 3 : 2;
      toInput.style.zIndex = a > b ? 2 : 3;
      if (change) {
        sc.from = a === 0 ? '' : fmt(a);
        sc.to = b === 24 * 60 ? '' : fmt(b);
        refreshScheduleBadge(s);
        changed();
      }
    }
    fromInput.addEventListener('input', function () { update(true); });
    toInput.addEventListener('input', function () { update(true); });
    update(false);

    return h('div', { class: 'time-range' },
      h('div', { class: 'time-range__head' },
        h('span', null, 'С ', fromVal),
        h('span', null, 'По ', toVal)),
      h('div', { class: 'time-range__slider' },
        h('div', { class: 'time-range__inner' }, h('div', { class: 'time-range__track' }), fill),
        fromInput, toInput),
      h('div', { class: 'time-range__ticks' },
        ['00:00', '06:00', '12:00', '18:00', '24:00'].map(function (t) { return h('span', { text: t }); })),
      status);
  }

  /* Дисплей, выбранный в «Экранах» для настройки. null — общий список без дисплея. */
  function currentDisplay() {
    return (data.displays || []).filter(function (d) { return d.id === ui.displayId; })[0] || null;
  }
  /* Набор экранов дисплея. Пустая программа показывается как «все слайды» — так же, как в плеере. */
  function slidesOfDisplay(p) {
    if (!p) return data.slides.slice();
    var byId = {};
    data.slides.forEach(function (s) { byId[s.id] = s; });
    var ids = p.slides && p.slides.length ? p.slides : data.slides.map(function (s) { return s.id; });
    return ids.map(function (id) { return byId[id]; }).filter(Boolean);
  }
  /* Пустая программа означает «все слайды». Перед изменением набора фиксируем его явно. */
  function ensureDisplayProgram(p) {
    if (p && (!p.slides || !p.slides.length)) p.slides = data.slides.map(function (s) { return s.id; });
  }
  /* Видимость слайда на дисплее: его переключатель, иначе общий s.enabled. */
  function isSlideEnabled(p, s) {
    var map = p && p.slideEnabled;
    if (map && Object.prototype.hasOwnProperty.call(map, s.id)) return map[s.id] !== false;
    return s.enabled !== false;
  }

  function addSlide(s) {
    var p = currentDisplay();
    var programEmpty = p && (!p.slides || !p.slides.length);
    data.slides.push(s);
    if (p) {
      if (programEmpty) p.slides = data.slides.map(function (x) { return x.id; });
      else p.slides.push(s.id);
    }
    ui.slideId = s.id;
    changed(true); sendPreview();
  }

  /* «+ Афиша»: период (неделя / две недели) и вид (список, карточки, таймлайн). */
  function eventsMenu() {
    var menu = h('ul', { class: 'dropdown-menu shadow' });
    [['week', 'На неделю'], ['2weeks', 'На две недели']].forEach(function (r, ri) {
      if (ri) menu.appendChild(h('li', null, h('hr', { class: 'dropdown-divider' })));
      menu.appendChild(h('li', null, h('h6', { class: 'dropdown-header', text: r[1] })));
      Object.keys(M.EVENT_STYLES).forEach(function (style) {
        menu.appendChild(h('li', null, h('a', { class: 'dropdown-item', href: '#', text: M.EVENT_STYLES[style], onclick: function (e) {
          e.preventDefault();
          var s = M.newSlide('events');
          s.range = r[0]; s.style = style;
          if (r[0] === '2weeks') { s.title = 'Афиша'; s.subtitle = 'Ближайшие две недели'; }
          s.name = 'Афиша ' + r[1].toLowerCase() + ' · ' + M.EVENT_STYLES[style].toLowerCase();
          addSlide(s);
          toast('Добавлен слайд: ' + s.name);
        } })));
      });
    });
    return h('div', { class: 'dropdown' },
      h('button', { type: 'button', class: 'btn btn-outline-secondary dropdown-toggle', 'data-bs-toggle': 'dropdown', 'aria-expanded': 'false', text: '+ Афиша' }), menu);
  }

  /* «+ Блюда»: выбор вида слайда из всех раскладок, сгруппированных по составу. */
  function dishLayoutMenu() {
    var groups = [
      { title: 'Только текст', test: function (L) { return !L.photos; } },
      { title: 'Только фото', test: function (L) { return L.photos && !L.texts; } },
      { title: 'Фото + текст', test: function (L) { return L.photos && L.texts; } }
    ];
    var menu = h('ul', { class: 'dropdown-menu shadow', style: 'max-height:70vh;overflow:auto' });
    groups.forEach(function (g, gi) {
      if (gi) menu.appendChild(h('li', null, h('hr', { class: 'dropdown-divider' })));
      menu.appendChild(h('li', null, h('h6', { class: 'dropdown-header', text: g.title })));
      Object.keys(M.LAYOUTS).filter(function (k) { return g.test(M.LAYOUTS[k]); }).forEach(function (k) {
        var L = M.LAYOUTS[k];
        menu.appendChild(h('li', null, h('a', { class: 'dropdown-item d-flex justify-content-between gap-3', href: '#', onclick: function (e) {
          e.preventDefault();
          var sl = M.newSlide('dishes');
          sl.layout = k; sl.name = L.label; sl.title = 'Меню';
          M.fillSlide(sl, data);
          addSlide(sl);
          toast('Добавлен слайд: ' + L.label);
        } }, h('span', { text: L.label }), h('span', { class: 'badge text-bg-light border', text: '📷 ' + L.photos + ' · ✎ ' + L.texts }))));
      });
    });
    return h('div', { class: 'dropdown' },
      h('button', { type: 'button', class: 'btn btn-outline-secondary dropdown-toggle', 'data-bs-toggle': 'dropdown', 'aria-expanded': 'false', text: '+ Блюда' }), menu);
  }

  /* Выбор дисплея в «Экранах»: список и порядок слайдов принадлежат выбранному дисплею. */
  function displayPicker(mode) {
    var design = mode === 'design';
    var p = currentDisplay();
    var sl = h('select', { class: 'form-select form-select-sm w-auto', id: 'screenDisplay' });
    sl.appendChild(h('option', { value: '', text: design ? 'Общие настройки (без дисплея)' : 'Все экраны · без дисплея' }));
    (data.displays || []).forEach(function (d) {
      var size = M.displaySize(d);
      sl.appendChild(h('option', { value: d.id, text: (d.name || 'Дисплей') + ' · ' +
        (d.orientation === 'horizontal' ? 'горизонтально' : 'вертикально') + ' · ' + size.width + '×' + size.height }));
    });
    sl.value = ui.displayId || '';
    sl.addEventListener('change', function () { setDisplay(sl.value); });
    var hint;
    if (design) {
      hint = !data.displays.length
        ? 'Дисплеев пока нет — настройки общие.'
        : p
          ? 'Настройки ниже сохраняются и применяются только к этому дисплею.'
          : 'Общие настройки: новый дисплей копирует их, у существующих могут быть свои.';
    } else {
      hint = !data.displays.length
        ? 'Дисплеев пока нет — создайте во вкладке «Дисплеи».'
        : p
          ? (p.slides && p.slides.length
            ? 'Показаны экраны этого дисплея. Порядок в списке = порядок показа.'
            : 'Программа не задана — показываются все экраны; любое изменение закрепит набор.')
          : 'Общий список всех экранов. Выберите дисплей, чтобы настроить его набор.';
    }
    return h('div', { class: 'card shadow-sm mb-3' }, h('div', { class: 'card-body py-2 d-flex flex-wrap align-items-center gap-2' },
      h('label', { class: 'form-label small fw-semibold text-body-secondary mb-0', for: 'screenDisplay', text: 'Дисплей для настройки' }),
      sl,
      h('div', { class: 'form-text mb-0' }, hint)));
  }

  /* Переключение дисплея: список в «Экранах»/«Оформлении», выбор в шапке предпросмотра и формат кадра. */
  function setDisplay(id) {
    ui.displayId = id || '';
    var first = slidesOfDisplay(currentDisplay())[0];
    ui.slideId = first ? first.id : null;
    fillPreviewDisplays();
    if (ui.tab === 'slides' || ui.tab === 'design') render();
    scalePreview();
    sendPreview();
  }

  function renderSlides() {
    var p = currentDisplay();
    var viewSettings = activeSettings();
    var listSlides = slidesOfDisplay(p);
    var sel = listSlides.filter(function (s) { return s.id === ui.slideId; })[0];
    if (!sel && listSlides.length) { sel = listSlides[0]; ui.slideId = sel.id; }
    if (!listSlides.length) ui.slideId = null;

    var head = pageHead('Экраны', p
      ? 'Экраны дисплея «' + (p.name || 'Дисплей') + '». Порядок в списке = порядок показа на этом экране.'
      : 'Каждый слайд — один экран витрины. Порядок в списке = порядок показа.', [
      dishLayoutMenu(),
      eventsMenu(),
      btn('+ Инфо', function () { addSlide(M.newSlide('info')); }),
      btn('+ Объявление', function () { addSlide(M.newSlide('announce')); }),
      btn('+ Обратный отсчёт', function () { addSlide(M.newSlide('countdown')); }),
      btn('Сгенерировать комбинации', generate, 'btn-primary')
    ]);

    var list = h('div', { class: 'list-group slides' });
    listSlides.forEach(function (s, i) {
      var sched = scheduleSummary(s);
      var shown = isSlideEnabled(p, s);
      var cb = h('input', { class: 'form-check-input m-0', type: 'checkbox', title: p ? 'Показывать на этом дисплее' : 'Показывать по умолчанию на всех дисплеях', checked: shown, onclick: function (e) { e.stopPropagation(); } });
      cb.addEventListener('change', function () {
        if (p) {
          p.slideEnabled = p.slideEnabled || {};
          p.slideEnabled[s.id] = cb.checked;
        } else {
          s.enabled = cb.checked;
        }
        changed(true);
      });
      list.appendChild(h('div', { class: 'list-group-item list-group-item-action slide-item d-flex align-items-center gap-3' + (s.id === ui.slideId ? ' active' : '') + (shown ? '' : ' is-off'),
        onclick: function () { ui.slideId = s.id; render(); sendPreview(); } },
        h('span', { class: 'slide-num rounded-circle bg-body-secondary d-grid align-items-center justify-content-center small fw-bold', text: String(i + 1) }),
        cb,
        h('div', { class: 'flex-grow-1 min-w-0' },
          h('div', { class: 'fw-semibold' }, s.name || s.title || 'Без названия', ' ',
            h('span', { class: 'badge rounded-pill text-bg-light border', text: { dishes: 'блюда', events: 'афиша', info: 'инфо', announce: 'объявление', countdown: 'отсчёт' }[s.type] || s.type }), ' ',
            s.nearest && s.nearest.enabled ? h('span', { class: 'badge rounded-pill text-bg-warning', text: 'ближайшее' }) : null, ' ',
            s.showTitle === false ? h('span', { class: 'badge rounded-pill text-bg-light border', text: 'без заголовка' }) : null, ' ',
            h('span', { class: 'badge rounded-pill text-bg-info', 'data-schedule-for': s.id, style: sched ? null : 'display:none', text: sched ? '⏰ ' + sched : '' })),
          h('div', { class: 'small text-body-secondary text-truncate', text: slideSummary(s) + ' · ' + (s.duration || viewSettings.slideDuration) + ' с · ' +
            M.ANIMATION_PRESETS[(s.animation && s.animation.preset) || viewSettings.animation.preset] })),
        h('div', { class: 'btn-group btn-group-sm', onclick: function (e) { e.stopPropagation(); } },
          btn('↑', function () { moveSlide(s, -1); }, 'btn-outline-secondary', { title: 'Выше', disabled: i === 0 }),
          btn('↓', function () { moveSlide(s, 1); }, 'btn-outline-secondary', { title: 'Ниже', disabled: i === listSlides.length - 1 }),
          btn('⧉', function () { duplicateSlide(s); }, 'btn-outline-secondary', { title: 'Дублировать' }),
          btn('✕', function () { removeSlide(s); }, 'btn-outline-danger', { title: p ? 'Убрать из дисплея' : 'Удалить' }))));
    });
    if (!listSlides.length) list.appendChild(h('div', { class: 'list-group-item text-body-secondary', text: p
      ? 'У дисплея пока нет экранов — добавьте их кнопками выше.'
      : 'Слайдов пока нет — добавьте вручную или сгенерируйте комбинации.' }));
    setTimeout(function () { var el = list.querySelector('.active'); if (el) list.scrollTop = el.offsetTop - list.clientHeight / 2; }, 0);

    return h('div', null, displayPicker('screens'), head, h('div', { class: 'card shadow-sm mb-3' }, list), sel ? slideEditor(sel) : null);
  }

  function moveSlide(s, d) {
    var p = currentDisplay();
    if (p) {
      ensureDisplayProgram(p);
      var j = p.slides.indexOf(s.id);
      if (j < 0 || j + d < 0 || j + d >= p.slides.length) return;
      p.slides.splice(j, 1);
      p.slides.splice(j + d, 0, s.id);
    } else {
      var i = data.slides.indexOf(s);
      if (i < 0 || i + d < 0 || i + d >= data.slides.length) return;
      data.slides.splice(i, 1);
      data.slides.splice(i + d, 0, s);
    }
    changed(true);
  }

  /* ✕ в «Экранах»: у выбранного дисплея — убрать из набора, в общем списке — удалить совсем. */
  function removeSlide(s) {
    var p = currentDisplay();
    if (p) {
      if (p.slides && p.slides.length === 1) { toast('Нельзя убрать последний экран дисплея — сначала добавьте другой.'); return; }
      if ((!p.slides || !p.slides.length) && data.slides.length <= 1) { toast('Нельзя оставить дисплей без экранов.'); return; }
      if (!confirm('Убрать слайд «' + (s.name || s.title) + '» из дисплея «' + (p.name || 'Дисплей') + '»?\nСам слайд останется в общем списке.')) return;
      ensureDisplayProgram(p);
      p.slides = p.slides.filter(function (id) { return id !== s.id; });
      if (p.slideEnabled) delete p.slideEnabled[s.id];
      ui.slideId = null;
      changed(true); sendPreview();
      return;
    }
    var sole = (data.displays || []).filter(function (d) { return d.slides && d.slides.length === 1 && d.slides[0] === s.id; })[0];
    if (sole) { toast('Слайд — единственный экран дисплея «' + (sole.name || 'Дисплей') + '». Сначала добавьте другой экран.'); return; }
    var used = (data.displays || []).filter(function (d) { return (d.slides || []).indexOf(s.id) !== -1; }).length;
    if (!confirm('Удалить слайд «' + (s.name || s.title) + '»?' + (used ? '\nОн входит в программу дисплеев: ' + used + '. Слайд будет удалён у всех.' : ''))) return;
    data.slides = data.slides.filter(function (x) { return x !== s; });
    (data.displays || []).forEach(function (d) {
      if (d.slides) d.slides = d.slides.filter(function (id) { return id !== s.id; });
      if (d.slideEnabled) delete d.slideEnabled[s.id];
    });
    ui.slideId = null;
    changed(true); sendPreview();
  }

  function duplicateSlide(s) {
    var p = currentDisplay();
    var c = M.clone(s);
    c.id = M.uid('slide');
    c.name = (s.name || '') + ' (копия)';
    data.slides.splice(data.slides.indexOf(s) + 1, 0, c);
    if (p && p.slides && p.slides.length) {
      var j = p.slides.indexOf(s.id);
      if (j !== -1) p.slides.splice(j + 1, 0, c.id);
    }
    ui.slideId = c.id;
    changed(true); sendPreview();
  }

  function generate() {
    if (!data.dishes.length) { toast('Сначала добавьте блюда'); return; }
    var photoCount = data.dishes.filter(function (d) { return d.photo && d.active !== false; }).length;
    var p = currentDisplay();
    var current = p ? slidesOfDisplay(p) : data.slides;
    var replace = current.length
      ? confirm((p ? 'Заменить экраны дисплея «' + (p.name || 'Дисплей') + '»' : 'Заменить текущие слайды') + ' сгенерированным набором?\n\nОК — заменить, Отмена — добавить в конец.')
      : true;
    var gen = M.generateSlides(data);
    if (p) {
      if (!replace && (!p.slides || !p.slides.length)) ensureDisplayProgram(p);
      data.slides = data.slides.concat(gen);
      p.slides = replace ? gen.map(function (s) { return s.id; }) : (p.slides || []).concat(gen.map(function (s) { return s.id; }));
      if (replace) p.slideEnabled = {};
    } else {
      data.slides = replace ? gen : data.slides.concat(gen);
      // Общий набор заменён: программы дисплеев больше не ссылаются на старые слайды.
      if (replace) (data.displays || []).forEach(function (d) { d.slides = []; d.slideEnabled = {}; });
    }
    ui.slideId = gen[0] && gen[0].id;
    changed(true); sendPreview();
    toast('Сгенерировано слайдов: ' + gen.length + (photoCount ? '' : ' (без фото — только текстовые)'));
  }

  function dishOptions(onlyPhoto) {
    var o = {};
    data.dishes.forEach(function (d) {
      if (onlyPhoto && !d.photo) return;
      o[d.id] = d.name + (d.price !== '' && d.price != null ? ' — ' + d.price : '') + (d.photo && !onlyPhoto ? ' 📷' : '') + (d.active === false ? ' (скрыто)' : '');
    });
    return o;
  }

  function slots(arr, count, options, emptyLabel) {
    var box = h('div', { class: 'd-flex flex-column gap-2' });
    for (var i = 0; i < count; i++) {
      (function (i) {
        var holder = { v: arr[i] || '' };
        var sel = select(holder, 'v', options, { empty: emptyLabel, sm: true });
        sel.addEventListener('change', function () {
          arr[i] = holder.v;
          while (arr.length && !arr[arr.length - 1]) arr.pop();
          for (var j = 0; j < arr.length; j++) if (arr[j] == null) arr[j] = '';
          changed();
        });
        box.appendChild(h('div', { class: 'input-group input-group-sm' }, h('span', { class: 'input-group-text', style: 'width:36px', text: String(i + 1) }), sel));
      })(i);
    }
    return box;
  }

  function animationEditor(a, withInherit, owner) {
    var box = h('div');
    if (withInherit) {
      var holder = { v: !owner.animation };
      var sw = checkbox(holder, 'v', 'Как в общих настройках');
      sw.querySelector('input').addEventListener('change', function () {
        owner.animation = holder.v ? null : M.normalizeAnimation(M.clone(activeSettings().animation));
        changed(true);
      });
      box.appendChild(sw);
      if (!owner.animation) return box;
      a = owner.animation;
      box.appendChild(h('div', { class: 'mb-3' }));
    }
    var sec2 = function (title, content) { return h('div', { class: 'mt-3' }, h('div', { class: 'small fw-bold text-uppercase text-body-secondary mb-2', text: title }), content); };
    var sec_ = function (v) { return Number(v).toFixed(1) + ' с'; };
    box.appendChild(row(
      field('Появление элементов', select(a, 'preset', M.ANIMATION_PRESETS)),
      field('Заголовок', select(a, 'title', M.TITLE_EFFECTS)),
      field('Порядок', select(a, 'order', M.ORDERS)),
      field('Скорость', range(a, 'speed', 0.5, 2, 0.1, function (v) { return '×' + Number(v).toFixed(1); })),
      field('Интервал между элементами', range(a, 'stagger', 0.02, 0.3, 0.01, function (v) { return Number(v).toFixed(2) + ' с'; }))
    ));
    box.appendChild(sec2('Изображения', row(
      field('Появление', select(a, 'photoIn', M.PHOTO_IN)),
      field('Постоянный эффект', select(a, 'photoLoop', M.PHOTO_LOOP)),
      field('Длительность появления', range(a, 'photoDur', 0.3, 3, 0.1, sec_)))));
    box.appendChild(sec2('Названия блюд', row(
      field('Эффект', select(a, 'name', M.NAME_EFFECTS)),
      field('Длительность', range(a, 'nameDur', 0.2, 2, 0.1, sec_)))));
    box.appendChild(sec2('Цены', row(
      field('Появление', select(a, 'priceIn', M.PRICE_IN)),
      field('Постоянный эффект', select(a, 'priceLoop', M.PRICE_LOOP)),
      field('Длительность появления', range(a, 'priceDur', 0.2, 2, 0.1, sec_)))));
    return box;
  }

  function sec(title, open, body) {
    return h('details', { class: 'sec', open: open || null }, h('summary', { text: title }), body);
  }

  /* Размер текста на слайде: свой или как в общих настройках «Шрифты». */
  function sizesEditor(s) {
    s.sizes = s.sizes || { title: null, dish: null, text: null };
    var fonts = Object.assign(M.defaultFonts(), activeSettings().fonts || {});
    var defs = { title: fonts.headingScale, dish: fonts.dishScale, text: fonts.textScale };
    var names = { title: 'Заголовок', dish: 'Названия блюд и цены', text: 'Описания' };
    var r = row();
    Object.keys(names).forEach(function (k) {
      var own = s.sizes[k] != null;
      var holder = { v: own ? s.sizes[k] : defs[k] };
      var fmt = function (v) { return Math.round(v * 100) + '%' + (s.sizes[k] == null ? ' общий' : ''); };
      var rg = range(holder, 'v', 0.6, 2, 0.05, fmt);
      rg.querySelector('input').addEventListener('input', function () { s.sizes[k] = holder.v; rg.querySelector('.badge').textContent = fmt(holder.v); changed(); });
      r.appendChild(field(names[k], h('div', null, rg,
        own ? btn('как в общих', function () { s.sizes[k] = null; changed(true); }, 'btn-link btn-sm p-0') : null)));
    });
    return sec('Размер текста на слайде', true, r);
  }

  /* Положение каждой фотографии на слайде: смещение, размер, поворот, зеркало. */
  function photoPosEditor(s) {
    var L = M.LAYOUTS[s.layout];
    s.photoPos = s.photoPos || [];
    var box = h('div', { class: 'd-flex flex-column gap-3' });
    for (var i = 0; i < L.photos; i++) {
      (function (i) {
        var d = data.dishes.filter(function (x) { return x.id === (s.photoDishes || [])[i]; })[0];
        var pos = s.photoPos[i] = Object.assign(M.defaultPhotoPos(), s.photoPos[i] || {});
        box.appendChild(h('div', { class: 'border rounded-3 p-3' },
          h('div', { class: 'd-flex align-items-center gap-2 mb-2' },
            d && d.photo ? h('img', { class: 'pos-thumb', src: photoSrc(d.photo), alt: '' }) : null,
            h('strong', { class: 'me-auto', text: 'Фото ' + (i + 1) + (d ? ' · ' + d.name : '') }),
            btn('Сбросить', function () { s.photoPos[i] = M.defaultPhotoPos(); changed(true); }, 'btn-outline-secondary btn-sm')),
          row(
            field('Влево ↔ вправо', range(pos, 'x', -600, 600, 5, function (v) { return v + ' px'; })),
            field('Вверх ↕ вниз', range(pos, 'y', -600, 600, 5, function (v) { return v + ' px'; })),
            field('Размер', range(pos, 'scale', 0.4, 2, 0.02, function (v) { return Math.round(v * 100) + '%'; })),
            field('Поворот', range(pos, 'rotate', -180, 180, 1, function (v) { return v + '°'; })),
            field('Отражение', checkbox(pos, 'flip', 'Зеркально по горизонтали')))));
      })(i);
    }
    return sec('Положение фотографий на слайде', true, h('div', null, box,
      h('div', { class: 'form-text', text: 'Двигайте ползунки — предпросмотр справа обновляется сразу. Фото может выходить за край экрана, как в печатном меню.' })));
  }

  /* Элементы слайда: показ, свой эффект GSAP, длительность, задержка, смещение от запрограммированной точки. */
  function elementsEditor(s) {
    s.elements = s.elements || {};
    var effects = Object.assign({ '': 'как на слайде' }, M.ANIMATION_PRESETS);
    effects.none = 'Без анимации (сразу видно)';
    var numInput = function (obj, key, ph, step) {
      var el = input(obj, key, { type: 'number', sm: true, nullable: true, placeholder: ph, step: step });
      el.style.width = '84px';
      return el;
    };
    var rows = M.slideElements(s).map(function (item) {
      var c = s.elements[item.key] = Object.assign(M.defaultElement(), s.elements[item.key] || {});
      return h('tr', { class: c.visible === false ? 'is-off' : '' },
        h('td', { class: 'fw-semibold small', text: item.label }),
        h('td', null, checkbox(c, 'visible', '', { defaultOn: true, rerender: true })),
        h('td', null, select(c, 'effect', effects, { sm: true })),
        h('td', null, numInput(c, 'duration', '0.9', 0.1)),
        h('td', null, numInput(c, 'delay', '0.2', 0.1)),
        h('td', null, numInput(c, 'x', '0', 5)),
        h('td', null, numInput(c, 'y', '0', 5)),
        h('td', null, numInput(c, 'size', '100', 5)),
        h('td', null, btn('↺', function () { s.elements[item.key] = M.defaultElement(); changed(true); }, 'btn-outline-secondary btn-sm', { title: 'Сбросить' })));
    });
    return sec('Элементы слайда: эффекты и смещения', true, h('div', null,
      h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle mb-1' },
        h('thead', { class: 'table-light' }, h('tr', null, ['Элемент', 'Показ', 'Эффект GSAP', 'Длит., с', 'Задержка, с', 'X, px', 'Y, px', 'Размер, %', ''].map(function (t) { return h('th', { class: 'small', text: t }); }))),
        h('tbody', null, rows))),
      h('div', { class: 'form-text', text: 'Эффект «как на слайде» — элемент появляется в общей последовательности (раздел «Появление информации»). Свой эффект запускается отдельно: длительность и задержка от начала показа слайда. X/Y — сдвиг от штатного места в пикселях логического холста 1080×1920 (минус — влево/вверх), «Размер» — масштаб элемента в процентах.' })));
  }

  function slideEditor(s) {
    var body = h('div');
    var accent = h('input', { type: 'color', class: 'form-control form-control-color', value: s.accent || activeSettings().accent });
    accent.addEventListener('input', function () { s.accent = accent.value; changed(); });

    body.appendChild(row(
      field('Название в списке', input(s, 'name')),
      field('Заголовок на экране', input(s, 'title')),
      field('Подзаголовок (надстрочник)', input(s, 'subtitle')),
      field('Заголовок', h('div', { class: 'd-flex align-items-center gap-3' }, checkbox(s, 'showTitle', 'Показывать', { defaultOn: true, rerender: true }),
        select(s, 'titleAlign', M.TITLE_ALIGNS, { sm: true }))),
      field('Фон слайда', (function () {
        var holder = { v: s.bgGradient == null ? '' : (s.bgGradient ? 'on' : 'off') };
        var el = select(holder, 'v', { on: 'Анимированный градиент', off: 'Без градиента' }, { empty: 'Как в общих настройках (' + (activeSettings().bgGradient !== false ? 'градиент' : 'без градиента') + ')' });
        el.addEventListener('change', function () { s.bgGradient = holder.v === '' ? null : holder.v === 'on'; changed(); });
        return el;
      })()),
      field('Длительность, с', input(s, 'duration', { type: 'number', min: 3, max: 120, nullable: true, placeholder: 'по умолчанию ' + activeSettings().slideDuration })),
      field('Акцентный цвет', h('div', { class: 'd-flex gap-2' }, accent, btn('Общий', function () { s.accent = null; changed(true); }, 'btn-outline-secondary btn-sm')))
    ));

    if (s.type === 'dishes') {
      var L = M.LAYOUTS[s.layout] || M.LAYOUTS['text-10'];
      s.photoDishes = s.photoDishes || []; s.textDishes = s.textDishes || [];
      var layouts = Object.keys(M.LAYOUTS).reduce(function (o, k) { o[k] = M.LAYOUTS[k].label; return o; }, {});
      var cols = h('div', { class: 'row g-3 mt-1' });
      if (L.photos) {
        var photoOpts = dishOptions(true);
        cols.appendChild(h('div', { class: 'col-md-6' }, field('С фото (' + L.photos + ')', Object.keys(photoOpts).length ? slots(s.photoDishes, L.photos, photoOpts, '— не выбрано —')
          : h('div', { class: 'alert alert-warning py-2 small mb-0', text: 'Нет блюд с фото — загрузите обтравленные фото во вкладке «Блюда».' }))));
      }
      if (L.texts) cols.appendChild(h('div', { class: 'col-md-6' }, field('Текстом (до ' + L.texts + ')', slots(s.textDishes, L.texts, dishOptions(false), '—'))));
      body.appendChild(sec('Блюда на слайде', true, h('div', null, field('Раскладка (фото : текст)', select(s, 'layout', layouts, { rerender: true })), cols)));
    } else if (s.type === 'events') {
      s.show = s.show || { photo: true, description: true, price: true, tag: true };
      body.appendChild(sec('Содержимое афиши', true, h('div', null,
        row(
          field('Период', select(s, 'range', { week: 'Неделя (7 дней)', '2weeks': 'Две недели (14 дней)' })),
          field('Начало периода', select(s, 'start', { today: 'С сегодняшнего дня', monday: 'С понедельника текущей недели' })),
          field('Максимум событий', select(s, 'max', { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7' }, { number: true })),
          field('Вид', select(s, 'style', M.EVENT_STYLES)),
          field('Текст, если событий нет', input(s, 'emptyText'))),
        h('div', { class: 'd-flex flex-wrap gap-4 mt-3' },
          checkbox(s.show, 'photo', 'Фото'), checkbox(s.show, 'description', 'Описание'),
          checkbox(s.show, 'price', 'Стоимость'), checkbox(s.show, 'tag', 'Рубрика')),
        h('div', { class: 'form-text', text: 'У каждого события на экране — число, день недели, время и название. Прошедшие скрываются сами.' }))));
    } else if (s.type === 'countdown') {
      var evOpts = {};
      data.events.slice().sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); })
        .forEach(function (e) { evOpts[e.id] = e.date + ' ' + (e.time || '') + ' — ' + e.title; });
      var found = M.countdownEvent(data.events, s, new Date());
      body.appendChild(sec('Обратный отсчёт', true, h('div', null,
        row(field('Мероприятие', select(s, 'eventMode', M.COUNTDOWN_MODES, { rerender: true })),
          s.eventMode === 'event' ? field('Какое', select(s, 'eventId', evOpts, { empty: '— выберите —', rerender: true })) : null,
          field('Надпись над счётчиком', input(s, 'label', { placeholder: 'До начала' })),
          field('Текст, когда началось', input(s, 'startedText', { placeholder: 'Уже началось!' }))),
        h('div', { class: 'mt-3 d-flex align-items-center gap-3' },
          h('div', null, h('div', { class: 'form-label small fw-semibold text-body-secondary mb-1', text: 'Изображение' }), photoPicker(s, { plain: true })),
          h('div', { class: 'form-text', text: 'Если не задано — берётся фото мероприятия. Название, время и счётчик двигаются и масштабируются в «Элементах слайда».' })),
        h('div', { class: 'alert py-2 small mt-3 mb-0 ' + (found ? 'alert-success' : 'alert-warning'),
          text: found ? 'Сейчас отсчёт идёт до: ' + found.title + ' (' + found.date + ', ' + (found.time || '') + ')' : 'Сейчас подходящего мероприятия нет — на экране слайд будет пропущен.' }))));
    } else if (s.type === 'announce') {
      body.appendChild(sec('Объявление', true, h('div', null,
        row(field('Вид', select(s, 'variant', M.ANNOUNCE_STYLES, { rerender: true })),
          field('Пометка (плашка под текстом)', input(s, 'note', { placeholder: 'Акция до 30 сентября' }))),
        h('div', { class: 'mt-3' }, field('Текст объявления', textarea(s, 'text', { rows: 5, placeholder: 'Можно в несколько строк' }))),
        h('div', { class: 'mt-3 d-flex align-items-center gap-3' },
          h('div', null, h('div', { class: 'form-label small fw-semibold text-body-secondary mb-1', text: 'Фото' }), photoPicker(s, { plain: true })),
          h('div', { class: 'form-text', text: 'Фото показывается в видах «Фото сверху» и «Фото на весь экран». Подойдёт обычное фото, обтравка не нужна.' })))));
    } else if (s.type === 'info') {
      s.lines = s.lines || [];
      var linesBox = h('div', { class: 'd-flex flex-column gap-2' });
      s.lines.forEach(function (l, i) {
        linesBox.appendChild(h('div', { class: 'row g-2' },
          h('div', { class: 'col-md-4' }, input(l, 'label', { placeholder: 'Подпись' })),
          h('div', { class: 'col' }, textarea(l, 'value', { rows: 1, placeholder: 'Значение' })),
          h('div', { class: 'col-auto' }, btn('✕', function () { s.lines.splice(i, 1); changed(true); }, 'btn-outline-danger'))));
      });
      body.appendChild(sec('Строки', true, h('div', null, linesBox,
        btn('+ строка', function () { s.lines.push({ label: '', value: '' }); changed(true); }, 'btn-outline-secondary btn-sm mt-2'))));
    }

    body.appendChild(elementsEditor(s));
    if (s.type === 'dishes' && (M.LAYOUTS[s.layout] || {}).view === 'comp') body.appendChild(photoPosEditor(s));
    body.appendChild(sizesEditor(s));
    s.bg = s.bg && !Array.isArray(s.bg) ? s.bg : {};
    body.appendChild(sec('Градиент на фоне слайда', false, h('div', null,
      row(
        field('Цвет 1', colorChooser(s.bg, 'color1', 'общий')),
        field('Цвет 2', colorChooser(s.bg, 'color2', 'общий')),
        field('Скорость (×)', input(s.bg, 'speed', { type: 'number', min: 0.25, max: 4, step: 0.25, nullable: true, placeholder: 'общая' })),
        field('Яркость (×)', input(s.bg, 'intensity', { type: 'number', min: 0.3, max: 3, step: 0.1, nullable: true, placeholder: 'общая' }))),
      h('div', { class: 'form-text mt-2', text: 'Работает, если фон слайда — «Анимированный градиент» (или так в общих настройках).' }))));
    s.colors = s.colors && !Array.isArray(s.colors) ? s.colors : {};
    body.appendChild(sec('Цвета надписей на слайде', false, h('div', null, colorsTable(s.colors, 'общий'),
      h('div', { class: 'form-text mt-2', text: '«общий» — как в разделе «Анимация и оформление → Цвета надписей».' }))));

    s.nearest = s.nearest || { enabled: false, count: 2 };
    body.appendChild(sec('Ближайшее расписание мероприятий', true, h('div', { class: 'd-flex flex-wrap align-items-center gap-3' },
      checkbox(s.nearest, 'enabled', 'Показывать внизу слайда блок «Скоро у нас»'),
      h('div', { class: 'd-flex align-items-center gap-2' }, h('span', { class: 'small text-body-secondary', text: 'Событий:' }),
        select(s.nearest, 'count', { 1: '1', 2: '2', 3: '3' }, { number: true, sm: true })))));

    s.schedule = s.schedule || { days: [], from: '', to: '', dateFrom: '', dateTo: '' };
    var days = h('div', { class: 'btn-group flex-wrap', role: 'group' });
    DAYS.forEach(function (d, i) {
      var n = i + 1, id = 'd' + (++uidN);
      var cb = h('input', { type: 'checkbox', class: 'btn-check', id: id, autocomplete: 'off', checked: s.schedule.days.indexOf(n) !== -1 });
      cb.addEventListener('change', function () {
        var arr = s.schedule.days.filter(function (x) { return x !== n; });
        if (cb.checked) arr.push(n);
        s.schedule.days = arr.sort();
        refreshScheduleBadge(s);
        changed();
      });
      days.appendChild(cb);
      days.appendChild(h('label', { class: 'btn btn-outline-primary btn-sm', for: id, text: d }));
    });
    body.appendChild(sec('Когда показывать слайд', false, h('div', null,
      field('Дни недели (не выбрано — каждый день)', days),
      h('div', { class: 'row g-3 mt-1' },
        h('div', { class: 'col-12' }, field('Время показа', timeRange(s.schedule, s))),
        h('div', { class: 'col-md-6' }, field('С даты', input(s.schedule, 'dateFrom', { type: 'date', onChange: function () { refreshScheduleBadge(s); } }))),
        h('div', { class: 'col-md-6' }, field('По дату', input(s.schedule, 'dateTo', { type: 'date', onChange: function () { refreshScheduleBadge(s); } })))),
      h('div', { class: 'form-text', text: 'Бегунок «С–По» задаёт часы показа; по умолчанию — все сутки. Если «По» левее «С», показ идёт через полночь (например, 22:00–02:00).' }))));

    body.appendChild(sec('Появление информации', true, animationEditor(s.animation, true, s)));
    return card('Настройки слайда', body, btn('↻ Повторить анимацию', replay, 'btn-outline-secondary btn-sm'));
  }

  /* ===== Дисплеи =====
     Физический экран: имя, ориентация и своя программа — упорядоченный список id слайдов.
     На экране плеер открывается с ?display=<id> и крутит только выбранные слайды. */

  function refreshPreviewForDisplay(p) {
    fillPreviewDisplays();
    if (p.id === ui.displayId) { scalePreview(); sendPreview(); }
  }

  function renderDisplays() {
    var byId = {};
    data.slides.forEach(function (s) { byId[s.id] = s; });

    var cards = (data.displays || []).map(function (p, pi) {
      // Набор: явная программа дисплея; пустая — все слайды, как в плеере.
      var explicit = (p.slides || []).filter(function (id) { return byId[id]; });
      var chosen = explicit.length ? explicit : data.slides.map(function (s) { return s.id; });
      var rest = data.slides.filter(function (s) { return chosen.indexOf(s.id) === -1; }).map(function (s) { return s.id; });
      var order = chosen.concat(rest);

      var rows = order.map(function (id) {
        var s = byId[id], on = chosen.indexOf(id) !== -1;
        var shown = isSlideEnabled(p, s);
        var ci = chosen.indexOf(id);
        var cb = h('input', { class: 'form-check-input m-0', type: 'checkbox', checked: on, title: 'В программе дисплея' });
        cb.addEventListener('change', function () {
          if (!cb.checked) {
            if (data.slides.length <= 1) { cb.checked = true; toast('Нельзя оставить дисплей без экранов.'); return; }
            ensureDisplayProgram(p);
            if (p.slides.length <= 1) { cb.checked = true; toast('Нельзя оставить дисплей без экранов.'); return; }
            p.slides = p.slides.filter(function (x) { return x !== id; });
          } else {
            ensureDisplayProgram(p);
            if (p.slides.indexOf(id) === -1) p.slides.push(id);
          }
          changed(true);
        });
        return h('div', { class: 'list-group-item d-flex align-items-center gap-2' + (on ? '' : ' is-off') },
          cb,
          h('span', { class: 'flex-grow-1 min-w-0 text-truncate' + (shown ? '' : ' text-body-secondary'), text: (s.name || s.title || 'Без названия') }),
          on ? h('div', { class: 'btn-group btn-group-sm' },
            btn('↑', function () { ensureDisplayProgram(p); var j = p.slides.indexOf(id); if (j > 0) { p.slides.splice(j, 1); p.slides.splice(j - 1, 0, id); changed(true); } }, 'btn-outline-secondary', { title: 'Раньше', disabled: ci === 0 }),
            btn('↓', function () { ensureDisplayProgram(p); var j = p.slides.indexOf(id); if (j >= 0 && j < p.slides.length - 1) { p.slides.splice(j, 1); p.slides.splice(j + 1, 0, id); changed(true); } }, 'btn-outline-secondary', { title: 'Позже', disabled: ci === chosen.length - 1 })) : null);
      });

      var url = location.origin + location.pathname.replace(/admin\/?$/, '') + '?display=' + encodeURIComponent(p.id);
      return card(null, h('div', null,
        h('div', { class: 'row g-3 mb-3' },
          field('Название', input(p, 'name', { onChange: fillPreviewDisplays })),
          field('Ориентация', select(p, 'orientation', M.ORIENTATIONS, { rerender: true, onChange: function () { refreshPreviewForDisplay(p); } })),
          field('Разрешение', select(p, 'resolution', M.DISPLAY_RESOLUTIONS, { number: true, rerender: true, onChange: function () { refreshPreviewForDisplay(p); } })),
          h('div', { class: 'col-12' },
            h('div', { class: 'form-label small fw-semibold text-body-secondary mb-1', text: 'Адрес экрана' }),
            h('div', { class: 'input-group input-group-sm' },
              h('input', { class: 'form-control', readonly: true, value: url }),
              btn('Копировать', function () { navigator.clipboard && navigator.clipboard.writeText(url).then(function () { toast('Ссылка скопирована'); }); }, 'btn-outline-secondary')))),
        h('div', { class: 'form-label small fw-semibold text-body-secondary', text: 'Экраны дисплея: ' + chosen.length + ' из ' + data.slides.length }),
        h('div', { class: 'list-group list-group-flush border rounded' }, rows.length ? rows : h('div', { class: 'list-group-item text-body-secondary', text: 'Слайдов нет — добавьте во вкладке «Экраны».' })),
        h('div', { class: 'd-flex flex-wrap gap-2 mt-3' },
          btn('Настроить экраны', function () { setDisplay(p.id); ui.tab = 'slides'; window.scrollTo(0, 0); render(); }, 'btn-outline-primary btn-sm'),
          btn('Предпросмотр', function () { setDisplay(p.id); }, 'btn-outline-secondary btn-sm'),
          btn('✕ Удалить', function () {
            if (!confirm('Удалить дисплей «' + (p.name || 'Дисплей') + '»? Слайды останутся в общем списке.')) return;
            data.displays.splice(pi, 1);
            if (ui.displayId === p.id) setDisplay((data.displays[0] && data.displays[0].id) || '');
            else { fillPreviewDisplays(); scalePreview(); sendPreview(); }
            changed(true);
          }, 'btn-outline-danger btn-sm'))));
    });

    return h('div', null,
      pageHead('Дисплеи', 'Физические экраны витрины. У каждого — свои экраны, порядок показа и ориентация; адрес экрана открывается на устройстве.', [
        btn('+ Дисплей', function () {
          var p = M.newDisplay();
          p.slides = data.slides.map(function (s) { return s.id; });
          p.settings = M.displaySettings(data.settings, null);
          p.cafe = M.displayCafe(data, null);
          p.ticker = M.displayTicker(data, null);
          data.displays.push(p);
          setDisplay(p.id);
          changed(true);
        }, 'btn-primary')
      ]),
      data.displays.length ? cards : card('Дисплеев пока нет', h('p', { class: 'text-body-secondary mb-0' },
        'Без дисплея экран показывает все слайды вертикально (как раньше). Создайте дисплей, чтобы задать ему свой набор экранов и горизонтальную ориентацию.')));
  }

  /* ===== Блюда ===== */

  function renderDishes() {
    var q = ui.dishFilter.toLowerCase();
    var rows = data.dishes.filter(function (d) {
      if (ui.dishPhoto === 'photo' && !d.photo) return false;
      if (ui.dishPhoto === 'text' && d.photo) return false;
      return !q || (d.name + ' ' + (d.category || '')).toLowerCase().indexOf(q) !== -1;
    });
    var search = h('input', { type: 'search', class: 'form-control', placeholder: 'Поиск по названию или категории', value: ui.dishFilter, id: 'dishSearch' });
    search.addEventListener('input', function () {
      ui.dishFilter = search.value; var pos = search.selectionStart; render();
      var s2 = document.getElementById('dishSearch'); s2.focus(); s2.setSelectionRange(pos, pos);
    });
    var withPhoto = data.dishes.filter(function (d) { return d.photo; }).length;

    var table = h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm table-hover align-middle mb-0' },
      h('thead', { class: 'table-light' }, h('tr', null, ['Фото', 'Название / описание', 'Категория', 'Вес / объём', 'Цена', 'Старая цена', 'Метка', 'Акцент', 'New', 'В витрине', ''].map(function (t) { return h('th', { class: 'small', text: t }); }))),
      h('tbody', null, rows.map(function (d) {
        return h('tr', { class: d.active === false ? 'is-off' : '' },
          h('td', null, photoPicker(d)),
          h('td', { style: 'min-width:220px' }, input(d, 'name', { sm: true }), h('div', { class: 'mt-1' }, textarea(d, 'description', { rows: 1, sm: true, placeholder: 'Описание (необязательно)' }))),
          h('td', { class: 'col-sm' }, input(d, 'category', { sm: true })),
          h('td', { class: 'col-sm' }, input(d, 'weight', { sm: true, placeholder: '250 г' })),
          h('td', { class: 'col-num' }, input(d, 'price', { type: 'number', min: 0, sm: true })),
          h('td', { class: 'col-num' }, input(d, 'oldPrice', { type: 'number', min: 0, nullable: true, sm: true })),
          h('td', { class: 'col-sm' }, input(d, 'tag', { sm: true, placeholder: 'хит' })),
          h('td', { title: 'Акцентировать блюдо и цену' }, checkbox(d, 'accent', '')),
          h('td', { title: 'Значок NEW' }, checkbox(d, 'isNew', '')),
          h('td', null, checkbox(d, 'active', '', { defaultOn: true, rerender: true })),
          h('td', null, btn('✕', function () {
            if (!confirm('Удалить «' + d.name + '»?')) return;
            data.dishes = data.dishes.filter(function (x) { return x !== d; });
            data.slides.forEach(function (s) {
              if (s.photoDishes) s.photoDishes = s.photoDishes.filter(function (id) { return id !== d.id; });
              if (s.textDishes) s.textDishes = s.textDishes.filter(function (id) { return id !== d.id; });
            });
            changed(true);
          }, 'btn-outline-danger btn-sm', { title: 'Удалить' })));
      }))));

    return h('div', null,
      pageHead('Ассортимент', 'Всего ' + data.dishes.length + ' · с фото ' + withPhoto + ' · без фото ' + (data.dishes.length - withPhoto) +
        '. Фото — обтравленные, на прозрачном фоне (PNG/WebP).', [btn('+ Блюдо', function () { data.dishes.unshift(M.newDish()); ui.dishFilter = ''; changed(true); }, 'btn-primary')]),
      h('div', { class: 'card shadow-sm' }, h('div', { class: 'card-body' },
        h('div', { class: 'row g-2 mb-3' }, h('div', { class: 'col-md-6' }, search),
          h('div', { class: 'col-md-3' }, select(ui, 'dishPhoto', { all: 'Все блюда', photo: 'Только с фото', text: 'Только без фото' }, { rerender: true }))),
        table)));
  }

  /* ===== Мероприятия ===== */

  function renderEvents() {
    var now = new Date();
    var sorted = data.events.slice().sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    var list = sorted.filter(function (e) { return ui.showPast || new Date(e.date + 'T23:59') >= now; });
    var soon = M.upcoming(data.events, now);
    var week = soon.filter(function (e) { return e.date < M.dateKey(M.addDays(now, 7)); }).length;
    var two = soon.filter(function (e) { return e.date < M.dateKey(M.addDays(now, 14)); }).length;

    var table = h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm table-hover align-middle mb-0' },
      h('thead', { class: 'table-light' }, h('tr', null, ['Фото', 'Дата', 'Начало', 'Конец', 'Название / описание', 'Рубрика', 'Стоимость', 'Выделить', 'Показ', ''].map(function (t) { return h('th', { class: 'small', text: t }); }))),
      h('tbody', null, list.map(function (e) {
        var past = new Date(e.date + 'T23:59') < now;
        return h('tr', { class: (e.active === false ? 'is-off ' : '') + (past ? 'table-secondary' : '') },
          h('td', null, photoPicker(e)),
          h('td', { class: 'col-sm' }, input(e, 'date', { type: 'date', sm: true })),
          h('td', { class: 'col-num' }, input(e, 'time', { type: 'time', sm: true })),
          h('td', { class: 'col-num' }, input(e, 'endTime', { type: 'time', sm: true })),
          h('td', { style: 'min-width:220px' }, input(e, 'title', { sm: true }), h('div', { class: 'mt-1' }, textarea(e, 'description', { rows: 1, sm: true, placeholder: 'Описание' }))),
          h('td', { class: 'col-sm' }, input(e, 'tag', { sm: true, placeholder: 'Музыка' })),
          h('td', { class: 'col-sm' }, input(e, 'price', { sm: true, placeholder: 'Вход свободный' })),
          h('td', null, checkbox(e, 'highlight', '')),
          h('td', null, checkbox(e, 'active', '', { defaultOn: true, rerender: true })),
          h('td', null, btn('✕', function () {
            if (!confirm('Удалить «' + e.title + '»?')) return;
            data.events = data.events.filter(function (x) { return x !== e; }); changed(true);
          }, 'btn-outline-danger btn-sm')));
      }))));

    return h('div', null,
      pageHead('Мероприятия', 'Ближайшие 7 дней: ' + week + ' · 14 дней: ' + two + '. Афиша показывает до 7 событий: число, день недели, время, название.', [
        checkbox(ui, 'showPast', 'Показывать прошедшие', { rerender: true }),
        btn('+ Мероприятие', function () { data.events.push(M.newEvent()); changed(true); }, 'btn-primary')]),
      h('div', { class: 'card shadow-sm' }, h('div', { class: 'card-body' }, table)));
  }

  /* ===== Анимация и оформление ===== */

  /* Действующие настройки выбранного дисплея: на них ссылаются «как в общих» в редакторе слайда. */
  function activeSettings() {
    return M.displaySettings(data.settings, currentDisplay());
  }

  /* Выбор цвета надписи: «по умолчанию», цвет из палитры или свой. Значение — id палитры или #hex. */
  /* Палитра текущего контекста: у выбранного дисплея может быть своя. */
  function activePalette() {
    var p = currentDisplay();
    return p && p.settings && Array.isArray(p.settings.palette) && p.settings.palette.length ? p.settings.palette : data.settings.palette;
  }

  function colorChooser(target, role, inheritLabel, palette) {
    var colors = palette || activePalette();
    var box = h('div', { class: 'd-flex flex-wrap align-items-center gap-1' });
    function draw() {
      box.innerHTML = '';
      var val = target[role];
      box.appendChild(btn(inheritLabel, function () { delete target[role]; changed(); draw(); }, 'btn-sm ' + (!val ? 'btn-dark' : 'btn-outline-secondary')));
      colors.forEach(function (p) {
        box.appendChild(h('button', { type: 'button', class: 'swatch' + (val === p.id ? ' is-on' : ''), title: p.name, style: 'background:' + p.color,
          onclick: function () { target[role] = p.id; changed(); draw(); } }));
      });
      var custom = h('input', { type: 'color', class: 'form-control form-control-color form-control-sm swatch-custom' + (val && val[0] === '#' ? ' is-on' : ''), title: 'Свой цвет',
        value: M.resolveColor(val, colors) || '#ffffff' });
      custom.addEventListener('input', function () { target[role] = custom.value; changed(); });
      custom.addEventListener('change', draw);
      box.appendChild(custom);
    }
    draw();
    return box;
  }

  function colorsTable(target, inheritLabel, palette) {
    return h('div', { class: 'd-flex flex-column gap-2' }, Object.keys(M.TEXT_ROLES).map(function (role) {
      return h('div', { class: 'row g-2 align-items-center' },
        h('div', { class: 'col-md-4 small fw-semibold', text: M.TEXT_ROLES[role].label }),
        h('div', { class: 'col-md-8' }, colorChooser(target, role, inheritLabel, palette)));
    }));
  }

  function paletteCard(st) {
    var list = h('div', { class: 'd-flex flex-column gap-2' });
    st.palette.forEach(function (p, i) {
      var color = h('input', { type: 'color', class: 'form-control form-control-color', value: p.color });
      color.addEventListener('input', function () { p.color = color.value; changed(); });
      color.addEventListener('change', function () { render(); });
      list.appendChild(h('div', { class: 'd-flex align-items-center gap-2' }, color,
        h('div', { style: 'max-width:280px', class: 'flex-grow-1' }, input(p, 'name', { sm: true })),
        h('code', { class: 'small text-body-secondary', text: p.color }),
        btn('✕', function () { st.palette.splice(i, 1); changed(true); }, 'btn-outline-danger btn-sm', { title: 'Удалить цвет' })));
    });
    return card('Палитра цветов', h('div', null, list,
      h('div', { class: 'd-flex flex-wrap gap-2 mt-3' },
        btn('+ Цвет', function () { st.palette.push({ id: M.uid('c'), name: 'Новый цвет', color: '#ffffff' }); changed(true); }, 'btn-outline-primary btn-sm'),
        btn('Стандартная палитра', function () { if (confirm('Заменить палитру стандартной?')) { st.palette = M.defaultPalette(); changed(true); } }, 'btn-outline-secondary btn-sm')),
      h('div', { class: 'form-text mt-2', text: 'Надписи ссылаются на цвета палитры: поменяйте цвет здесь — изменятся все надписи этого цвета. Удалённый цвет заменяется цветом темы.' })));
  }

  function fontsCard(st) {
    st.fonts = Object.assign(M.defaultFonts(), st.fonts || {});
    var f = st.fonts;
    var opts = Object.keys(M.FONTS).reduce(function (o, k) { o[k] = M.FONTS[k].label; return o; }, {});
    var pct = function (v) { return Math.round(v * 100) + '%'; };
    function sample(key, text) {
      var el = h('div', { class: 'font-sample', text: text });
      el.style.fontFamily = (M.FONTS[f[key]] || {}).stack;
      el.style.fontWeight = (M.FONTS[f[key]] || {}).weight;
      return el;
    }
    return card('Шрифты', h('div', null,
      row(
        field('Заголовки слайдов', h('div', null, select(f, 'heading', opts, { rerender: true }), sample('heading', 'Блюдо дня'))),
        field('Названия блюд и цены', h('div', null, select(f, 'dish', opts, { rerender: true }), sample('dish', 'Томлёные щёки 1290'))),
        field('Описания и мелкий текст', h('div', null, select(f, 'text', opts, { rerender: true }), sample('text', 'С картофельным пюре и соусом демиглас'))),
        field('Размер заголовков', range(f, 'headingScale', 0.6, 2, 0.05, pct)),
        field('Размер названий и цен', range(f, 'dishScale', 0.6, 2, 0.05, pct)),
        field('Размер описаний', range(f, 'textScale', 0.6, 2, 0.05, pct))),
      h('div', { class: 'form-text mt-2', text: 'Это общие значения; у каждого слайда можно задать свой размер. Все шрифты лежат в сборке и работают без интернета. Calibri берётся из системы, иначе — метрически совместимый Carlito.' })));
  }

  /* Объекты, которые редактирует «Анимация и оформление»: настройки выбранного дисплея или общие. */
  function designTarget() {
    var p = currentDisplay();
    if (!p) return { display: null, settings: data.settings, cafe: data.cafe, ticker: data.ticker };
    if (!p.settings) p.settings = M.displaySettings(data.settings, p);
    else {
      var merged = M.displaySettings(data.settings, p);
      Object.keys(merged).forEach(function (k) { p.settings[k] = merged[k]; });
    }
    if (!p.cafe) p.cafe = M.displayCafe(data, p);
    else {
      var cafe = M.displayCafe(data, p);
      Object.keys(cafe).forEach(function (k) { if (p.cafe[k] === undefined) p.cafe[k] = cafe[k]; });
    }
    if (!Array.isArray(p.ticker)) p.ticker = M.displayTicker(data, p);
    return { display: p, settings: p.settings, cafe: p.cafe, ticker: p.ticker };
  }

  function renderDesign() {
    var target = designTarget();
    var st = target.settings;
    var cafe = target.cafe;
    var tickerHolder = { v: (target.ticker || []).join('\n') };
    var ticker = textarea(tickerHolder, 'v', { rows: 4 });
    ticker.addEventListener('input', function () {
      var items = tickerHolder.v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      if (target.display) target.display.ticker = items;
      else data.ticker = items;
    });
    var accent = h('input', { type: 'color', class: 'form-control form-control-color', value: st.accent });
    accent.addEventListener('input', function () { st.accent = accent.value; changed(); });

    return h('div', null,
      displayPicker('design'),
      pageHead('Анимация и оформление', target.display
        ? 'Настройки дисплея «' + (target.display.name || 'Дисплей') + '». Всё ниже сохраняется и применяется только к нему.'
        : 'Общие настройки для дисплеев без собственных. Слайд может переопределить появление информации и размеры текста.'),
      card('Переключение между слайдами', h('div', null, row(
        field('Эффект перехода', select(st.transition, 'effect', Object.keys(M.TRANSITIONS).reduce(function (o, k) { o[k] = M.TRANSITIONS[k].label; return o; }, {}))),
        field('Длительность перехода', range(st.transition, 'speed', 300, 3000, 100, function (v) { return v + ' мс'; })),
        field('Показ слайда по умолчанию, с', input(st, 'slideDuration', { type: 'number', min: 3, max: 120 }))),
        h('div', { class: 'mt-3' }, checkbox(st, 'progressEnabled', 'Показывать полосу оставшегося времени слайда', { defaultOn: true })),
        h('div', { class: 'form-text mt-2', text: 'Чтобы увидеть переходы, выберите «Вся программа» в предпросмотре.' }))),
      card('Появление информации на слайде (по умолчанию)', animationEditor(st.animation, false)),
      fontsCard(st),
      paletteCard(st),
      card('Цвета надписей', h('div', null, colorsTable(st.colors, 'тема', st.palette),
        h('div', { class: 'form-text mt-2', text: '«тема» — цвет по умолчанию из выбранной темы. У каждого слайда цвета можно переопределить в его настройках.' }))),
      card('Акцент на блюде и значок NEW', h('div', null,
        row(
          field('Как выделять акцентные блюда', select(st, 'accentStyle', M.ACCENT_STYLES)),
          field('Анимация цены акцентного блюда', select(st, 'accentAnim', M.ACCENT_ANIMS)),
          field('Текст значка', input(st.newBadge, 'text', { placeholder: 'NEW' })),
          field('Анимация значка', select(st.newBadge, 'anim', M.NEW_ANIMS))),
        h('div', { class: 'form-text mt-2', text: 'Отметьте блюда галочками «Акцент» и «New» во вкладке «Блюда». Акцент красит название и цену, значок NEW — звезда-стикер рядом с названием.' }))),
      card('Оформление', row(
        field('Тема', select(st, 'theme', M.THEMES)),
        field('Фон слайдов', checkbox(st, 'bgGradient', 'Лёгкий анимированный градиент', { defaultOn: true }), 'Общее значение; у слайда можно переопределить'),
        field('Акцентный цвет', accent),
        field('Валюта после цены', input(st, 'currency', { placeholder: 'пусто — как в печатном меню' })),
        field('Название и логотип', h('div', { class: 'form-text', text: 'Задаются в блоке «Шапка экрана» ниже.' })))),
      card('Анимированный градиент на фоне', h('div', null,
        row(
          field('Цвет 1 (левое верхнее пятно)', colorChooser(st.bg, 'color1', 'акцент', st.palette)),
          field('Цвет 2 (правое нижнее пятно)', colorChooser(st.bg, 'color2', 'тыквенный', st.palette)),
          field('Скорость изменения', range(st.bg, 'speed', 0.25, 4, 0.25, function (v) { return '×' + Number(v).toFixed(2).replace(/0$/, ''); })),
          field('Яркость', range(st.bg, 'intensity', 0.3, 3, 0.1, function (v) { return Math.round(v * 100) + '%'; }))),
        h('div', { class: 'form-text mt-2', text: 'Включается в блоке «Оформление» (общее значение) или в настройках слайда. Цвета и скорость можно переопределить на слайде.' }))),
      card('Шапка экрана', h('div', null,
        h('div', { class: 'd-flex flex-wrap align-items-start gap-4 mb-3' },
          h('div', null, h('div', { class: 'form-label small fw-semibold text-body-secondary mb-1', text: 'Логотип' }), photoPicker(cafe, { key: 'logo', logo: true })),
          h('div', { class: 'flex-grow-1' }, row(
            field('Название', input(cafe, 'name', { placeholder: 'Название заведения' })),
            field('Подпись под названием', input(cafe, 'tagline', { placeholder: 'кафе · кухня весь день' }))))),
        checkbox(st.header, 'enabled', 'Показывать шапку', { defaultOn: true, rerender: true }),
        st.header.enabled !== false ? h('div', { class: 'd-flex flex-wrap gap-4 mt-3 ps-1' },
          checkbox(st.header, 'logo', 'Логотип', { defaultOn: true }),
          checkbox(st.header, 'name', 'Название', { defaultOn: true }),
          checkbox(st.header, 'tagline', 'Подпись', { defaultOn: true }),
          checkbox(st.header, 'clock', 'Часы', { defaultOn: true }),
          checkbox(st.header, 'date', 'Дата', { defaultOn: true })) : null,
        h('div', { class: 'form-text mt-2', text: 'Без шапки слайды занимают освободившуюся высоту экрана.' }))),
      card('Бегущая строка', h('div', null,
        h('div', { class: 'mb-3' }, checkbox(st, 'tickerEnabled', 'Показывать бегущую строку внизу экрана', { defaultOn: true, rerender: true })),
        field('Строки (каждая с новой строки)', ticker),
        h('div', { class: 'row g-3 mt-1' }, h('div', { class: 'col-md-4' }, field('Скорость, пикс/с', input(st, 'tickerSpeed', { type: 'number', min: 20, max: 300 })))))),
      card('Работа экрана', row(
        field('Проверять обновления, с', input(st, 'refreshInterval', { type: 'number', min: 10, max: 3600 })),
        field('Ежедневная перезагрузка', input(st, 'dailyReloadAt', { type: 'time' }), 'Освобождает память ТВ-браузера'),
        field('Автоперезагрузка, мин', input(st, 'autoRefreshMinutes', { type: 'number', min: 0, max: 1440 }),
          'Тег <meta http-equiv="refresh"> в шапке страницы: если что-то пошло не так, экран перезагрузится сам. 0 — выключено'))));
  }

  /* ===== Публикация ===== */

  function referencedPhotos() {
    var set = {};
    data.dishes.concat(data.events, data.slides).forEach(function (o) { if (o.photo) set[o.photo] = true; });
    if (data.cafe.logo) set[data.cafe.logo] = true;
    (data.displays || []).forEach(function (p) { if (p.cafe && p.cafe.logo) set[p.cafe.logo] = true; });
    return Object.keys(set);
  }

  function dataURLtoBase64(u) { return u.slice(u.indexOf(',') + 1); }

  function fetchBin(path) {
    return fetch('../' + path + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('Нет файла ' + path + ' (' + r.status + ')');
      return r.arrayBuffer();
    });
  }

  /* ZIP со статической сборкой: плеер + данные + фото. Работает без PHP и без интернета. */
  function buildZip(log) {
    var zip = new JSZip();
    var json = JSON.stringify(data, null, 2);
    log('Читаю список файлов плеера…');
    return fetch('../build-files.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (files) {
      return Promise.all(files.map(function (f) { return fetchBin(f).then(function (b) { zip.file(f, b); }); }).concat(
        ['SERVER.md', 'nginx.conf.example'].map(function (f) { return fetchBin('docs/' + f).then(function (b) { zip.file(f, b); }); })));
    }).then(function () {
      log('Файлы плеера добавлены. Добавляю фото…');
      return Promise.all(referencedPhotos().map(function (p) {
        if (/^(https?:|data:)/.test(p)) return null;
        if (media[p]) { zip.file(p, dataURLtoBase64(media[p]), { base64: true }); return null; }
        return fetchBin(p).then(function (b) { zip.file(p, b); }).catch(function (e) { log('⚠ ' + e.message); });
      }));
    }).then(function () {
      zip.file('content/data.json', json + '\n');
      zip.file('content/data.js', 'window.__TORSHER_DATA__ = ' + json + ';\n');
      zip.file('build.json', JSON.stringify({ commit: 'zip-' + new Date().toISOString(), builtAt: new Date().toISOString() }) + '\n');
      log('Упаковываю архив…');
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    });
  }

  function download(blob, name) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  /* Коммит в GitHub одним коммитом через Git Data API. */
  function gitPublish(cfg, log) {
    var base = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo;
    var headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    function call(method, path, body) {
      return fetch(base + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(method + ' ' + path + ': ' + r.status + ' ' + (j.message || ''));
          return j;
        });
      });
    }
    var parent, files = [{ path: 'content/data.json', content: JSON.stringify(data, null, 2) + '\n', encoding: 'utf-8' }];
    referencedPhotos().forEach(function (p) { if (media[p]) files.push({ path: p, content: dataURLtoBase64(media[p]), encoding: 'base64' }); });
    log('Ветка ' + cfg.branch + '…');
    return call('GET', '/git/ref/heads/' + encodeURIComponent(cfg.branch)).then(function (ref) {
      parent = ref.object.sha;
      return call('GET', '/git/commits/' + parent);
    }).then(function (commit) {
      log('Загружаю файлов: ' + files.length);
      return Promise.all(files.map(function (f) {
        return call('POST', '/git/blobs', { content: f.content, encoding: f.encoding }).then(function (b) { return { path: f.path, mode: '100644', type: 'blob', sha: b.sha }; });
      })).then(function (tree) { return call('POST', '/git/trees', { base_tree: commit.tree.sha, tree: tree }); });
    }).then(function (tree) {
      return call('POST', '/git/commits', { message: cfg.message || 'Обновление витрины из админки', tree: tree.sha, parents: [parent] });
    }).then(function (c) {
      return call('PATCH', '/git/refs/heads/' + encodeURIComponent(cfg.branch), { sha: c.sha }).then(function () { return c; });
    });
  }

  /* Хранение данных: в базе (MySQL) или в файлах на сервере; переключение переносит все данные. */
  function storagePanel() {
    var body = h('div', null, h('div', { class: 'small text-body-secondary', text: 'Проверяю хранилища…' }));
    var choice = { v: server.storage || 'db' };
    api('store.php').then(function (st) {
      choice.v = st.mode;
      body.innerHTML = '';
      var opts = [
        { key: 'db', title: 'В базе данных (MySQL)', text: 'Таблицы users, site, dishes, events, slides, media, options.', check: st.db },
        { key: 'files', title: 'В файлах на сервере', text: 'JSON-файлы в папке ' + st.files.dir + ' (закрыта от веба). Не нужна база данных.', check: st.files }
      ];
      opts.forEach(function (o) {
        var id = 'st-' + o.key;
        var inp = h('input', { class: 'form-check-input', type: 'radio', name: 'storage', id: id, value: o.key, checked: st.mode === o.key, disabled: !o.check.ok });
        inp.addEventListener('change', function () { choice.v = o.key; });
        body.appendChild(h('div', { class: 'form-check mb-2' }, inp,
          h('label', { class: 'form-check-label', for: id },
            h('strong', { text: o.title }), st.mode === o.key ? h('span', { class: 'badge text-bg-success ms-2', text: 'сейчас' }) : null,
            h('div', { class: 'small text-body-secondary', text: o.check.ok ? o.text : 'Недоступно: ' + o.check.error }))));
      });
      body.appendChild(h('div', { class: 'd-flex flex-wrap gap-2 mt-2' },
        btn('Переключить и перенести данные', function (e) {
          if (choice.v === st.mode) { toast('Этот режим уже включён'); return; }
          if (server.dirty) { toast('Сначала опубликуйте или отмените черновик'); return; }
          var name = choice.v === 'db' ? 'базу данных' : 'файлы';
          if (!confirm('Перенести все данные (блюда, мероприятия, слайды, пользователей, настройки FTP) в ' + name + ' и переключиться?\n\nСтарое хранилище не удаляется.')) return;
          var b = e.target; b.disabled = true;
          api('store.php', { method: 'POST', json: { action: 'switch', mode: choice.v } }).then(function (r) {
            server.storage = r.to;
            toast('Данные перенесены: блюд ' + r.dishes + ', слайдов ' + r.slides + ', пользователей ' + r.users);
            return serverLoad().then(function () { renderNavRight(); render(); sendPreview(); });
          }).catch(function (err) { toast('Ошибка: ' + err.message); b.disabled = false; });
        }, 'btn-primary')));
    }).catch(function (e) { body.innerHTML = ''; body.appendChild(h('div', { class: 'alert alert-danger py-2 small mb-0', text: e.message })); });
    return card('Хранение данных', h('div', null,
      h('p', { class: 'mb-3' }, 'Где сервер хранит данные витрины. При переключении всё содержимое переносится в выбранное хранилище; экраны продолжают работать без перерыва.'),
      body));
  }

  /* FTP: настройки хранятся на сервере, пароль шифруется и в браузер не возвращается. */
  function ftpPanel() {
    var f = { host: '', port: 21, user: '', password: '', dir: '/', ftps: false, passive: true };
    var logBox = h('div', { class: 'log' });
    function log(lines) { logBox.textContent += [].concat(lines).join('\n') + '\n'; logBox.scrollTop = 1e9; }
    var status = h('div', { class: 'small text-body-secondary mb-3', text: 'Загружаю настройки…' });
    var body = h('div');
    var pass = h('input', { type: 'password', class: 'form-control', autocomplete: 'new-password' });
    pass.addEventListener('input', function () { f.password = pass.value; });

    function field2(label, key, attrs) {
      var el = h('input', Object.assign({ class: 'form-control' }, attrs || {}));
      el.value = f[key] == null ? '' : f[key];
      el.addEventListener('input', function () { f[key] = attrs && attrs.type === 'number' ? Number(el.value) : el.value; });
      return field(label, el);
    }
    function sw(label, key) {
      var id = 'c' + (++uidN), el = h('input', { class: 'form-check-input', type: 'checkbox', role: 'switch', id: id, checked: !!f[key] });
      el.addEventListener('change', function () { f[key] = el.checked; });
      return h('div', { class: 'form-check form-switch' }, el, h('label', { class: 'form-check-label', for: id, text: label }));
    }
    function describe(st) {
      var parts = [];
      parts.push(st.hasPassword ? 'пароль сохранён' + (st.encrypted ? ' (зашифрован)' : ' — задайте app_key в api/config.php, чтобы хранить его зашифрованным') : 'пароль не задан');
      if (st.lastUpload) parts.push('последняя выгрузка: ' + new Date(st.lastUpload.at).toLocaleString('ru-RU') + ', ревизия ' + st.lastUpload.revision + ', файлов ' + st.lastUpload.sent);
      status.textContent = parts.join(' · ');
      status.className = 'small mb-3 ' + (st.hasPassword && !st.encrypted ? 'text-warning-emphasis' : 'text-body-secondary');
    }
    function draw() {
      body.innerHTML = '';
      body.appendChild(row(
        field2('Хост FTP', 'host', { placeholder: 'ftp.example.ru' }),
        field2('Порт', 'port', { type: 'number', min: 1, max: 65535 }),
        field2('Логин', 'user', { autocomplete: 'off' }),
        field('Пароль', pass, 'Оставьте пустым, чтобы не менять сохранённый'),
        field2('Папка на сервере', 'dir', { placeholder: '/public_html/display' })));
      body.appendChild(h('div', { class: 'd-flex flex-wrap gap-4 mt-3' }, sw('FTPS (шифрованное соединение)', 'ftps'), sw('Пассивный режим', 'passive')));
    }
    function call(action, extra) {
      return api('deploy.php', { method: 'POST', json: Object.assign({ action: action }, extra || {}) });
    }
    function save() {
      return call('save', { host: f.host, port: f.port, user: f.user, password: f.password, dir: f.dir, ftps: f.ftps, passive: f.passive })
        .then(function (r) { f.password = ''; pass.value = ''; describe(r.settings); return r; });
    }
    function busy(e, fn) {
      var b = e.target; b.disabled = true;
      return fn().catch(function (err) { log('Ошибка: ' + err.message); }).then(function () { b.disabled = false; });
    }

    api('deploy.php').then(function (st) { Object.assign(f, st, { password: '' }); draw(); describe(st); })
      .catch(function (e) { status.textContent = 'Не удалось загрузить настройки: ' + e.message; draw(); });
    draw();

    return card('Выгрузка на удалённый сервер (FTP)', h('div', null,
      h('p', null, 'Сервер соберёт статическую витрину (плеер, шрифты, фото и опубликованные данные) и выгрузит её по FTP. Экран на удалённом сервере будет крутиться автономно. Выгружаются ', h('b', { text: 'опубликованные' }), ' данные — сначала нажмите «Опубликовать на экраны».'),
      status, body,
      h('div', { class: 'd-flex flex-wrap gap-2 mt-3' },
        btn('Сохранить настройки', function (e) { busy(e, function () { return save().then(function () { toast('Настройки FTP сохранены'); }); }); }, 'btn-outline-primary'),
        btn('Проверить соединение', function (e) { logBox.textContent = ''; busy(e, function () { return save().then(function () { return call('test'); }).then(function (r) { log(r.log); }); }); }),
        btn('Выгрузить сборку на сервер', function (e) {
          if (server.dirty && !confirm('Есть неопубликованные изменения — на сервер уйдёт последняя опубликованная версия. Продолжить?')) return;
          logBox.textContent = ''; log('Собираю и выгружаю… это может занять минуту');
          busy(e, function () { return save().then(function () { return call('upload'); }).then(function (r) { log(r.log); describe(r.settings); toast('Сборка выгружена по FTP'); }); });
        }, 'btn-primary')),
      logBox));
  }

  function renderPublish() {
    var logBox = h('div', { class: 'log' });
    function log(m) { logBox.textContent += m + '\n'; logBox.scrollTop = 1e9; }

    var serverCard = server.on
      ? card('Экраны на сервере', h('div', null,
          h('p', null, 'Данные хранятся на сервере (' + (server.storage === 'files' ? 'в файлах' : 'в базе данных MySQL') + '), экраны читают их из ', h('code', { text: 'api/data.php' }),
            ' и проверяют обновления с интервалом, заданным у каждого дисплея.'),
          h('ul', { class: 'list-unstyled small mb-3' },
            h('li', null, 'Опубликованная ревизия: ', h('strong', { text: String(server.revision) })),
            h('li', null, 'Последняя публикация: ', h('strong', { text: server.updatedAt ? new Date(server.updatedAt.replace(' ', 'T')).toLocaleString('ru-RU') : '—' })),
            h('li', null, 'Состояние: ', server.dirty ? h('span', { class: 'badge text-bg-warning', text: 'есть неопубликованные изменения' }) : h('span', { class: 'badge text-bg-success', text: 'всё опубликовано' }))),
          h('div', { class: 'd-flex flex-wrap gap-2' },
            btn('Опубликовать на экраны', publishToServer, 'btn-primary', { disabled: !server.dirty }),
            btn('Отменить черновик', function () {
              if (!confirm('Отбросить неопубликованные изменения и загрузить данные с сервера?')) return;
              localStorage.removeItem(DRAFT_KEY);
              serverLoad().then(function () { render(); sendPreview(); renderNavRight(); toast('Загружено с сервера'); });
            }, 'btn-outline-danger', { disabled: !server.dirty }))))
      : card('Сервер (PHP + MySQL)', h('div', null,
          h('p', { class: 'mb-2' }, 'Бэкенд не найден — панель работает локально: данные хранятся только в этом браузере.'),
          h('p', { class: 'small text-body-secondary mb-0' }, 'Чтобы управлять экранами с любого компьютера, разверните сайт на PHP-хостинге с MySQL и откройте ',
            h('code', { text: 'api/install.php' }), ' (инструкция — в README).')));

    var ftpCard = server.on ? ftpPanel() : card('Выгрузка на удалённый сервер (FTP)', h('p', { class: 'text-body-secondary mb-0' },
      'Доступно при работе с PHP-бэкендом: FTP-выгрузку выполняет сервер. Без бэкенда скачайте ZIP и загрузите его FTP-клиентом.'));

    var git = {};
    try { git = JSON.parse(localStorage.getItem(GIT_KEY) || '{}'); } catch (e) { git = {}; }
    git.owner = git.owner || 'nortan'; git.repo = git.repo || 'torsher_display'; git.branch = git.branch || 'main';
    var gitLog = h('div', { class: 'log' });
    var tokenInput = input(git, 'token', { type: 'password' }); tokenInput.autocomplete = 'off';

    var importInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'd-none' });
    importInput.addEventListener('change', function () {
      var f = importInput.files[0]; if (!f) return;
      f.text().then(function (t) { data = normalize(JSON.parse(t)); ui.slideId = null; changed(true); sendPreview(); toast('Данные импортированы'); })
        .catch(function (e) { toast('Ошибка импорта: ' + e.message); });
    });

    return h('div', null,
      pageHead('Публикация', 'Экраны работают автономно: либо читают данные с PHP-сервера, либо крутят статическую сборку.'),
      serverCard,
      server.on ? storagePanel() : null,
      ftpCard,
      card('Статическая сборка (ZIP)', h('div', null,
        h('p', { html: 'Архив содержит плеер, шрифты, библиотеки, фото и данные — всё, что нужно экрану. Распакуйте на любой веб-сервер или откройте <code>index.html</code> прямо с флешки. Инструкция — в <code>SERVER.md</code> внутри архива.' }),
        btn('Скачать сборку .zip', function (e) {
          var b = e.target; b.disabled = true; logBox.textContent = '';
          buildZip(log).then(function (blob) {
            download(blob, 'torsher-display-' + M.dateKey(new Date()) + '.zip');
            log('Готово: ' + Math.round(blob.size / 1024) + ' КБ');
          }).catch(function (err) { log('Ошибка: ' + err.message); }).then(function () { b.disabled = false; });
        }, 'btn-primary'), logBox)),
      card('Публикация в Git (GitHub)', h('div', null,
        h('p', { html: 'Коммитит <code>content/data.json</code> и фото, загруженные в этом браузере. GitHub Actions соберёт сайт и выложит его на Pages или ваш сервер. Нужен <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">токен</a> с правом <b>Contents: Read and write</b>.' }),
        row(field('Владелец', input(git, 'owner')), field('Репозиторий', input(git, 'repo')), field('Ветка', input(git, 'branch')),
          field('Токен', tokenInput), field('Сообщение коммита', input(git, 'message', { placeholder: 'Обновление витрины из админки' }))),
        h('div', { class: 'd-flex flex-wrap align-items-center gap-3 mt-3' },
          checkbox(git, 'remember', 'Запомнить в этом браузере'),
          btn('Опубликовать в Git', function (e) {
            if (!git.token) { toast('Укажите токен'); return; }
            localStorage.setItem(GIT_KEY, JSON.stringify(git.remember ? git : { owner: git.owner, repo: git.repo, branch: git.branch }));
            var b = e.target; b.disabled = true; gitLog.textContent = '';
            gitPublish(git, function (m) { gitLog.textContent += m + '\n'; }).then(function (c) {
              gitLog.textContent += 'Готово: коммит ' + c.sha.slice(0, 7) + '\n';
              toast('Опубликовано в Git');
            }).catch(function (err) { gitLog.textContent += 'Ошибка: ' + err.message + '\n'; }).then(function () { b.disabled = false; });
          }, 'btn-outline-primary')), gitLog)),
      card('Данные', h('div', null,
        h('div', { class: 'd-flex flex-wrap gap-2' },
          btn('Экспорт data.json', function () { download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'data.json'); }),
          btn('Импорт data.json', function () { importInput.click(); }), importInput,
          server.on ? btn('Обновить контент из репозитория', function () {
            if (!confirm('Заменить все данные на сервере (блюда, мероприятия, слайды, дисплеи) версией из content/data.json?\n\nТекущие данные на экранах будут перезаписаны.')) return;
            var b = document.activeElement; if (b) b.disabled = true;
            api('update.php', { method: 'POST', json: {} }).then(function (r) {
              toast('Контент обновлён: ревизия ' + r.revision + ' — экраны подтянут его сами');
              server.dirty = false; localStorage.removeItem(DRAFT_KEY);
              serverLoad().then(function () { renderNavRight(); render(); sendPreview(); });
            }).catch(function (e) { toast('Ошибка: ' + e.message); }).then(function () { if (b) b.disabled = false; });
          }, 'btn-outline-primary')
          : btn('Сбросить к версии из репозитория', function () {
            if (!confirm('Заменить локальные изменения данными из content/data.json?')) return;
            loadFromRepo().then(function (d) { data = normalize(d); ui.slideId = null; changed(true); sendPreview(); toast('Загружено из репозитория'); })
              .catch(function (e) { toast('Ошибка: ' + e.message); });
          }, 'btn-outline-danger')),
        h('div', { class: 'form-text mt-2', text: server.on ? '«Обновить контент из репозитория» записывает content/data.json на сервер сразу — минуя черновик. Импорт файла заполняет черновик; на экраны данные попадут после «Опубликовать на экраны».' : 'Экспортированный data.json можно положить в content/ репозитория.' }))));
  }

  /* ---------- Старт ---------- */

  function showApp() {
    document.getElementById('login').hidden = true;
    document.getElementById('app').hidden = false;
    var ids = (data.displays || []).map(function (d) { return d.id; });
    if (ids.indexOf(ui.displayId) === -1) ui.displayId = ids[0] || '';
    renderNavRight();
    fillPreviewDisplays();
    render();
    scalePreview();
    sendPreview();
  }

  function enterServerMode() {
    server.on = true;
    return serverLoad().then(showApp);
  }

  function enterLocalMode() {
    server.on = false;
    return openDB().then(dbAll).then(function (m) {
      media = m;
      var saved = null;
      try { saved = localStorage.getItem(LOCAL_KEY); } catch (e) { /* нет */ }
      if (saved) return JSON.parse(saved);
      return loadFromRepo().catch(function () { return {}; });
    }).then(function (d) { data = normalize(d); showApp(); });
  }

  window.addEventListener('beforeunload', function (e) {
    if (server.on && server.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  api('auth.php').then(function (r) {
    server.csrf = r.csrf; server.user = r.user; server.storage = r.storage;
    return enterServerMode();
  }).catch(function (e) {
    if (e.status === 401) { server.csrf = e.body && e.body.csrf; showLogin(); return; }
    // нет бэкенда или базы данных — локальный режим, но тоже со входом
    server.localAuth = true;
    if (localSession()) { server.user = { login: localAuth().login }; return enterLocalMode(); }
    showLogin(e.status === 503 ? 'Сервер: ' + e.message : '');
  });
})();
