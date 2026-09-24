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
  var ui = { tab: 'slides', slideId: null, dishFilter: '', dishPhoto: 'all', showPast: false };

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
    Object.keys(options).forEach(function (k) { el.appendChild(h('option', { value: k, text: options[k] })); });
    el.value = obj[key] == null ? '' : String(obj[key]);
    el.addEventListener('change', function () {
      var v = el.value;
      obj[key] = v === '' ? '' : (opts.number ? Number(v) : v);
      changed(opts.rerender);
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
    d.settings.animation = Object.assign(M.defaultAnimation(), d.settings.animation || {});
    d.settings.transition = Object.assign({ effect: 'fade', speed: 1100 }, d.settings.transition || {});
    d.settings.fonts = Object.assign(M.defaultFonts(), d.settings.fonts || {});
    d.settings.header = Object.assign(M.defaultHeader(), d.settings.header && !Array.isArray(d.settings.header) ? d.settings.header : {});
    delete d.settings.headingFont;
    d.ticker = d.ticker || [];
    d.dishes = d.dishes || [];
    d.events = d.events || [];
    d.slides = d.slides || [];
    // поля-объекты: пустой {} мог прийти как [] (PHP) — приводим к объекту
    var obj = function (v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
    d.cafe = obj(d.cafe);
    d.slides.forEach(function (s) {
      s.elements = obj(s.elements);
      if (s.sizes != null) s.sizes = Object.assign({ title: null, dish: null, text: null }, obj(s.sizes));
      if (s.show != null) s.show = obj(s.show);
      if (s.nearest != null) s.nearest = obj(s.nearest);
      if (s.schedule != null) { s.schedule = obj(s.schedule); s.schedule.days = s.schedule.days || []; }
      if (!Array.isArray(s.photoPos)) s.photoPos = [];
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
      toast('Опубликовано: экраны обновятся в течение ' + data.settings.refreshInterval + ' с');
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
      box.appendChild(h('span', { class: 'badge text-bg-success', text: 'Сервер' }));
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
    saveDraft();
  }

  function showLogin(msg) {
    document.getElementById('app').hidden = true;
    document.getElementById('login').hidden = false;
    var err = document.getElementById('loginError');
    err.hidden = !msg; err.textContent = msg || '';
    document.getElementById('loginName').focus();
  }

  document.getElementById('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    api('auth.php', { method: 'POST', json: { action: 'login', login: document.getElementById('loginName').value, password: document.getElementById('loginPass').value } })
      .then(function (r) { server.csrf = r.csrf; server.user = r.user; return enterServerMode(); })
      .catch(function (e2) { showLogin(e2.message); });
  });

  function logout() {
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
    d.dishes.forEach(fix); d.events.forEach(fix);
    if (d.cafe.logo && media[d.cafe.logo]) d.cafe.logo = media[d.cafe.logo];
    return d;
  }

  function sendPreview() {
    if (!previewReady || !data) return;
    var mode = document.getElementById('previewMode').value;
    var slideId = mode === 'slide' ? (ui.slideId || (data.slides[0] && data.slides[0].id)) : null;
    frame.contentWindow.postMessage({ type: 'torsher:data', data: resolvedData(), slideId: slideId, ignoreSchedule: mode === 'show' }, '*');
  }
  function replay() { frame.contentWindow.postMessage({ type: 'torsher:replay' }, '*'); }

  function scalePreview() {
    var box = document.getElementById('previewScreen');
    var k = Math.min(box.clientWidth / 1080, box.clientHeight / 1920);
    frame.style.transform = 'translate(' + ((box.clientWidth - 1080 * k) / 2) + 'px,' + ((box.clientHeight - 1920 * k) / 2) + 'px) scale(' + k + ')';
  }

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'torsher:ready') { previewReady = true; sendPreview(); }
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
        var k = Math.min(1, 1200 / Math.max(img.width, img.height));
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

  function photoPicker(obj) {
    var fileInput = h('input', { type: 'file', accept: 'image/png,image/webp,image/*' });
    var box = h('label', { class: 'thumb', title: 'Загрузить обтравленное фото (PNG/WebP с прозрачным фоном)' }, fileInput);
    if (obj.photo) {
      box.appendChild(h('img', { src: photoSrc(obj.photo), alt: '' }));
      box.appendChild(h('button', { class: 'thumb__x', type: 'button', title: 'Убрать фото', text: '×', onclick: function (e) {
        e.preventDefault(); obj.photo = null; changed(true);
      } }));
    } else {
      box.appendChild(h('span', { text: '+ фото' }));
    }
    fileInput.addEventListener('change', function () {
      var f = fileInput.files[0];
      if (!f) return;
      readImage(f).then(function (res) {
        if (!res.alpha && confirm('У фото нет прозрачного фона. Для витрины нужны обтравленные фото (PNG/WebP с альфа-каналом).\n\n' +
            'ОК — попробовать убрать однотонный фон автоматически\nОтмена — загрузить как есть')) {
          return readImage(f, { removeBg: true });
        }
        return res;
      }).then(function (res) {
        return storeImage(res).then(function (path) {
          obj.photo = path;
          changed(true);
          toast(res.alpha ? 'Фото загружено' : 'Фото загружено без прозрачного фона');
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
    var pages = { slides: renderSlides, dishes: renderDishes, events: renderEvents, design: renderDesign, publish: renderPublish };
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

  function addSlide(s) { data.slides.push(s); ui.slideId = s.id; changed(true); sendPreview(); }

  function renderSlides() {
    var sel = data.slides.filter(function (s) { return s.id === ui.slideId; })[0];
    if (!sel && data.slides.length) { sel = data.slides[0]; ui.slideId = sel.id; }

    var head = pageHead('Экраны', 'Каждый слайд — один экран витрины. Порядок в списке = порядок показа.', [
      btn('+ Блюда', function () { addSlide(M.newSlide('dishes')); }),
      btn('+ Афиша на неделю', function () { addSlide(M.newSlide('events')); }),
      btn('+ Афиша на 2 недели', function () {
        var s = M.newSlide('events'); s.name = 'Афиша на две недели'; s.title = 'Афиша'; s.subtitle = 'Ближайшие две недели'; s.range = '2weeks'; s.style = 'timeline'; addSlide(s);
      }),
      btn('+ Инфо', function () { addSlide(M.newSlide('info')); }),
      btn('Сгенерировать комбинации', generate, 'btn-primary')
    ]);

    var list = h('div', { class: 'list-group slides' });
    data.slides.forEach(function (s, i) {
      var sched = scheduleSummary(s);
      var cb = h('input', { class: 'form-check-input m-0', type: 'checkbox', title: 'Показывать', checked: s.enabled !== false, onclick: function (e) { e.stopPropagation(); } });
      cb.addEventListener('change', function () { s.enabled = cb.checked; changed(true); });
      list.appendChild(h('div', { class: 'list-group-item list-group-item-action slide-item d-flex align-items-center gap-3' + (s.id === ui.slideId ? ' active' : '') + (s.enabled === false ? ' is-off' : ''),
        onclick: function () { ui.slideId = s.id; render(); sendPreview(); } },
        h('span', { class: 'slide-num rounded-circle bg-body-secondary d-grid align-items-center justify-content-center small fw-bold', text: String(i + 1) }),
        cb,
        h('div', { class: 'flex-grow-1 min-w-0' },
          h('div', { class: 'fw-semibold' }, s.name || s.title || 'Без названия', ' ',
            h('span', { class: 'badge rounded-pill text-bg-light border', text: s.type === 'dishes' ? 'блюда' : s.type === 'events' ? 'афиша' : 'инфо' }), ' ',
            s.nearest && s.nearest.enabled ? h('span', { class: 'badge rounded-pill text-bg-warning', text: 'ближайшее' }) : null, ' ',
            s.showTitle === false ? h('span', { class: 'badge rounded-pill text-bg-light border', text: 'без заголовка' }) : null, ' ',
            sched ? h('span', { class: 'badge rounded-pill text-bg-info', text: '⏰ ' + sched }) : null),
          h('div', { class: 'small text-body-secondary text-truncate', text: slideSummary(s) + ' · ' + (s.duration || data.settings.slideDuration) + ' с · ' +
            M.ANIMATION_PRESETS[(s.animation && s.animation.preset) || data.settings.animation.preset] })),
        h('div', { class: 'btn-group btn-group-sm', onclick: function (e) { e.stopPropagation(); } },
          btn('↑', function () { move(i, -1); }, 'btn-outline-secondary', { title: 'Выше', disabled: i === 0 }),
          btn('↓', function () { move(i, 1); }, 'btn-outline-secondary', { title: 'Ниже', disabled: i === data.slides.length - 1 }),
          btn('⧉', function () {
            var c = M.clone(s); c.id = M.uid('slide'); c.name = (s.name || '') + ' (копия)'; data.slides.splice(i + 1, 0, c); ui.slideId = c.id; changed(true);
          }, 'btn-outline-secondary', { title: 'Дублировать' }),
          btn('✕', function () {
            if (!confirm('Удалить слайд «' + (s.name || s.title) + '»?')) return;
            data.slides.splice(i, 1); ui.slideId = null; changed(true);
          }, 'btn-outline-danger', { title: 'Удалить' }))));
    });
    if (!data.slides.length) list.appendChild(h('div', { class: 'list-group-item text-body-secondary', text: 'Слайдов пока нет — добавьте вручную или сгенерируйте комбинации.' }));
    setTimeout(function () { var el = list.querySelector('.active'); if (el) list.scrollTop = el.offsetTop - list.clientHeight / 2; }, 0);

    return h('div', null, head, h('div', { class: 'card shadow-sm mb-3' }, list), sel ? slideEditor(sel) : null);
  }

  function move(i, d) { var s = data.slides.splice(i, 1)[0]; data.slides.splice(i + d, 0, s); changed(true); }

  function generate() {
    if (!data.dishes.length) { toast('Сначала добавьте блюда'); return; }
    var photoCount = data.dishes.filter(function (d) { return d.photo && d.active !== false; }).length;
    var replace = data.slides.length ? confirm('Заменить текущие слайды сгенерированным набором?\n\nОК — заменить, Отмена — добавить в конец.') : true;
    var gen = M.generateSlides(data);
    data.slides = replace ? gen : data.slides.concat(gen);
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
        owner.animation = holder.v ? null : M.clone(data.settings.animation);
        changed(true);
      });
      box.appendChild(sw);
      if (!owner.animation) return box;
      a = owner.animation;
      box.appendChild(h('div', { class: 'mb-3' }));
    }
    box.appendChild(row(
      field('Появление элементов', select(a, 'preset', M.ANIMATION_PRESETS)),
      field('Заголовок', select(a, 'title', M.TITLE_EFFECTS)),
      field('Фото', select(a, 'photo', M.PHOTO_EFFECTS)),
      field('Цены', select(a, 'price', M.PRICE_EFFECTS)),
      field('Порядок', select(a, 'order', M.ORDERS)),
      field('Скорость', range(a, 'speed', 0.5, 2, 0.1, function (v) { return '×' + Number(v).toFixed(1); })),
      field('Интервал между элементами', range(a, 'stagger', 0.02, 0.3, 0.01, function (v) { return Number(v).toFixed(2) + ' с'; }))
    ));
    return box;
  }

  function sec(title, open, body) {
    return h('details', { class: 'sec', open: open || null }, h('summary', { text: title }), body);
  }

  /* Размер текста на слайде: свой или как в общих настройках «Шрифты». */
  function sizesEditor(s) {
    s.sizes = s.sizes || { title: null, dish: null, text: null };
    var fonts = Object.assign(M.defaultFonts(), data.settings.fonts || {});
    var defs = { title: fonts.headingScale, dish: fonts.dishScale, text: fonts.textScale };
    var names = { title: 'Заголовок', dish: 'Названия блюд и цены', text: 'Описания' };
    var r = row();
    Object.keys(names).forEach(function (k) {
      var own = s.sizes[k] != null;
      var holder = { v: own ? s.sizes[k] : defs[k] };
      var fmt = function (v) { return Math.round(v * 100) + '%' + (s.sizes[k] == null ? ' общий' : ''); };
      var rg = range(holder, 'v', 0.6, 1.6, 0.05, fmt);
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
        h('td', null, btn('↺', function () { s.elements[item.key] = M.defaultElement(); changed(true); }, 'btn-outline-secondary btn-sm', { title: 'Сбросить' })));
    });
    return sec('Элементы слайда: эффекты и смещения', true, h('div', null,
      h('div', { class: 'table-responsive' }, h('table', { class: 'table table-sm align-middle mb-1' },
        h('thead', { class: 'table-light' }, h('tr', null, ['Элемент', 'Показ', 'Эффект GSAP', 'Длит., с', 'Задержка, с', 'X, px', 'Y, px', ''].map(function (t) { return h('th', { class: 'small', text: t }); }))),
        h('tbody', null, rows))),
      h('div', { class: 'form-text', text: 'Эффект «как на слайде» — элемент появляется в общей последовательности (раздел «Появление информации»). Свой эффект запускается отдельно: длительность и задержка от начала показа слайда. X/Y — сдвиг от штатного места в пикселях экрана 1080×1920 (минус — влево/вверх).' })));
  }

  function slideEditor(s) {
    var body = h('div');
    var accent = h('input', { type: 'color', class: 'form-control form-control-color', value: s.accent || data.settings.accent });
    accent.addEventListener('input', function () { s.accent = accent.value; changed(); });

    body.appendChild(row(
      field('Название в списке', input(s, 'name')),
      field('Заголовок на экране', input(s, 'title')),
      field('Подзаголовок (надстрочник)', input(s, 'subtitle')),
      field('Заголовок', h('div', { class: 'd-flex align-items-center gap-3' }, checkbox(s, 'showTitle', 'Показывать', { defaultOn: true, rerender: true }),
        select(s, 'titleAlign', M.TITLE_ALIGNS, { sm: true }))),
      field('Фон слайда', (function () {
        var holder = { v: s.bgGradient == null ? '' : (s.bgGradient ? 'on' : 'off') };
        var el = select(holder, 'v', { on: 'Анимированный градиент', off: 'Без градиента' }, { empty: 'Как в общих настройках (' + (data.settings.bgGradient !== false ? 'градиент' : 'без градиента') + ')' });
        el.addEventListener('change', function () { s.bgGradient = holder.v === '' ? null : holder.v === 'on'; changed(); });
        return el;
      })()),
      field('Длительность, с', input(s, 'duration', { type: 'number', min: 3, max: 120, nullable: true, placeholder: 'по умолчанию ' + data.settings.slideDuration })),
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
        changed();
      });
      days.appendChild(cb);
      days.appendChild(h('label', { class: 'btn btn-outline-primary btn-sm', for: id, text: d }));
    });
    body.appendChild(sec('Когда показывать слайд', false, h('div', null,
      field('Дни недели (не выбрано — каждый день)', days),
      h('div', { class: 'row g-3 row-cols-2 row-cols-md-4 mt-1' },
        field('С (время)', input(s.schedule, 'from', { type: 'time' })), field('До (время)', input(s.schedule, 'to', { type: 'time' })),
        field('С даты', input(s.schedule, 'dateFrom', { type: 'date' })), field('По дату', input(s.schedule, 'dateTo', { type: 'date' }))),
      h('div', { class: 'form-text', text: 'Например, завтраки — будни с 8:00 до 12:00. Интервал через полночь тоже работает (22:00–02:00).' }))));

    body.appendChild(sec('Появление информации', true, animationEditor(s.animation, true, s)));
    return card('Настройки слайда', body, btn('↻ Повторить анимацию', replay, 'btn-outline-secondary btn-sm'));
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
      h('thead', { class: 'table-light' }, h('tr', null, ['Фото', 'Название / описание', 'Категория', 'Вес / объём', 'Цена', 'Старая цена', 'Метка', 'В витрине', ''].map(function (t) { return h('th', { class: 'small', text: t }); }))),
      h('tbody', null, rows.map(function (d) {
        return h('tr', { class: d.active === false ? 'is-off' : '' },
          h('td', null, photoPicker(d)),
          h('td', { style: 'min-width:220px' }, input(d, 'name', { sm: true }), h('div', { class: 'mt-1' }, textarea(d, 'description', { rows: 1, sm: true, placeholder: 'Описание (необязательно)' }))),
          h('td', { class: 'col-sm' }, input(d, 'category', { sm: true })),
          h('td', { class: 'col-sm' }, input(d, 'weight', { sm: true, placeholder: '250 г' })),
          h('td', { class: 'col-num' }, input(d, 'price', { type: 'number', min: 0, sm: true })),
          h('td', { class: 'col-num' }, input(d, 'oldPrice', { type: 'number', min: 0, nullable: true, sm: true })),
          h('td', { class: 'col-sm' }, input(d, 'tag', { sm: true, placeholder: 'хит' })),
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
        field('Размер заголовков', range(f, 'headingScale', 0.7, 1.4, 0.05, pct)),
        field('Размер названий и цен', range(f, 'dishScale', 0.7, 1.4, 0.05, pct)),
        field('Размер описаний', range(f, 'textScale', 0.7, 1.4, 0.05, pct))),
      h('div', { class: 'form-text mt-2', text: 'Это общие значения; у каждого слайда можно задать свой размер. Все шрифты лежат в сборке и работают без интернета. Calibri берётся из системы, иначе — метрически совместимый Carlito.' })));
  }

  function renderDesign() {
    var st = data.settings;
    var tickerHolder = { v: (data.ticker || []).join('\n') };
    var ticker = textarea(tickerHolder, 'v', { rows: 4 });
    ticker.addEventListener('input', function () { data.ticker = tickerHolder.v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); });
    var accent = h('input', { type: 'color', class: 'form-control form-control-color', value: st.accent });
    accent.addEventListener('input', function () { st.accent = accent.value; changed(); });

    return h('div', null,
      pageHead('Анимация и оформление', 'Общие настройки для всех экранов. Слайд может переопределить появление информации и размеры текста.'),
      card('Переключение между слайдами', h('div', null, row(
        field('Эффект перехода', select(st.transition, 'effect', Object.keys(M.TRANSITIONS).reduce(function (o, k) { o[k] = M.TRANSITIONS[k].label; return o; }, {}))),
        field('Длительность перехода', range(st.transition, 'speed', 300, 3000, 100, function (v) { return v + ' мс'; })),
        field('Показ слайда по умолчанию, с', input(st, 'slideDuration', { type: 'number', min: 3, max: 120 }))),
        h('div', { class: 'mt-3' }, checkbox(st, 'progressEnabled', 'Показывать полосу оставшегося времени слайда', { defaultOn: true })),
        h('div', { class: 'form-text mt-2', text: 'Чтобы увидеть переходы, выберите «Вся программа» в предпросмотре.' }))),
      card('Появление информации на слайде (по умолчанию)', animationEditor(st.animation, false)),
      fontsCard(st),
      card('Оформление', row(
        field('Тема', select(st, 'theme', M.THEMES)),
        field('Фон слайдов', checkbox(st, 'bgGradient', 'Лёгкий анимированный градиент', { defaultOn: true }), 'Общее значение; у слайда можно переопределить'),
        field('Акцентный цвет', accent),
        field('Валюта после цены', input(st, 'currency', { placeholder: 'пусто — как в печатном меню' })),
        field('Название заведения', input(data.cafe, 'name')),
        field('Подпись под названием', input(data.cafe, 'tagline')))),
      card('Шапка экрана', h('div', null,
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
        field('Ежедневная перезагрузка', input(st, 'dailyReloadAt', { type: 'time' }), 'Освобождает память ТВ-браузера'))));
  }

  /* ===== Публикация ===== */

  function referencedPhotos() {
    var set = {};
    data.dishes.concat(data.events).forEach(function (o) { if (o.photo) set[o.photo] = true; });
    if (data.cafe.logo) set[data.cafe.logo] = true;
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
          h('p', null, 'Данные хранятся в MySQL на сервере, экраны читают их из ', h('code', { text: 'api/data.php' }),
            ' и обновляются сами каждые ' + data.settings.refreshInterval + ' с.'),
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
          server.on ? null : btn('Сбросить к версии из репозитория', function () {
            if (!confirm('Заменить локальные изменения данными из content/data.json?')) return;
            loadFromRepo().then(function (d) { data = normalize(d); ui.slideId = null; changed(true); sendPreview(); toast('Загружено из репозитория'); })
              .catch(function (e) { toast('Ошибка: ' + e.message); });
          }, 'btn-outline-danger')),
        h('div', { class: 'form-text mt-2', text: server.on ? 'Импорт заменит черновик; на экраны данные попадут после «Опубликовать на экраны».' : 'Экспортированный data.json можно положить в content/ репозитория.' }))));
  }

  /* ---------- Старт ---------- */

  function showApp() {
    document.getElementById('login').hidden = true;
    document.getElementById('app').hidden = false;
    renderNavRight();
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
    server.csrf = r.csrf; server.user = r.user;
    return enterServerMode();
  }).catch(function (e) {
    if (e.status === 401) { server.csrf = e.body && e.body.csrf; showLogin(); return; }
    if (e.status === 503) { toast('Сервер: ' + e.message); }
    return enterLocalMode();
  });
})();
