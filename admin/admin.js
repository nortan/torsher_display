/*
 * Админка витрины. Работает полностью в браузере:
 *  - данные хранятся в localStorage, загруженные фото — в IndexedDB;
 *  - предпросмотр — плеер ../index.html?preview=1 в iframe (postMessage);
 *  - публикация: ZIP со статической сборкой, JSON, коммит в GitHub через API.
 */
(function () {
  'use strict';

  var M = window.TorsherModel;
  var STORE_KEY = 'torsher-admin-data-v2';
  var GIT_KEY = 'torsher-admin-git';
  var DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

  var data = null;           // текущие данные витрины
  var media = {};            // path -> dataURL (загруженные фото)
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
  function field(label, control, hint) {
    return h('label', { class: 'field' }, h('span', { text: label }), control, hint ? h('small', { text: hint }) : null);
  }

  /* Поля ввода, связанные со свойством объекта. */
  function input(obj, key, opts) {
    opts = opts || {};
    var type = opts.type || 'text';
    var el = h('input', { type: type, placeholder: opts.placeholder, min: opts.min, max: opts.max, step: opts.step });
    var v = obj[key];
    el.value = v == null ? '' : v;
    el.addEventListener('input', function () {
      var val = el.value;
      if (type === 'number' || opts.number) val = val === '' ? (opts.nullable ? null : 0) : Number(val);
      obj[key] = val;
      changed(opts.rerender);
    });
    return el;
  }
  function textarea(obj, key, opts) {
    var el = h('textarea', { rows: (opts && opts.rows) || 2, placeholder: opts && opts.placeholder });
    el.value = obj[key] || '';
    el.addEventListener('input', function () { obj[key] = el.value; changed(); });
    return el;
  }
  function select(obj, key, options, opts) {
    opts = opts || {};
    var el = h('select');
    if (opts.empty != null) el.appendChild(h('option', { value: '', text: opts.empty }));
    Object.keys(options).forEach(function (k) { el.appendChild(h('option', { value: k, text: options[k] })); });
    el.value = obj[key] == null ? '' : String(obj[key]);
    el.addEventListener('change', function () {
      var v = el.value;
      obj[key] = v === '' ? (opts.emptyValue !== undefined ? opts.emptyValue : '') : (opts.number ? Number(v) : v);
      changed(opts.rerender);
    });
    return el;
  }
  function checkbox(obj, key, label, opts) {
    var el = h('input', { type: 'checkbox', checked: obj[key] !== false && !!(obj[key] || (opts && opts.defaultOn && obj[key] == null)) });
    el.addEventListener('change', function () { obj[key] = el.checked; changed(opts && opts.rerender); });
    return h('label', { class: 'check' }, el, label);
  }
  function range(obj, key, min, max, step, fmt) {
    var out = h('b', { text: fmt(obj[key]) });
    var el = h('input', { type: 'range', min: min, max: max, step: step });
    el.value = obj[key];
    el.addEventListener('input', function () { obj[key] = Number(el.value); out.textContent = fmt(obj[key]); changed(); });
    return h('div', { class: 'toolbar' }, el, out);
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  /* ---------- Хранилище ---------- */

  var db = null;
  function openDB() {
    return new Promise(function (resolve) {
      try {
        var req = indexedDB.open('torsher-admin', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('media'); };
        req.onsuccess = function () { db = req.result; resolve(); };
        req.onerror = function () { resolve(); };
      } catch (e) { resolve(); }
    });
  }
  function dbAll() {
    return new Promise(function (resolve) {
      if (!db) return resolve({});
      var out = {}, tx = db.transaction('media', 'readonly'), st = tx.objectStore('media');
      var cur = st.openCursor();
      cur.onsuccess = function () { var c = cur.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
      cur.onerror = function () { resolve(out); };
    });
  }
  function dbPut(path, dataURL) {
    media[path] = dataURL;
    if (!db) return;
    db.transaction('media', 'readwrite').objectStore('media').put(dataURL, path);
  }

  var saveTimer, previewTimer;
  function changed(rerender) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 250);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(sendPreview, 350);
    if (rerender) render();
  }
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
      document.getElementById('saveStatus').textContent = 'Сохранено в браузере · ' + new Date().toLocaleTimeString('ru-RU');
    } catch (e) {
      document.getElementById('saveStatus').textContent = 'Не удалось сохранить: ' + e.message;
    }
  }

  function normalize(d) {
    d.version = 2;
    d.cafe = d.cafe || { name: 'Кафе', tagline: '' };
    var def = M.defaultSettings();
    d.settings = Object.assign(def, d.settings || {});
    d.settings.animation = Object.assign(M.defaultAnimation(), d.settings.animation || {});
    d.settings.transition = Object.assign({ effect: 'fade', speed: 1100 }, d.settings.transition || {});
    d.ticker = d.ticker || [];
    d.dishes = d.dishes || [];
    d.events = d.events || [];
    d.slides = d.slides || [];
    return d;
  }

  function loadFromRepo() {
    return fetch('../content/data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
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
    if (!previewReady) return;
    var mode = document.getElementById('previewMode').value;
    var slideId = mode === 'slide' ? (ui.slideId || (data.slides[0] && data.slides[0].id)) : null;
    frame.contentWindow.postMessage({ type: 'torsher:data', data: resolvedData(), slideId: slideId, ignoreSchedule: mode === 'show' }, '*');
  }

  function scalePreview() {
    var box = document.getElementById('previewScreen');
    var k = Math.min(box.clientWidth / 1080, box.clientHeight / 1920);
    frame.style.transform = 'translate(' + ((box.clientWidth - 1080 * k) / 2) + 'px,0) scale(' + k + ')';
  }

  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'torsher:ready') { previewReady = true; sendPreview(); }
  });
  document.getElementById('previewMode').addEventListener('change', sendPreview);
  document.getElementById('replay').addEventListener('click', function () {
    frame.contentWindow.postMessage({ type: 'torsher:replay' }, '*');
  });
  window.addEventListener('resize', scalePreview);

  /* ---------- Фото ---------- */

  /* Есть ли в изображении прозрачность (проверяем края — у обтравленного фото они прозрачные). */
  function hasAlpha(ctx, w, hgt) {
    var d = ctx.getImageData(0, 0, w, hgt).data, transparent = 0, total = 0;
    for (var y = 0; y < hgt; y += Math.max(1, Math.floor(hgt / 60))) {
      for (var x = 0; x < w; x += Math.max(1, Math.floor(w / 60))) {
        var edge = x < w * 0.05 || x > w * 0.95 || y < hgt * 0.05 || y > hgt * 0.95;
        if (!edge) continue;
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
    for (var x = 0; x < w; x++) { stack.push(x, 0, x, hgt - 1); }
    for (var y = 0; y < hgt; y++) { stack.push(0, y, w - 1, y); }
    while (stack.length) {
      var yy = stack.pop(), xx = stack.pop();
      if (xx < 0 || yy < 0 || xx >= w || yy >= hgt) continue;
      var k = yy * w + xx;
      if (seen[k]) continue;
      seen[k] = 1;
      var i = k * 4;
      var dist = Math.abs(d[i] - ref[0]) + Math.abs(d[i + 1] - ref[1]) + Math.abs(d[i + 2] - ref[2]);
      if (dist > tol * 3) continue;
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
        var ctx = c.getContext('2d');
        resolve({ url: c.toDataURL('image/webp', 0.88), alpha: hasAlpha(ctx, c.width, c.height), canvas: c });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
      img.src = url;
    });
  }

  function photoSrc(path) {
    if (!path) return '';
    return media[path] || ('../' + path);
  }

  function photoPicker(obj, rerender) {
    var fileInput = h('input', { type: 'file', accept: 'image/png,image/webp,image/*' });
    var box = h('label', { class: 'thumb', title: 'Загрузить фото' }, fileInput);
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
        if (!res.alpha) {
          var ok = confirm('Фото без прозрачного фона. Для витрины нужны обтравленные фото (PNG/WebP с альфа-каналом).\n\n' +
            'ОК — попробовать убрать однотонный фон автоматически\nОтмена — загрузить как есть');
          if (ok) return readImage(f, { removeBg: true });
        }
        return res;
      }).then(function (res) {
        var path = 'media/' + M.uid('img') + '.webp';
        dbPut(path, res.url);
        obj.photo = path;
        changed(rerender !== false);
        toast(res.alpha ? 'Фото загружено' : 'Фото загружено (фон не прозрачный)');
      }).catch(function (e) { toast(e.message); });
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
    Array.prototype.forEach.call(document.querySelectorAll('#nav button'), function (b) {
      b.classList.toggle('is-active', b.getAttribute('data-tab') === ui.tab);
    });
  }

  document.getElementById('nav').addEventListener('click', function (e) {
    var t = e.target.getAttribute('data-tab');
    if (t) { ui.tab = t; window.scrollTo(0, 0); render(); }
  });

  /* ===== Экраны (слайды) ===== */

  function slideSummary(s) {
    if (s.type === 'dishes') {
      var L = M.LAYOUTS[s.layout] || {};
      return L.label || s.layout;
    }
    if (s.type === 'events') return (s.range === '2weeks' ? 'Афиша на 2 недели' : 'Афиша на неделю') + ' · до ' + (s.max || 7) + ' шт · ' + (M.EVENT_STYLES[s.style] || '');
    return 'Информация · ' + ((s.lines || []).length) + ' строк';
  }

  function scheduleSummary(s) {
    var sc = s.schedule || {}, parts = [];
    if (sc.days && sc.days.length && sc.days.length < 7) parts.push(sc.days.map(function (d) { return DAYS[d - 1]; }).join(','));
    if (sc.from || sc.to) parts.push((sc.from || '…') + '–' + (sc.to || '…'));
    if (sc.dateFrom || sc.dateTo) parts.push((sc.dateFrom || '…') + ' → ' + (sc.dateTo || '…'));
    return parts.join(' · ');
  }

  function addSlide(s) {
    data.slides.push(s);
    ui.slideId = s.id;
    changed(true);
  }

  function renderSlides() {
    var sel = data.slides.filter(function (s) { return s.id === ui.slideId; })[0];
    if (!sel && data.slides.length) { sel = data.slides[0]; ui.slideId = sel.id; }

    var head = h('div', { class: 'page-head' },
      h('div', null, h('h1', { text: 'Экраны' }), h('p', { text: 'Каждый слайд — один экран витрины. Порядок в списке = порядок показа.' })),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn', text: '+ Блюда', onclick: function () { addSlide(M.newSlide('dishes')); } }),
        h('button', { class: 'btn', text: '+ Афиша на неделю', onclick: function () { addSlide(M.newSlide('events')); } }),
        h('button', { class: 'btn', text: '+ Афиша на 2 недели', onclick: function () {
          var s = M.newSlide('events'); s.name = 'Афиша на две недели'; s.title = 'Афиша'; s.subtitle = 'Ближайшие две недели'; s.range = '2weeks'; s.style = 'timeline'; addSlide(s);
        } }),
        h('button', { class: 'btn', text: '+ Инфо', onclick: function () { addSlide(M.newSlide('info')); } }),
        h('button', { class: 'btn btn--primary', text: 'Сгенерировать комбинации', onclick: generate })
      ));

    var list = h('div', { class: 'slides' });
    data.slides.forEach(function (s, i) {
      var sched = scheduleSummary(s);
      var item = h('div', { class: 'slide-item' + (s.id === ui.slideId ? ' is-selected' : '') + (s.enabled === false ? ' is-off' : ''), onclick: function () {
        ui.slideId = s.id; render(); sendPreview();
      } },
        h('div', { class: 'slide-item__num', text: String(i + 1) }),
        (function () {
          var cb = h('input', { type: 'checkbox', title: 'Показывать', checked: s.enabled !== false, onclick: function (e) { e.stopPropagation(); } });
          cb.addEventListener('change', function () { s.enabled = cb.checked; changed(true); });
          return cb;
        })(),
        h('div', null,
          h('div', { class: 'slide-item__title' }, s.name || s.title || 'Без названия',
            h('span', { class: 'badge', text: s.type === 'dishes' ? 'блюда' : s.type === 'events' ? 'афиша' : 'инфо' }),
            s.nearest && s.nearest.enabled ? h('span', { class: 'badge badge--accent', text: 'ближайшее' }) : null,
            sched ? h('span', { class: 'badge badge--accent', text: '⏰ ' + sched }) : null),
          h('div', { class: 'slide-item__meta', text: slideSummary(s) + ' · ' + (s.duration || data.settings.slideDuration) + ' с · ' +
            M.ANIMATION_PRESETS[(s.animation && s.animation.preset) || data.settings.animation.preset] })),
        h('div', { class: 'slide-item__actions', onclick: function (e) { e.stopPropagation(); } },
          h('button', { class: 'btn btn--sm', title: 'Выше', text: '↑', disabled: i === 0, onclick: function () { move(i, -1); } }),
          h('button', { class: 'btn btn--sm', title: 'Ниже', text: '↓', disabled: i === data.slides.length - 1, onclick: function () { move(i, 1); } }),
          h('button', { class: 'btn btn--sm', title: 'Дублировать', text: '⧉', onclick: function () {
            var c = M.clone(s); c.id = M.uid('slide'); c.name = (s.name || '') + ' (копия)'; data.slides.splice(i + 1, 0, c); ui.slideId = c.id; changed(true);
          } }),
          h('button', { class: 'btn btn--sm btn--danger', title: 'Удалить', text: '✕', onclick: function () {
            if (!confirm('Удалить слайд «' + (s.name || s.title) + '»?')) return;
            data.slides.splice(i, 1); ui.slideId = null; changed(true);
          } })));
      list.appendChild(item);
    });
    if (!data.slides.length) list.appendChild(h('p', { class: 'hint', text: 'Слайдов пока нет — добавьте вручную или сгенерируйте комбинации.' }));

    return h('div', null, head, h('div', { class: 'panel' }, list), sel ? slideEditor(sel) : null);
  }

  function move(i, d) {
    var s = data.slides.splice(i, 1)[0];
    data.slides.splice(i + d, 0, s);
    changed(true);
  }

  function generate() {
    var photoCount = data.dishes.filter(function (d) { return d.photo && d.active !== false; }).length;
    if (!data.dishes.length) { toast('Сначала добавьте блюда'); return; }
    var replace = data.slides.length ? confirm('Заменить текущие слайды сгенерированным набором?\n\nОК — заменить, Отмена — добавить в конец.') : true;
    var gen = M.generateSlides(data);
    if (replace) data.slides = gen; else data.slides = data.slides.concat(gen);
    ui.slideId = gen[0] && gen[0].id;
    changed(true);
    toast('Сгенерировано слайдов: ' + gen.length + (photoCount ? '' : ' (без фото — только текстовые)'));
  }

  function dishOptions(onlyPhoto) {
    var o = {};
    data.dishes.forEach(function (d) {
      if (onlyPhoto && !d.photo) return;
      o[d.id] = d.name + (d.price ? ' — ' + d.price + ' ' + data.settings.currency : '') + (d.photo && !onlyPhoto ? ' 📷' : '') + (d.active === false ? ' (скрыто)' : '');
    });
    return o;
  }

  function slots(arr, count, options, emptyLabel) {
    var box = h('div', { class: 'slot-list' });
    for (var i = 0; i < count; i++) {
      (function (i) {
        var holder = { v: arr[i] || '' };
        var sel = select(holder, 'v', options, { empty: emptyLabel });
        sel.addEventListener('change', function () {
          arr[i] = holder.v;
          while (arr.length && !arr[arr.length - 1]) arr.pop();
          for (var j = 0; j < arr.length; j++) if (arr[j] == null) arr[j] = '';
          changed();
        });
        box.appendChild(h('div', { class: 'slot' }, h('b', { text: String(i + 1) }), sel));
      })(i);
    }
    return box;
  }

  function animationEditor(a, withInherit, owner) {
    var box = h('div');
    if (withInherit) {
      var inherit = h('input', { type: 'checkbox', checked: !owner.animation });
      inherit.addEventListener('change', function () {
        owner.animation = inherit.checked ? null : M.clone(data.settings.animation);
        changed(true);
      });
      box.appendChild(h('label', { class: 'check' }, inherit, 'Как в общих настройках'));
      if (!owner.animation) return box;
      a = owner.animation;
      box.appendChild(h('div', { style: 'height:12px' }));
    }
    box.appendChild(h('div', { class: 'grid' },
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

  function slideEditor(s) {
    var p = h('div', { class: 'panel' });
    p.appendChild(h('div', { class: 'panel__head' },
      h('h2', { text: 'Настройки слайда' }),
      h('button', { class: 'btn btn--sm', text: '↻ Повторить анимацию', onclick: function () { frame.contentWindow.postMessage({ type: 'torsher:replay' }, '*'); } })));

    s.accent = s.accent || null;
    var accentHolder = { v: s.accent || data.settings.accent };
    var accent = h('input', { type: 'color', value: accentHolder.v });
    accent.addEventListener('input', function () { s.accent = accent.value; changed(); });

    p.appendChild(h('div', { class: 'grid' },
      field('Название в списке', input(s, 'name', { rerender: false })),
      field('Заголовок на экране', input(s, 'title')),
      field('Заголовок', h('div', { class: 'toolbar' }, checkbox(s, 'showTitle', 'Показывать', { defaultOn: true }), select(s, 'titleAlign', M.TITLE_ALIGNS))),
      field('Подзаголовок (надстрочник)', input(s, 'subtitle')),
      field('Длительность, с', input(s, 'duration', { type: 'number', min: 3, max: 120, nullable: true, placeholder: 'по умолчанию ' + data.settings.slideDuration })),
      field('Акцентный цвет', h('div', { class: 'toolbar' }, accent,
        h('button', { class: 'btn btn--sm', text: 'Общий', onclick: function () { s.accent = null; changed(true); } })))
    ));

    if (s.type === 'dishes') {
      var L = M.LAYOUTS[s.layout] || M.LAYOUTS['text-10'];
      s.photoDishes = s.photoDishes || []; s.textDishes = s.textDishes || [];
      var sec = h('details', { class: 'sec', open: true }, h('summary', { text: 'Блюда на слайде' }),
        field('Раскладка', select(s, 'layout', Object.keys(M.LAYOUTS).reduce(function (o, k) { o[k] = M.LAYOUTS[k].label; return o; }, {}), { rerender: true })));
      var cols = h('div', { class: 'grid grid--2', style: 'margin-top:12px' });
      if (L.photos) {
        var photoOpts = dishOptions(true);
        cols.appendChild(field('С фото (' + L.photos + ')', Object.keys(photoOpts).length ? slots(s.photoDishes, L.photos, photoOpts, '— не выбрано —')
          : h('p', { class: 'hint', text: 'Нет блюд с фото — загрузите фото во вкладке «Блюда».' })));
      }
      if (L.texts) cols.appendChild(field('Текстом (до ' + L.texts + ')', slots(s.textDishes, L.texts, dishOptions(false), '—')));
      sec.appendChild(cols);
      p.appendChild(sec);
    } else if (s.type === 'events') {
      s.show = s.show || { photo: true, description: true, price: true, tag: true };
      p.appendChild(h('details', { class: 'sec', open: true }, h('summary', { text: 'Содержимое афиши' }),
        h('div', { class: 'grid' },
          field('Период', select(s, 'range', { week: 'Неделя (7 дней)', '2weeks': 'Две недели (14 дней)' })),
          field('Начало периода', select(s, 'start', { today: 'С сегодняшнего дня', monday: 'С понедельника текущей недели' })),
          field('Максимум событий', select(s, 'max', { 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7' }, { number: true })),
          field('Вид', select(s, 'style', M.EVENT_STYLES)),
          field('Текст, если событий нет', input(s, 'emptyText'))),
        h('div', { class: 'toolbar', style: 'margin-top:12px' },
          checkbox(s.show, 'photo', 'Фото'), checkbox(s.show, 'description', 'Описание'),
          checkbox(s.show, 'price', 'Стоимость'), checkbox(s.show, 'tag', 'Рубрика')),
        h('p', { class: 'hint', text: 'Прошедшие события скрываются автоматически, афиша пересчитывается каждый день. Сами события — во вкладке «Мероприятия».' })));
    } else if (s.type === 'info') {
      s.lines = s.lines || [];
      var linesBox = h('div', { class: 'slot-list' });
      s.lines.forEach(function (l, i) {
        linesBox.appendChild(h('div', { class: 'grid', style: 'grid-template-columns: 1fr 2fr auto' },
          input(l, 'label', { placeholder: 'Подпись' }), textarea(l, 'value', { rows: 1, placeholder: 'Значение' }),
          h('button', { class: 'btn btn--sm btn--danger', text: '✕', onclick: function () { s.lines.splice(i, 1); changed(true); } })));
      });
      p.appendChild(h('details', { class: 'sec', open: true }, h('summary', { text: 'Строки' }), linesBox,
        h('button', { class: 'btn btn--sm', style: 'margin-top:8px', text: '+ строка', onclick: function () { s.lines.push({ label: '', value: '' }); changed(true); } })));
    }

    s.nearest = s.nearest || { enabled: false, count: 2 };
    p.appendChild(h('details', { class: 'sec', open: true }, h('summary', { text: 'Ближайшее расписание мероприятий' }),
      h('div', { class: 'toolbar' }, checkbox(s.nearest, 'enabled', 'Показывать внизу слайда блок «Скоро у нас»'),
        field('Сколько событий', select(s.nearest, 'count', { 1: '1', 2: '2', 3: '3' }, { number: true })))));

    s.schedule = s.schedule || { days: [], from: '', to: '', dateFrom: '', dateTo: '' };
    var days = h('div', { class: 'days' });
    DAYS.forEach(function (d, i) {
      var n = i + 1, on = s.schedule.days.indexOf(n) !== -1;
      var cb = h('input', { type: 'checkbox', checked: on });
      var lab = h('label', { class: on ? 'is-on' : '' }, cb, d);
      cb.addEventListener('change', function () {
        var arr = s.schedule.days.filter(function (x) { return x !== n; });
        if (cb.checked) arr.push(n);
        s.schedule.days = arr.sort();
        lab.classList.toggle('is-on', cb.checked);
        changed();
      });
      days.appendChild(lab);
    });
    p.appendChild(h('details', { class: 'sec' }, h('summary', { text: 'Когда показывать слайд' }),
      field('Дни недели (не выбрано — каждый день)', days),
      h('div', { class: 'grid', style: 'margin-top:12px' },
        field('С (время)', input(s.schedule, 'from', { type: 'time' })), field('До (время)', input(s.schedule, 'to', { type: 'time' })),
        field('С даты', input(s.schedule, 'dateFrom', { type: 'date' })), field('По дату', input(s.schedule, 'dateTo', { type: 'date' }))),
      h('p', { class: 'hint', text: 'Например, завтраки — будни с 8:00 до 12:00. Интервал через полночь тоже работает (22:00–02:00).' })));

    p.appendChild(h('details', { class: 'sec', open: true }, h('summary', { text: 'Появление информации' }),
      animationEditor(s.animation, true, s)));
    return p;
  }

  /* ===== Блюда ===== */

  function renderDishes() {
    var q = ui.dishFilter.toLowerCase();
    var rows = data.dishes.filter(function (d) {
      if (ui.dishPhoto === 'photo' && !d.photo) return false;
      if (ui.dishPhoto === 'text' && d.photo) return false;
      return !q || (d.name + ' ' + (d.category || '')).toLowerCase().indexOf(q) !== -1;
    });
    var search = h('input', { type: 'text', placeholder: 'Поиск по названию или категории', value: ui.dishFilter });
    search.addEventListener('input', function () { ui.dishFilter = search.value; var pos = search.selectionStart; render(); var s2 = document.querySelector('.filters input'); s2.focus(); s2.setSelectionRange(pos, pos); });
    var withPhoto = data.dishes.filter(function (d) { return d.photo; }).length;

    var table = h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Фото', 'Название / описание', 'Категория', 'Вес / объём', 'Цена', 'Старая цена', 'Метка', 'В витрине', ''].map(function (t) { return h('th', { text: t }); }))),
      h('tbody', null, rows.map(function (d) {
        return h('tr', { class: d.active === false ? 'is-off' : '' },
          h('td', null, photoPicker(d)),
          h('td', null, input(d, 'name'), h('div', { style: 'height:6px' }), textarea(d, 'description', { rows: 1, placeholder: 'Описание (необязательно)' })),
          h('td', { class: 'col-sm' }, input(d, 'category')),
          h('td', { class: 'col-sm' }, input(d, 'weight', { placeholder: '250 г' })),
          h('td', { class: 'col-num' }, input(d, 'price', { type: 'number', min: 0 })),
          h('td', { class: 'col-num' }, input(d, 'oldPrice', { type: 'number', min: 0, nullable: true })),
          h('td', { class: 'col-sm' }, input(d, 'tag', { placeholder: 'хит' })),
          h('td', null, checkbox(d, 'active', '', { defaultOn: true, rerender: true })),
          h('td', null, h('button', { class: 'btn btn--sm btn--danger', text: '✕', title: 'Удалить', onclick: function () {
            if (!confirm('Удалить «' + d.name + '»?')) return;
            data.dishes = data.dishes.filter(function (x) { return x !== d; });
            data.slides.forEach(function (s) {
              if (s.photoDishes) s.photoDishes = s.photoDishes.filter(function (id) { return id !== d.id; });
              if (s.textDishes) s.textDishes = s.textDishes.filter(function (id) { return id !== d.id; });
            });
            changed(true);
          } })));
      })));

    return h('div', null,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', { text: 'Ассортимент' }), h('p', { text: 'Всего ' + data.dishes.length + ' · с фото ' + withPhoto + ' · без фото ' + (data.dishes.length - withPhoto) + '. Блюда с фото можно ставить в фото-слоты, любые — в текстовые списки.' })),
        h('button', { class: 'btn btn--primary', text: '+ Блюдо', onclick: function () { data.dishes.unshift(M.newDish()); ui.dishFilter = ''; changed(true); } })),
      h('div', { class: 'panel' },
        h('div', { class: 'filters' }, search,
          select(ui, 'dishPhoto', { all: 'Все', photo: 'Только с фото', text: 'Только без фото' }, { rerender: true })),
        h('div', { style: 'height:12px' }), table));
  }

  /* ===== Мероприятия ===== */

  function renderEvents() {
    var now = new Date();
    var sorted = data.events.slice().sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); });
    var list = sorted.filter(function (e) { return ui.showPast || new Date(e.date + 'T23:59') >= now; });
    var soon = M.upcoming(data.events, now);
    var week = soon.filter(function (e) { return e.date < M.dateKey(M.addDays(now, 7)); }).length;
    var two = soon.filter(function (e) { return e.date < M.dateKey(M.addDays(now, 14)); }).length;

    var table = h('table', { class: 'table' },
      h('thead', null, h('tr', null, ['Фото', 'Дата', 'Начало', 'Конец', 'Название / описание', 'Рубрика', 'Стоимость', 'Выделить', 'Показ', ''].map(function (t) { return h('th', { text: t }); }))),
      h('tbody', null, list.map(function (e) {
        var past = new Date(e.date + 'T23:59') < now;
        return h('tr', { class: (e.active === false ? 'is-off ' : '') + (past ? 'is-past' : '') },
          h('td', null, photoPicker(e)),
          h('td', { class: 'col-sm' }, input(e, 'date', { type: 'date' })),
          h('td', { class: 'col-num' }, input(e, 'time', { type: 'time' })),
          h('td', { class: 'col-num' }, input(e, 'endTime', { type: 'time' })),
          h('td', null, input(e, 'title'), h('div', { style: 'height:6px' }), textarea(e, 'description', { rows: 1, placeholder: 'Описание' })),
          h('td', { class: 'col-sm' }, input(e, 'tag', { placeholder: 'Музыка' })),
          h('td', { class: 'col-sm' }, input(e, 'price', { placeholder: 'Вход свободный' })),
          h('td', null, checkbox(e, 'highlight', '')),
          h('td', null, checkbox(e, 'active', '', { defaultOn: true, rerender: true })),
          h('td', null, h('button', { class: 'btn btn--sm btn--danger', text: '✕', onclick: function () {
            if (!confirm('Удалить «' + e.title + '»?')) return;
            data.events = data.events.filter(function (x) { return x !== e; }); changed(true);
          } })));
      })));

    return h('div', null,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', { text: 'Мероприятия' }), h('p', { text: 'Ближайшие 7 дней: ' + week + ' · 14 дней: ' + two + '. Афиша показывает до 7 событий; прошедшие скрываются сами.' })),
        h('div', { class: 'toolbar' },
          checkbox(ui, 'showPast', 'Показывать прошедшие', { rerender: true }),
          h('button', { class: 'btn btn--primary', text: '+ Мероприятие', onclick: function () { data.events.push(M.newEvent()); changed(true); } }))),
      h('div', { class: 'panel' }, table));
  }

  /* ===== Анимация и оформление ===== */

  function renderDesign() {
    var st = data.settings;
    var tickerHolder = { v: (data.ticker || []).join('\n') };
    var ticker = textarea(tickerHolder, 'v', { rows: 4 });
    ticker.addEventListener('input', function () { data.ticker = tickerHolder.v.split('\n').map(function (x) { return x.trim(); }).filter(Boolean); });
    var accent = h('input', { type: 'color', value: st.accent });
    accent.addEventListener('input', function () { st.accent = accent.value; changed(); });

    return h('div', null,
      h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Анимация и оформление' }), h('p', { text: 'Общие настройки для всех экранов. Слайд может переопределить появление информации.' }))),
      h('div', { class: 'panel' }, h('h2', { text: 'Переключение между слайдами' }),
        h('div', { class: 'grid' },
          field('Эффект перехода', select(st.transition, 'effect', Object.keys(M.TRANSITIONS).reduce(function (o, k) { o[k] = M.TRANSITIONS[k].label; return o; }, {}))),
          field('Длительность перехода', range(st.transition, 'speed', 300, 3000, 100, function (v) { return v + ' мс'; })),
          field('Показ слайда по умолчанию, с', input(st, 'slideDuration', { type: 'number', min: 3, max: 120 }))),
        h('p', { class: 'hint', text: 'Совет: выберите «Вся программа» в предпросмотре справа, чтобы увидеть переходы.' })),
      h('div', { class: 'panel' }, h('h2', { text: 'Появление информации на слайде (по умолчанию)' }), animationEditor(st.animation, false)),
      h('div', { class: 'panel' }, h('h2', { text: 'Оформление' }),
        h('div', { class: 'grid' },
          field('Тема', select(st, 'theme', M.THEMES)),
          field('Акцентный цвет', accent),
          field('Валюта', input(st, 'currency')),
          field('Название заведения', input(data.cafe, 'name')),
          field('Подпись под названием', input(data.cafe, 'tagline')))),
      h('div', { class: 'panel' }, h('h2', { text: 'Бегущая строка' }),
        field('Строки (каждая с новой строки)', ticker),
        h('div', { class: 'grid', style: 'margin-top:12px' }, field('Скорость, пикс/с', input(st, 'tickerSpeed', { type: 'number', min: 20, max: 300 })))),
      h('div', { class: 'panel' }, h('h2', { text: 'Работа экрана' }),
        h('div', { class: 'grid' },
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
      var version = 'zip-' + new Date().toISOString();
      zip.file('content/data.json', json + '\n');
      zip.file('content/data.js', 'window.__TORSHER_DATA__ = ' + json + ';\n');
      zip.file('build.json', JSON.stringify({ commit: version, builtAt: new Date().toISOString() }) + '\n');
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
    var api = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo;
    var headers = { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
    function call(method, path, body) {
      return fetch(api + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined }).then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(method + ' ' + path + ': ' + r.status + ' ' + (j.message || ''));
          return j;
        });
      });
    }
    var base, files = [];
    files.push({ path: 'content/data.json', content: JSON.stringify(data, null, 2) + '\n', encoding: 'utf-8' });
    referencedPhotos().forEach(function (p) { if (media[p]) files.push({ path: p, content: dataURLtoBase64(media[p]), encoding: 'base64' }); });

    log('Ветка ' + cfg.branch + '…');
    return call('GET', '/git/ref/heads/' + encodeURIComponent(cfg.branch)).then(function (ref) {
      base = ref.object.sha;
      return call('GET', '/git/commits/' + base);
    }).then(function (commit) {
      log('Загружаю файлов: ' + files.length);
      return Promise.all(files.map(function (f) {
        return call('POST', '/git/blobs', { content: f.content, encoding: f.encoding }).then(function (b) {
          return { path: f.path, mode: '100644', type: 'blob', sha: b.sha };
        });
      })).then(function (tree) { return call('POST', '/git/trees', { base_tree: commit.tree.sha, tree: tree }); });
    }).then(function (tree) {
      return call('POST', '/git/commits', { message: cfg.message || 'Обновление витрины из админки', tree: tree.sha, parents: [base] });
    }).then(function (c) {
      return call('PATCH', '/git/refs/heads/' + encodeURIComponent(cfg.branch), { sha: c.sha }).then(function () { return c; });
    });
  }

  function renderPublish() {
    var logBox = h('div', { class: 'log' });
    function log(m) { logBox.textContent += m + '\n'; logBox.scrollTop = 1e9; }

    var git = {};
    try { git = JSON.parse(localStorage.getItem(GIT_KEY) || '{}'); } catch (e) { git = {}; }
    git.owner = git.owner || 'nortan'; git.repo = git.repo || 'torsher_display'; git.branch = git.branch || 'main';
    var gitLog = h('div', { class: 'log' });

    var importInput = h('input', { type: 'file', accept: 'application/json,.json', style: 'display:none' });
    importInput.addEventListener('change', function () {
      var f = importInput.files[0]; if (!f) return;
      f.text().then(function (t) { data = normalize(JSON.parse(t)); ui.slideId = null; changed(true); toast('Данные импортированы'); })
        .catch(function (e) { toast('Ошибка импорта: ' + e.message); });
    });

    return h('div', null,
      h('div', { class: 'page-head' }, h('div', null, h('h1', { text: 'Публикация' }), h('p', { text: 'Выгрузка статической сборки на сервер, где экран крутится автономно.' }))),
      h('div', { class: 'panel' }, h('h2', { text: '1. Статическая сборка (ZIP)' }),
        h('p', { html: 'Архив содержит плеер, шрифты, библиотеки, фото и данные — всё, что нужно экрану. Распакуйте на любой веб-сервер (nginx, Apache, хостинг) или откройте <code>index.html</code> прямо с флешки. Инструкция — в <code>SERVER.md</code> внутри архива.' }),
        h('button', { class: 'btn btn--primary', text: 'Скачать сборку .zip', onclick: function (e) {
          var btn = e.target; btn.disabled = true; logBox.textContent = '';
          buildZip(log).then(function (blob) {
            download(blob, 'torsher-display-' + M.dateKey(new Date()) + '.zip');
            log('Готово: ' + Math.round(blob.size / 1024) + ' КБ');
          }).catch(function (err) { log('Ошибка: ' + err.message); }).then(function () { btn.disabled = false; });
        } }), logBox),
      h('div', { class: 'panel' }, h('h2', { text: '2. Публикация в Git (GitHub)' }),
        h('p', { html: 'Коммитит <code>content/data.json</code> и новые фото в репозиторий. Дальше GitHub Actions соберёт сайт и выложит на GitHub Pages и/или ваш сервер (см. README), а экраны подтянут изменения сами. Нужен <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">токен</a> с правом <b>Contents: Read and write</b>.' }),
        h('div', { class: 'grid' },
          field('Владелец', input(git, 'owner')), field('Репозиторий', input(git, 'repo')), field('Ветка', input(git, 'branch')),
          field('Токен', (function () { var i = input(git, 'token', { type: 'password' }); i.autocomplete = 'off'; return i; })()),
          field('Сообщение коммита', input(git, 'message', { placeholder: 'Обновление витрины из админки' }))),
        h('div', { class: 'toolbar', style: 'margin-top:12px' },
          checkbox(git, 'remember', 'Запомнить в этом браузере'),
          h('button', { class: 'btn btn--primary', text: 'Опубликовать в Git', onclick: function (e) {
            if (!git.token) { toast('Укажите токен'); return; }
            var saveCfg = git.remember ? git : { owner: git.owner, repo: git.repo, branch: git.branch };
            localStorage.setItem(GIT_KEY, JSON.stringify(saveCfg));
            var btn = e.target; btn.disabled = true; gitLog.textContent = '';
            gitPublish(git, function (m) { gitLog.textContent += m + '\n'; }).then(function (c) {
              gitLog.textContent += 'Готово: коммит ' + c.sha.slice(0, 7) + '\n' + (c.html_url || '');
              toast('Опубликовано в Git');
            }).catch(function (err) { gitLog.textContent += 'Ошибка: ' + err.message + '\n'; }).then(function () { btn.disabled = false; });
          } })), gitLog),
      h('div', { class: 'panel' }, h('h2', { text: '3. Данные' }),
        h('div', { class: 'toolbar' },
          h('button', { class: 'btn', text: 'Экспорт data.json', onclick: function () {
            download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'data.json');
          } }),
          h('button', { class: 'btn', text: 'Импорт data.json', onclick: function () { importInput.click(); } }), importInput,
          h('button', { class: 'btn btn--danger', text: 'Сбросить к версии из репозитория', onclick: function () {
            if (!confirm('Заменить локальные изменения данными из content/data.json?')) return;
            loadFromRepo().then(function (d) { data = normalize(d); ui.slideId = null; changed(true); toast('Загружено из репозитория'); })
              .catch(function (e) { toast('Ошибка: ' + e.message); });
          } })),
        h('p', { class: 'hint', html: 'Экспортированный <code>data.json</code> можно положить в <code>content/</code> репозитория вручную. Фото, загруженные в админке, попадут в репозиторий только через публикацию в Git или в ZIP-сборку.' })));
  }

  /* ---------- Старт ---------- */

  function start() {
    scalePreview();
    openDB().then(dbAll).then(function (m) {
      media = m;
      var saved = null;
      try { saved = localStorage.getItem(STORE_KEY); } catch (e) { /* нет */ }
      if (saved) return JSON.parse(saved);
      return loadFromRepo().catch(function () { return {}; });
    }).then(function (d) {
      data = normalize(d);
      render();
      sendPreview();
    });
  }

  start();
})();
