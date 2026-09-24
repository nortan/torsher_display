/*
 * Плеер рекламной витрины (вертикальный FullHD 1080×1920).
 * Swiper 14 переключает слайды, GSAP 3.15 анимирует содержимое активного слайда и бегущую строку.
 * Данные: content/data.json (или window.__TORSHER_DATA__ из content/data.js при запуске с диска).
 * В режиме ?preview=1 данные приходят из админки через postMessage.
 */
(function () {
  'use strict';

  var M = window.TorsherModel;
  // плагины регистрируем только те, что загрузились (защита от устаревшего index.html в кеше)
  gsap.registerPlugin.apply(gsap, [window.SplitText, window.CustomEase, window.ScrambleTextPlugin].filter(Boolean));
  CustomEase.create('soft', 'M0,0 C0.16,0.84 0.3,1 1,1');

  var W = 1080, H = 1920;
  var params = new URLSearchParams(location.search);
  var PREVIEW = params.get('preview') === '1';
  // Источник данных: PHP-бэкенд (api/data.php), а если его нет (статическая сборка) — content/data.json.
  var DATA_SOURCES = params.get('src') ? [params.get('src')] : ['api/data.php', 'content/data.json'];
  var CACHE_KEY = 'torsher-display-data';
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    canvas: $('canvas'), topbar: $('topbar'), brand: $('brand'), clock: $('clock'), logo: $('logo'), name: $('cafeName'), tagline: $('cafeTagline'),
    time: $('clockTime'), date: $('clockDate'), stage: $('stage'), slides: $('slides'),
    progressWrap: $('progressWrap'), progress: $('progress'),
    ticker: $('ticker'), tickerTrack: $('tickerTrack'), status: $('status')
  };

  var state = {
    data: null, dataText: '', renderKey: '', tickerKey: '',
    swiper: null, slideCtx: null, activeEl: null, tickerTween: null, build: null,
    preview: { slideId: null, ignoreSchedule: false },
    slideMeta: []
  };

  /* ---------- Утилиты ---------- */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function settings() {
    var s = (state.data && state.data.settings) || {};
    var d = M.defaultSettings();
    Object.keys(s).forEach(function (k) { d[k] = s[k]; });
    return d;
  }

  function dishById(id) {
    var list = (state.data && state.data.dishes) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id && list[i].active !== false) return list[i];
    return null;
  }

  function priceHTML(price, weight, old) {
    if (price == null || price === '') return '';
    var cur = settings().currency;
    var main = typeof price === 'number'
      ? '<span class="price__num" data-n="' + price + '">' + esc(price.toLocaleString('ru-RU')) + '</span>' + (cur ? '<span class="price__cur">' + esc(cur) + '</span>' : '')
      : esc(price);
    return (old ? '<span class="price__old">' + esc(Number(old).toLocaleString('ru-RU')) + '</span>' : '') +
      main + (weight ? '<span class="price__w">/' + esc(weight) + '</span>' : '');
  }

  function chip(tag) { return tag ? ' <span class="chip">' + esc(tag) + '</span>' : ''; }

  function showStatus(text) { els.status.hidden = !text; els.status.textContent = text || ''; }

  function isLight(hex) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return true;
    var r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
  }

  /* ---------- Холст 1080×1920 под фактический вьюпорт ---------- */

  function layoutCanvas() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var k = vw / W, h = vh / k, x = 0, y = 0;
    // Небольшое расхождение пропорций (±10%) — тянем холст по высоте, раскладка на flex это поглощает.
    if (h < H * 0.9 || h > H * 1.12) {
      k = Math.min(vw / W, vh / H); h = H;
      x = (vw - W * k) / 2; y = (vh - H * k) / 2;
    }
    els.canvas.style.height = h + 'px';
    els.canvas.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
  }

  /* Если контент слайда не влез — аккуратно уменьшаем его целиком. */
  function fitSlide(slideEl) {
    var fit = slideEl.querySelector('.slide__fit');
    if (!fit) return;
    fit.style.transform = ''; fit.style.width = '';
    // Тарелки специально вылетают за край — при замере их не учитываем.
    var plates = fit.querySelectorAll('.plate');
    Array.prototype.forEach.call(plates, function (p) { p.style.display = 'none'; });
    var avail = slideEl.clientHeight, need = fit.scrollHeight;
    Array.prototype.forEach.call(plates, function (p) { p.style.display = ''; });
    if (need > avail + 1 && avail > 0) {
      var k = Math.max(0.6, avail / need);
      fit.style.transformOrigin = '0 0';
      fit.style.transform = 'scale(' + k + ')';
      fit.style.width = (100 / k) + '%';
    }
  }

  function fitAll() {
    Array.prototype.forEach.call(els.slides.querySelectorAll('.slide'), fitSlide);
  }

  /* ---------- Шаблоны ---------- */

  function head(s) {
    if (s.showTitle === false) return '';
    return '<header data-el="head" class="s-head s-head--' + (s.titleAlign || 'left') + '">' +
      (s.subtitle ? '<div class="s-kicker a-kick">' + esc(s.subtitle) + '</div>' : '') +
      '<h1 class="s-title a-title">' + esc(s.title || '') + '</h1>' +
    '</header>';
  }

  /* Значок NEW у новинки. */
  function newBadge(d) {
    if (!d.isNew) return '';
    var nb = settings().newBadge || {};
    return '<span class="new-badge a-new"><span class="new-badge__t">' + esc(nb.text || 'NEW') + '</span><span class="shine"></span></span>';
  }

  function row(d) {
    return '<div class="row a-row' + (d.accent ? ' is-accent' : '') + '">' +
      '<div class="row__line"><span class="row__name"><span class="n-t a-name">' + esc(d.name) + '</span>' + chip(d.tag) + newBadge(d) + '</span>' +
      '<span class="row__dots"></span><span class="row__price price a-price shine-host">' + priceHTML(d.price, null, d.oldPrice) + '<span class="shine"></span></span></div>' +
      (d.description ? '<div class="row__desc">' + esc(d.description) + '</div>' : '') +
      (d.weight ? '<div class="row__w">(' + esc(d.weight) + ')</div>' : '') +
    '</div>';
  }

  function list(ids, size) {
    var items = ids.map(dishById).filter(Boolean);
    if (!items.length) return '';
    return '<div data-el="list" class="list list--' + size + (size === 'sm' || size === '2col' ? '' : ' grow') + '">' + items.map(row).join('') + '</div>';
  }

  /* Главное блюдо: рамка с «перекрестьем» по углам, крупная цена под рамкой — как в печатном меню. */
  function frame(d, extra) {
    var n = /feat--(\d)/.exec(extra || '');
    return '<div class="feat' + (extra || '') + (d.accent ? ' is-accent' : '') + ' a-card" data-el="feat-' + (n ? n[1] : 1) + '">' +
      '<div class="frame">' + newBadge(d) + '<div class="frame__name"><span class="n-t a-name">' + esc(d.name) + '</span>' + chip(d.tag) + '</div>' +
        (d.description ? '<div class="frame__desc">' + esc(d.description) + '</div>' : '') + '</div>' +
      '<div class="feat__price price a-price shine-host">' + priceHTML(d.price, d.weight, d.oldPrice) + '<span class="shine"></span></div>' +
    '</div>';
  }

  function nearBlock(s, now) {
    if (!s.nearest || !s.nearest.enabled) return '';
    var evs = M.nearestEvents(state.data.events, now, s.nearest.count);
    if (!evs.length) return '';
    return '<div class="near a-near" data-el="near"><div class="near__label">Скоро у нас</div>' + evs.map(function (e) {
      var f = M.formatEventDate(e, now);
      var d = M.parseDate(e.date);
      var rel = (f.relative === 'сегодня' || f.relative === 'завтра') ? f.relative + ', ' : '';
      var when = rel + f.weekday + ' ' + f.day + ' ' + MONTHS_SHORT[d.getMonth()];
      return '<div class="near__item"><div class="near__when">' + esc(when + (e.time ? ' · ' + e.time : '')) + '</div>' +
        '<div class="near__title">' + esc(e.title) + '</div></div>';
    }).join('') + '</div>';
  }

  function groupedList(ids) {
    var items = ids.map(dishById).filter(Boolean);
    var groups = [], byName = {};
    items.forEach(function (d) {
      var k = d.category || 'Меню';
      if (!byName[k]) { byName[k] = []; groups.push(k); }
      byName[k].push(d);
    });
    return '<div class="groups grow" data-el="list">' + groups.map(function (g) {
      return '<section class="group"><div class="group__head a-row">' + esc(g) + '</div>' +
        '<div class="list list--sm">' + byName[g].map(row).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  /* Обтравленная тарелка в своей области сетки; вылет за край задаётся в CSS. */
  function plateHTML(d, n, pos) {
    // Ручное смещение из настроек слайда: CSS-свойства translate/scale/rotate
    // складываются с transform, который анимирует GSAP, и не мешают ему.
    var st = '';
    if (pos) {
      var k = Number(pos.scale) || 1;
      st = ' style="translate:' + (Number(pos.x) || 0) + 'px ' + (Number(pos.y) || 0) + 'px;scale:' + (pos.flip ? -k : k) + ' ' + k + ';rotate:' + (Number(pos.rotate) || 0) + 'deg"';
    }
    return '<div class="plate plate--' + n + ' a-img" data-el="plate-' + n + '"><img class="plate__img a-plate" src="' + esc(d.photo) + '" alt=""' + st + '></div>';
  }
  function feat(d, n, small) {
    return frame(d, ' feat--' + n + (small ? ' feat--sm' : ''));
  }
  function txt(ids, n, size) {
    var l = list(ids, size || 'sm');
    return l ? '<div class="txt txt--' + n + '" data-el="txt-' + n + '">' + l + '</div>' : '';
  }

  /* Композиции «фото : текст» по мотивам печатного меню. */
  function composition(layout, photos, texts, positions) {
    var p = photos, t = texts, out = '', base = layout;
    var plate = function (d, n) { return plateHTML(d, n, (positions || [])[n - 1]); };
    switch (layout) {
      case 'hero':
        out = feat(p[0], 1) + plate(p[0], 1); break;
      case 'p1t2-bottom': case 'p1t2-side': case 'p1t2-top':
        out = feat(p[0], 1) + txt(t.slice(0, 2), 1, 'md') + plate(p[0], 1); break;
      case 'p1t4':
        out = feat(p[0], 1) + txt(t.slice(0, 4), 1) + plate(p[0], 1); break;
      case 'p1t6':
        out = feat(p[0], 1) + txt(t.slice(0, 6), 1) + plate(p[0], 1); break;
      case 'p2t4':
        p.forEach(function (d, i) { out += feat(d, i + 1) + txt(t.slice(i * 2, i * 2 + 2), i + 1) + plate(d, i + 1); }); break;
      case 'p2t4-bottom':
        out = txt(t.slice(0, 4), 1, '2col');
        p.forEach(function (d, i) { out += feat(d, i + 1) + plate(d, i + 1); }); break;
      case 'p1t8-2col':
        out = txt(t.slice(0, 8), 1, '2col') + feat(p[0], 1) + plate(p[0], 1); break;
      case 'p3t6':
        p.forEach(function (d, i) { out += feat(d, i + 1, true) + txt(t.slice(i * 2, i * 2 + 2), i + 1) + plate(d, i + 1); }); break;
      case 'p3t6-row':
        out = txt(t.slice(0, 6), 1, '2col');
        p.forEach(function (d, i) { out += feat(d, i + 1, true) + plate(d, i + 1); }); break;
      case 'p4t4':
        out = txt(t.slice(0, 4), 1, '2col');
        p.forEach(function (d, i) { out += feat(d, i + 1, true) + plate(d, i + 1); }); break;
      // только фото и фото + 1–2 текстом; часть использует сетку уже существующих композиций
      case 'p1-center':
        out = plate(p[0], 1) + feat(p[0], 1); break;
      case 'p2': case 'p3':
        p.forEach(function (d, i) { out += feat(d, i + 1, layout === 'p3') + plate(d, i + 1); }); break;
      case 'p1t1':
        base = 'p1t2-bottom'; out = feat(p[0], 1) + txt(t.slice(0, 1), 1, 'md') + plate(p[0], 1); break;
      case 'p1t2-center':
        out = feat(p[0], 1) + plate(p[0], 1) + txt(t.slice(0, 2), 1, '2col'); break;
      case 'p2t1':
        base = 'p2t4-bottom'; out = txt(t.slice(0, 1), 1, 'lg');
        p.forEach(function (d, i) { out += feat(d, i + 1) + plate(d, i + 1); }); break;
      case 'p2t2':
        base = 'p2t4';
        p.forEach(function (d, i) { out += feat(d, i + 1) + txt(t.slice(i, i + 1), i + 1, 'md') + plate(d, i + 1); }); break;
      case 'p3t1': case 'p3t2':
        base = 'p3'; out = txt(t.slice(0, 2), 1, t.length > 1 ? '2col' : 'md');
        p.forEach(function (d, i) { out += feat(d, i + 1, true) + plate(d, i + 1); }); break;
    }
    return '<div class="comp comp--' + base + (base !== layout ? ' comp--' + layout : '') + ' comp--n' + p.length + '">' + out + '</div>';
  }

  function renderDishes(s, now) {
    if (M.LAYOUT_ALIASES[s.layout]) s = Object.assign({}, s, { layout: M.LAYOUT_ALIASES[s.layout] });
    var L = M.LAYOUTS[s.layout] || M.LAYOUTS['text-10'];
    var photos = (s.photoDishes || []).map(dishById).filter(function (d) { return d && d.photo; }).slice(0, L.photos);
    var texts = (s.textDishes || []).filter(Boolean).slice(0, L.texts);
    var near = nearBlock(s, now);
    var view = L.view;
    var fit = function (body, extra) { return '<div class="slide__fit' + (extra || '') + '">' + head(s) + body + near + '</div>'; };

    if (view === 'comp') {
      if (photos.length === L.photos) {
        return { cls: 'comp-slide', html: fit(composition(s.layout, photos, texts, s.photoPos), ' slide__fit--comp') };
      }
      view = 'list';   // не хватает блюд с фото — показываем списком
      texts = photos.map(function (d) { return d.id; }).concat(texts);
    }

    switch (view) {
      case 'list-2col':
        return { cls: 'dishes', html: fit(list(texts, '2col grow')) };
      case 'list-groups':
        return { cls: 'dishes', html: fit(groupedList(texts)) };
      case 'list-feature':
        var first = dishById(texts[0]);
        return { cls: 'dishes', html: fit((first ? frame(first) : '') + list(texts.slice(1), 'md')) };
      case 'list-lg':
        return { cls: 'dishes', html: fit(list(texts, 'lg')) };
      default:
        return { cls: 'dishes', html: fit(list(texts, 'md')) };
    }
  }

  function weekStart(d) { return M.addDays(d, -((d.getDay() || 7) - 1)); }

  function renderEvents(s, now) {
    var evs = M.eventsForSlide(state.data.events, s, now);
    var show = s.show || {};
    var style = M.EVENT_STYLES[s.style] ? s.style : 'list';
    var html = '';
    if (!evs.length) {
      html = '<div class="events-empty a-row">' + esc(s.emptyText || 'Скоро анонсируем новые события') + '</div>';
    } else {
      var thisWeek = M.dateKey(weekStart(now));
      var lastHead = '';
      var withHeads = s.range === '2weeks' && style !== 'cards';
      html = '<div data-el="events" class="events grow events--' + style + (evs.length > 5 ? ' events--dense' : '') + '">' + evs.map(function (e) {
        var f = M.formatEventDate(e, now);
        var h = '';
        if (withHeads) {
          var wk = M.dateKey(weekStart(M.parseDate(e.date)));
          var label = wk === thisWeek ? 'Эта неделя' : 'Следующая неделя';
          if (label !== lastHead) { h = '<div class="week-head a-row">' + label + '</div>'; lastHead = label; }
        }
        var d = M.parseDate(e.date);
        var soon = f.relative === 'сегодня' || f.relative === 'завтра' ? '<span class="chip">' + f.relative + '</span>' : '';
        return h + '<div class="ev a-row' + (e.highlight ? ' ev--hl' : '') + '">' +
          '<div class="ev__date"><div class="ev__day">' + f.day + '</div><div class="ev__month">' + esc(f.month) + '</div>' +
            '<div class="ev__wd">' + esc(WEEKDAYS[d.getDay()]) + '</div></div>' +
          '<div class="ev__body">' +
            '<div class="ev__top"><span class="ev__time">' + esc(f.time || 'весь день') + '</span>' + soon +
              (show.tag !== false && e.tag ? '<span class="ev__tag">' + esc(e.tag) + '</span>' : '') + '</div>' +
            '<div class="ev__title">' + esc(e.title) + '</div>' +
            (show.description !== false && e.description ? '<div class="ev__desc">' + esc(e.description) + '</div>' : '') +
            (show.price !== false && e.price ? '<div class="ev__price">' + esc(e.price) + '</div>' : '') +
          '</div>' +
          (show.photo !== false && e.photo ? '<img class="ev__photo a-img" src="' + esc(e.photo) + '" alt="">' : '') +
        '</div>';
      }).join('') + '</div>';
    }
    return { cls: 'events-slide', html: '<div class="slide__fit">' + head(s) + html + nearBlock(s, now) + '</div>' };
  }

  function renderInfo(s, now) {
    return { cls: 'info', html: '<div class="slide__fit">' + head(s) +
      '<div class="info-grid grow" data-el="info">' + (s.lines || []).map(function (l) {
        return '<div class="info-card a-row"><div class="info-card__label">' + esc(l.label) + '</div><div class="info-card__value">' + esc(l.value) + '</div></div>';
      }).join('') + '</div>' + nearBlock(s, now) + '</div>' };
  }

  /* Обратный отсчёт до мероприятия: название, время, живой счётчик, изображение. */
  function renderCountdown(s, now) {
    var ev = M.countdownEvent(state.data.events, s, now);
    if (!ev) {
      return { cls: 'countdown', html: '<div class="slide__fit">' + head(s) +
        '<div class="cd grow"><div class="cd__empty a-row">Сегодня мероприятий нет — слайд не показывается на экране</div></div></div>' };
    }
    var photo = s.photo || ev.photo;
    var f = M.formatEventDate(ev, now);
    var start = M.eventStart(ev).getTime();
    return { cls: 'countdown', html: '<div class="slide__fit">' + head(s) +
      '<div class="cd grow">' +
        (photo ? '<div class="cd__photo a-card" data-el="photo"><img class="a-img" src="' + esc(photo) + '" alt=""></div>' : '') +
        '<div class="cd__name a-row" data-el="evname">' + esc(ev.title) + '</div>' +
        '<div class="cd__time a-row" data-el="evtime">' + esc(f.relative === 'сегодня' ? 'Сегодня' : f.weekday + ', ' + f.day + ' ' + f.month) +
          ' в <b>' + esc(ev.time || '—') + '</b></div>' +
        '<div class="cd__timer a-row" data-el="timer" data-target="' + start + '" data-started="' + esc(s.startedText || 'Уже началось!') + '">' +
          '<div class="cd__label">' + esc(s.label || 'До начала') + '</div>' +
          '<div class="cd__digits">' +
            '<span class="cd__u cd__u--d"><b data-u="d">0</b><i data-l="d">дней</i></span>' +
            '<span class="cd__u"><b data-u="h">00</b><i data-l="h">часов</i></span>' +
            '<span class="cd__u"><b data-u="m">00</b><i data-l="m">минут</i></span>' +
            '<span class="cd__u"><b data-u="s">00</b><i data-l="s">секунд</i></span>' +
          '</div></div>' +
      '</div>' + nearBlock(s, now) + '</div>' };
  }

  function plural(n, one, few, many) {
    var a = n % 100, b = n % 10;
    if (a > 10 && a < 20) return many;
    return b === 1 ? one : b >= 2 && b <= 4 ? few : many;
  }
  var UNITS = { d: ['день', 'дня', 'дней'], h: ['час', 'часа', 'часов'], m: ['минута', 'минуты', 'минут'], s: ['секунда', 'секунды', 'секунд'] };

  /* Раз в секунду обновляем все счётчики на экране. */
  function tickCountdowns() {
    var now = Date.now();
    Array.prototype.forEach.call(els.slides.querySelectorAll('.cd__timer[data-target]'), function (t) {
      var left = Math.max(0, Math.floor((Number(t.getAttribute('data-target')) - now) / 1000));
      if (left <= 0) {
        if (!t.classList.contains('is-started')) { t.classList.add('is-started'); t.querySelector('.cd__digits').textContent = t.getAttribute('data-started'); }
        return;
      }
      var v = { d: Math.floor(left / 86400), h: Math.floor(left % 86400 / 3600), m: Math.floor(left % 3600 / 60), s: left % 60 };
      Object.keys(v).forEach(function (u) {
        var b = t.querySelector('[data-u="' + u + '"]'), l = t.querySelector('[data-l="' + u + '"]');
        if (!b) return;
        b.textContent = u === 'd' ? String(v.d) : ('0' + v[u]).slice(-2);
        l.textContent = plural(v[u], UNITS[u][0], UNITS[u][1], UNITS[u][2]);
      });
      t.classList.toggle('has-days', v.d > 0);
    });
  }

  /* Объявление: крупный текст, пометка и (по желанию) фото в трёх вариантах. */
  function renderAnnounce(s, now) {
    var variant = M.ANNOUNCE_STYLES[s.variant] ? s.variant : 'center';
    var body = '<div class="ann ann--' + variant + (variant === 'center' ? ' grow' : '') + '" data-el="body">' +
      '<div class="ann__text a-row">' + esc(s.text || '') + '</div>' +
      (s.note ? '<div class="ann__note a-row">' + esc(s.note) + '</div>' : '') + '</div>';
    var photo = s.photo ? esc(s.photo) : '';
    if (variant === 'photo-bg' && photo) {
      return { cls: 'announce announce--bg', html: '<div class="ann-bg a-img" data-el="photo"><img src="' + photo + '" alt=""></div>' +
        '<div class="slide__fit">' + head(s) + body + nearBlock(s, now) + '</div>' };
    }
    var ph = variant === 'photo-top' && photo ? '<div class="ann__photo a-card" data-el="photo"><img class="a-img" src="' + photo + '" alt=""></div>' : '';
    return { cls: 'announce', html: '<div class="slide__fit">' + head(s) + ph + body + nearBlock(s, now) + '</div>' };
  }

  function renderSlide(s, now) {
    var r = s.type === 'events' ? renderEvents(s, now) : s.type === 'info' ? renderInfo(s, now) : s.type === 'announce' ? renderAnnounce(s, now) : s.type === 'countdown' ? renderCountdown(s, now) : renderDishes(s, now);
    var dur = Math.round((Number(s.duration) || settings().slideDuration) * 1000);
    var vars = [];
    if (s.accent) vars.push('--accent-local:' + esc(s.accent));
    var z = s.sizes || {};
    if (z.title) vars.push('--title-scale:' + Number(z.title));
    if (z.dish) vars.push('--dish-scale:' + Number(z.dish));
    if (z.text) vars.push('--text-scale:' + Number(z.text));
    var sc = s.colors && !Array.isArray(s.colors) ? s.colors : {};
    Object.keys(M.TEXT_ROLES).forEach(function (role) {
      var c = M.resolveColor(sc[role], settings().palette);
      if (c) vars.push(M.TEXT_ROLES[role].css + ':' + c);
    });
    var style = vars.length ? ' style="' + vars.join(';') + '"' : '';
    // лёгкий анимированный градиент на фоне: у слайда своё значение или общее из настроек
    var bgOn = s.bgGradient == null || s.bgGradient === '' ? settings().bgGradient !== false : !!s.bgGradient;
    var bgc = Object.assign({}, settings().bg || {});
    var own = s.bg && !Array.isArray(s.bg) ? s.bg : {};
    Object.keys(own).forEach(function (k) { if (own[k] != null && own[k] !== '') bgc[k] = own[k]; }); // пустое — как в общих
    var c1 = M.resolveColor(bgc.color1, settings().palette), c2 = M.resolveColor(bgc.color2, settings().palette);
    if (bgOn && c1) vars.push('--bg1:' + c1);
    if (bgOn && c2) vars.push('--bg2:' + c2);
    if (bgOn) vars.push('--bg-k:' + (Number(bgc.intensity) > 0 ? Number(bgc.intensity) : 1));
    style = vars.length ? ' style="' + vars.join(';') + '"' : '';
    var bg = bgOn ? '<div class="slide-bg" aria-hidden="true" data-speed="' + (Number(bgc.speed) > 0 ? Number(bgc.speed) : 1) + '"><i class="slide-bg__blob slide-bg__blob--1"></i><i class="slide-bg__blob slide-bg__blob--2"></i></div>' : '';
    return '<div class="swiper-slide" data-swiper-autoplay="' + dur + '" data-slide-id="' + esc(s.id) + '">' +
      '<div class="slide slide--' + r.cls + '"' + style + '>' + bg + r.html + '</div></div>';
  }

  /* ---------- GSAP: появление информации ---------- */

  var PRESETS = {
    rise:       { item: { y: 70, autoAlpha: 0 }, title: { yPercent: 110 }, mask: true },
    fade:       { item: { autoAlpha: 0, duration: 1.2, ease: 'power1.out' }, title: { autoAlpha: 0, duration: 1 } },
    slide:      { item: { x: 160, autoAlpha: 0 }, title: { x: 90, autoAlpha: 0 } },
    zoom:       { item: { scale: 0.7, autoAlpha: 0, ease: 'back.out(1.7)' }, title: { scale: 0.3, autoAlpha: 0, ease: 'back.out(2.2)' } },
    flip:       { item: { rotationX: -90, transformPerspective: 900, transformOrigin: '50% 0%', autoAlpha: 0 }, title: { rotationX: -90, transformPerspective: 600, transformOrigin: '50% 100%', autoAlpha: 0 } },
    blur:       { item: { filter: 'blur(16px)', autoAlpha: 0, duration: 1.1 }, title: { filter: 'blur(12px)', autoAlpha: 0 } },
    typewriter: { item: { autoAlpha: 0, x: -24 }, title: { autoAlpha: 0, duration: 0.01, ease: 'none' }, titleStagger: 0.06 },
    cascade:    { item: { x: function (i) { return i % 2 ? 240 : -240; }, autoAlpha: 0 }, title: { yPercent: -110 }, mask: true }
  };

  /* ---------- Изображения, названия, цены, акцент, NEW ---------- */

  var PHOTO_IN = {
    rise:  function () { return { y: 180 }; },
    slide: function () { return { x: function (i) { return i % 2 ? 340 : -340; } }; },
    zoom:  function () { return { scale: 1.5, ease: 'power3.out' }; },
    spin:  function () { return { rotation: -140, scale: 0.5 }; },
    drop:  function (d) { return { y: -420, ease: 'bounce.out', duration: d * 1.3 }; },
    roll:  function () { return { x: -700, rotation: -320, ease: 'power3.out' }; },
    flip:  function () { return { rotationY: 90, transformPerspective: 1200 }; },
    fade:  function () { return {}; }
  };

  var PHOTO_LOOP = {
    kenburns: function (t, dur) { gsap.fromTo(t, { scale: 1.12 }, { scale: 1, duration: dur + 2, ease: 'none' }); },
    float:    function (t, dur, d) { gsap.to(t, { y: -18, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.5, delay: d }); },
    breathe:  function (t, dur, d) { gsap.to(t, { scale: 1.045, duration: 3.5, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.6, delay: d }); },
    sway:     function (t, dur, d) { gsap.to(t, { rotation: 2.5, transformOrigin: '50% 100%', duration: 3.2, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.4, delay: d }); },
    drift:    function (t, dur, d) { gsap.to(t, { x: function (i) { return i % 2 ? -26 : 26; }, duration: 6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: d }); }
  };

  var SCRAMBLE_CHARS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ';

  function nameEffect(tl, names, effect, dur, pos, stagger) {
    var accent = getComputedStyle(names[0]).getPropertyValue('--accent-local').trim() || settings().accent;
    if (effect === 'scramble' && !window.ScrambleTextPlugin) effect = 'chars';
    if (effect === 'scramble') {
      names.forEach(function (el, i) {
        var text = el.textContent;
        tl.to(el, { duration: dur * 2, scrambleText: { text: text, chars: SCRAMBLE_CHARS, speed: 0.5, revealDelay: dur * 0.6 } }, typeof pos === 'number' ? pos + i * stagger : pos + '+=' + (i * stagger));
      });
      return;
    }
    if (effect === 'highlight') {
      gsap.set(names, { backgroundImage: 'linear-gradient(' + accent + ',' + accent + ')', backgroundRepeat: 'no-repeat', backgroundPosition: '0 96%', backgroundSize: '0% 4px' });
      tl.to(names, { backgroundSize: '100% 4px', duration: dur, ease: 'power2.inOut', stagger: stagger }, pos);
      return;
    }
    if (effect === 'blur') { tl.from(names, { filter: 'blur(10px)', autoAlpha: 0, duration: dur, stagger: stagger }, pos); return; }
    var byWords = effect === 'words';
    var parts = [];
    names.forEach(function (el) {
      // буквы всегда внутри слов — иначе перенос строки может разорвать слово посередине
      var sp = SplitText.create(el, { type: byWords ? 'words' : 'words,chars', mask: effect === 'chars' ? 'chars' : undefined, aria: 'auto' });
      parts = parts.concat(byWords ? sp.words : sp.chars);
    });
    if (effect === 'chars') tl.from(parts, { yPercent: 110, duration: dur, stagger: 0.012 }, pos);
    else if (effect === 'words') tl.from(parts, { y: 26, autoAlpha: 0, duration: dur, stagger: 0.05 }, pos);
    else if (effect === 'typewriter') tl.from(parts, { autoAlpha: 0, duration: 0.01, ease: 'none', stagger: Math.max(0.015, dur / 20) }, pos);
    else if (effect === 'wave') tl.from(parts, { y: -26, autoAlpha: 0, duration: dur, ease: 'back.out(3)', stagger: { each: 0.02, from: 'center' } }, pos);
  }

  function priceIn(tl, prices, effect, dur, pos, stagger) {
    var st = stagger / 2;
    if (effect === 'pop') tl.from(prices, { scale: 0.3, autoAlpha: 0, transformOrigin: '0% 50%', ease: 'back.out(2.6)', duration: dur, stagger: st }, pos);
    else if (effect === 'stamp') tl.from(prices, { scale: 2.4, rotation: -10, autoAlpha: 0, transformOrigin: '50% 50%', ease: 'power4.in', duration: dur * 0.7, stagger: st }, pos);
    else if (effect === 'slide') tl.from(prices, { x: 90, autoAlpha: 0, duration: dur, stagger: st }, pos);
    else if (effect === 'flip') tl.from(prices, { rotationX: -95, transformPerspective: 500, transformOrigin: '50% 0%', autoAlpha: 0, duration: dur, stagger: st }, pos);
    else if (effect === 'fade') tl.from(prices, { autoAlpha: 0, duration: dur, stagger: st }, pos);
    else if (effect === 'count') {
      tl.from(prices, { autoAlpha: 0, duration: 0.25, stagger: st }, pos);
      prices.forEach(function (p, i) {
        var num = p.querySelector('.price__num');
        if (!num) return;
        var n = Number(num.getAttribute('data-n')) || 0, o = { v: 0 };
        tl.to(o, { v: n, duration: Math.max(0.6, dur * 2), ease: 'power2.out', onUpdate: function () { num.textContent = Math.round(o.v).toLocaleString('ru-RU'); } },
          typeof pos === 'number' ? pos + i * st : pos + '+=' + (i * st));
      });
    }
  }

  function priceLoop(prices, effect, q, strong) {
    if (!prices.length || !effect || effect === 'none') return;
    var k = strong ? 1.6 : 1;
    var accent = settings().accent;
    if (effect === 'shine') {
      var shines = prices.map(function (p) { return p.querySelector('.shine'); }).filter(Boolean);
      gsap.to(shines, { xPercent: 520, duration: 1.1, ease: 'power2.inOut', repeat: -1, repeatDelay: strong ? 1.2 : 2.4, delay: 1.4, stagger: 0.25 });
    } else if (effect === 'pulse') gsap.to(prices, { scale: 1 + 0.07 * k, transformOrigin: '50% 50%', duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1, repeatDelay: 0.4, delay: 1.6 });
    else if (effect === 'glow') gsap.to(prices, { textShadow: '0 0 ' + Math.round(22 * k) + 'px ' + accent, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.4 });
    else if (effect === 'swing') gsap.to(prices, { rotation: 4 * k, transformOrigin: '50% 50%', duration: 1.4, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.6 });
    else if (effect === 'bounce') gsap.to(prices, { y: -10 * k, duration: 0.32, ease: 'power1.out', yoyo: true, repeat: -1, repeatDelay: 1.6, delay: 1.6, stagger: 0.2 });
  }

  var ACCENT_TO_LOOP = { pulse: 'pulse', glow: 'glow', shine: 'shine', bounce: 'bounce', none: 'none' };

  function newLoop(badges, anim) {
    if (anim === 'pulse') gsap.to(badges, { scale: 1.18, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.5 });
    else if (anim === 'spin') gsap.to(badges, { rotation: '+=360', duration: 1.2, ease: 'power2.inOut', repeat: -1, repeatDelay: 2.5, delay: 1.8 });
    else if (anim === 'wobble') gsap.to(badges, { rotation: 14, duration: 0.18, ease: 'sine.inOut', yoyo: true, repeat: 5, repeatDelay: 0, delay: 1.8, onComplete: function () { gsap.to(badges, { rotation: -12, duration: 0.3, delay: 0 }); } });
    else if (anim === 'bounce') gsap.to(badges, { y: -12, duration: 0.3, ease: 'power1.out', yoyo: true, repeat: -1, repeatDelay: 1.4, delay: 1.6 });
    else if (anim === 'shine') gsap.to(badges.map(function (b) { return b.querySelector('.shine'); }), { xPercent: 520, duration: 0.9, ease: 'power2.inOut', repeat: -1, repeatDelay: 1.8, delay: 1.4 });
  }

  function slideData(el) {
    var id = el.getAttribute('data-slide-id');
    for (var i = 0; i < state.slideMeta.length; i++) if (state.slideMeta[i].id === id) return state.slideMeta[i];
    return null;
  }

  function animationFor(s) {
    var a = M.clone(settings().animation || M.defaultAnimation());
    if (s && s.animation) Object.keys(s.animation).forEach(function (k) { if (s.animation[k] != null && s.animation[k] !== '') a[k] = s.animation[k]; });
    return M.normalizeAnimation(a);
  }

  function animateSlide(slideEl, force) {
    if (!slideEl || (slideEl === state.activeEl && !force)) return;
    state.activeEl = slideEl;
    if (state.slideCtx) state.slideCtx.revert();
    state.slideCtx = null;
    if (state.bgCtx) state.bgCtx.revert();
    state.bgCtx = null;
    // фон анимируется только у активного слайда — на слабом ТВ это важно
    var blobs = slideEl.querySelectorAll('.slide-bg__blob');
    if (blobs.length && !REDUCED) {
      state.bgCtx = gsap.context(function () {
        var sp = Number(blobs[0].parentNode.getAttribute('data-speed')) || 1;   // скорость изменения градиента
        gsap.to(blobs[0], { xPercent: 30, yPercent: 22, scale: 1.25, duration: 11 / sp, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        gsap.to(blobs[1], { xPercent: -26, yPercent: -18, scale: 0.85, duration: 14 / sp, ease: 'sine.inOut', yoyo: true, repeat: -1 });
      }, slideEl);
    }
    var s = slideData(slideEl);
    var a = animationFor(s);
    if (REDUCED || a.preset === 'none') return;
    var P = PRESETS[a.preset] || PRESETS.rise;
    var duration = (Number(s && s.duration) || settings().slideDuration);

    var elCfg = (s && s.elements) || {};
    state.slideCtx = gsap.context(function () {
      // Элементы со своим эффектом анимируются отдельно, остальные — общей последовательностью слайда.
      var custom = [];
      Array.prototype.forEach.call(slideEl.querySelectorAll('[data-el]'), function (el) {
        var c = elCfg[el.getAttribute('data-el')];
        if (c && c.effect) { el.setAttribute('data-custom', ''); custom.push({ el: el, c: c }); }
        else el.removeAttribute('data-custom');
      });
      var free = function (list) { return list.filter(function (n) { return !n.closest('[data-custom]'); }); };
      var q = function (sel) { return free(gsap.utils.toArray(slideEl.querySelectorAll(sel))); };
      var tl = gsap.timeline({ defaults: { duration: 0.8, ease: 'soft' }, delay: 0.2 });
      var stagger = Number(a.stagger) || 0.08;
      var seq = a.order !== 'together';
      var at = function (fallback) { return seq ? fallback : 0.1; };

      function from(targets, vars, pos) {
        if (!targets.length) return;
        var v = Object.assign({}, vars, { stagger: stagger });
        tl.from(targets, v, pos);
      }

      var title = q('.a-title')[0];
      if (title && a.title !== 'none') {
        var type = a.title === 'lines' ? 'lines' : a.title === 'words' ? 'words' : 'words,chars';
        var split = SplitText.create(title, { type: type, mask: P.mask ? (a.title === 'chars' ? 'chars' : a.title) : undefined, aria: 'auto' });
        var parts = a.title === 'lines' ? split.lines : a.title === 'words' ? split.words : split.chars;
        tl.from(parts, Object.assign({}, P.title, { stagger: P.titleStagger || (a.title === 'chars' ? 0.025 : 0.08) }), 0);
      }
      from(q('.a-kick'), P.item, 0);
      var photoDur = Number(a.photoDur) > 0 ? Number(a.photoDur) : 1.3;
      var photoIn = PHOTO_IN[a.photoIn];
      var plates = q('.a-plate, .ev__photo');
      if (plates.length && photoIn) tl.from(plates, Object.assign({ autoAlpha: 0, duration: photoDur, ease: 'soft', stagger: 0.2 }, photoIn(photoDur)), 0.05);
      tl.addLabel('items', 0.3);
      from(q('.a-card'), P.item, at('>-0.45'));
      from(q('.a-row'), P.item, at('>-0.5'));
      from(q('.a-near'), { y: 50, autoAlpha: 0 }, at('>-0.3'));

      // --- Изображения: постоянный эффект (на обёртке, чтобы не спорить с появлением)
      var loopTargets = q('.plate.a-img');
      var loop = PHOTO_LOOP[a.photoLoop];
      if (loopTargets.length && loop) loop(loopTargets, duration, photoDur);

      // --- Названия блюд
      var names = q('.a-name');
      var nameDur = Number(a.nameDur) > 0 ? Number(a.nameDur) : 0.6;
      var namePos = seq ? 'items+=0.35' : 0.3;
      if (names.length && a.name && a.name !== 'none') nameEffect(tl, names, a.name, nameDur, namePos, stagger);

      // --- Цены: появление и постоянный эффект
      var prices = q('.a-price');
      var priceDur = Number(a.priceDur) > 0 ? Number(a.priceDur) : 0.6;
      if (prices.length) {
        priceIn(tl, prices, a.priceIn, priceDur, seq ? 'items+=0.6' : 0.4, stagger);
        priceLoop(prices.filter(function (p) { return !p.closest('.is-accent'); }), a.priceLoop, q);
      }

      // --- Акцентные блюда и значок NEW
      var accentPrices = q('.is-accent .a-price');
      if (accentPrices.length) priceLoop(accentPrices, ACCENT_TO_LOOP[settings().accentAnim] || 'none', q, true);
      var badges = q('.a-new');
      if (badges.length) {
        tl.from(badges, { scale: 0, rotation: -140, duration: 0.7, ease: 'back.out(2.5)', stagger: 0.1 }, seq ? 'items+=0.9' : 0.6);
        newLoop(badges, (settings().newBadge || {}).anim);
      }

      tl.timeScale(Math.max(0.25, Number(a.speed) || 1));

      custom.forEach(function (x) {
        if (x.c.effect === 'none') return;
        var CP = PRESETS[x.c.effect] || P;
        var dur = Number(x.c.duration) > 0 ? Number(x.c.duration) : 0.9;
        var del = x.c.delay != null && x.c.delay !== '' ? Number(x.c.delay) : 0.2;
        gsap.from(x.el, Object.assign({ ease: 'soft' }, CP.item, { duration: dur, delay: del, stagger: 0 }));
      });
    }, slideEl);
  }

  /* ---------- Swiper ---------- */

  /* Настройки элементов слайда: показ и смещение относительно запрограммированной точки.
     Смещение — через CSS translate: оно складывается с transform, который анимирует GSAP. */
  function applyElements() {
    Array.prototype.forEach.call(els.slides.querySelectorAll('.swiper-slide'), function (slideEl) {
      var s = slideData(slideEl);
      var cfg = (s && s.elements) || {};
      Array.prototype.forEach.call(slideEl.querySelectorAll('[data-el]'), function (el) {
        var c = cfg[el.getAttribute('data-el')];
        if (!c) return;
        if (c.visible === false) el.style.display = 'none';
        if (Number(c.x) || Number(c.y)) el.style.translate = (Number(c.x) || 0) + 'px ' + (Number(c.y) || 0) + 'px';
        var k = Number(c.size) > 0 ? Number(c.size) / 100 : 1;
        if (k !== 1) { el.style.scale = String(k); el.style.transformOrigin = 'left top'; }
      });
    });
  }

  function setProgress(p) { gsap.set(els.progress, { scaleX: p }); }

  function buildSlider(visible, html) {
    if (state.swiper) { state.swiper.autoplay.stop(); state.swiper.destroy(true, true); state.swiper = null; }
    if (state.slideCtx) state.slideCtx.revert();
    if (state.bgCtx) state.bgCtx.revert();
    state.slideCtx = state.bgCtx = null;
    state.activeEl = null;
    state.slideMeta = visible;

    els.slides.innerHTML = html;
    applyElements();
    tickCountdowns();
    fitAll();

    var st = settings();
    var multi = visible.length > 1;
    // полоса оставшегося времени слайда: можно выключить в настройках
    els.progressWrap.style.display = st.progressEnabled === false ? 'none' : '';
    els.progressWrap.style.visibility = multi ? '' : 'hidden';
    setProgress(0);

    var tr = M.TRANSITIONS[st.transition && st.transition.effect] || M.TRANSITIONS.fade;
    var opts = M.clone(tr.opts);
    opts.speed = Number(st.transition && st.transition.speed) || 1100;
    opts.loop = multi;
    opts.allowTouchMove = false;
    opts.keyboard = { enabled: true };
    opts.autoplay = multi ? { delay: st.slideDuration * 1000, disableOnInteraction: false } : false;
    opts.on = {
      init: function (s) { animateSlide(s.slides[s.activeIndex]); },
      slideChangeTransitionStart: function (s) { animateSlide(s.slides[s.activeIndex]); },
      autoplayTimeLeft: function (s, left, pct) { setProgress(1 - pct); }
    };
    state.swiper = new Swiper(els.stage, opts);
  }

  function visibleSlides(now) {
    var all = (state.data.slides || []).filter(function (s) { return s.enabled !== false; });
    if (PREVIEW && state.preview.slideId) {
      return (state.data.slides || []).filter(function (s) { return s.id === state.preview.slideId; });
    }
    return all.filter(function (s) {
      if (s.type === 'countdown' && !M.countdownEvent(state.data.events, s, now)) return false; // нет мероприятия — не показываем
      return (PREVIEW && state.preview.ignoreSchedule) || M.isScheduled(s, now);
    });
  }

  /* Пересобираем, только если изменился итоговый HTML (данные, расписание, даты афиши). */
  function refreshSlides(force) {
    if (!state.data) return;
    var now = new Date();
    var visible = visibleSlides(now);
    if (!visible.length) {
      var cafe = state.data.cafe || {};
      visible = [{ id: 'fallback', type: 'info', title: cafe.name || 'Добро пожаловать', subtitle: cafe.tagline || '', lines: [] }];
    }
    var html = visible.map(function (s) { return renderSlide(s, now); }).join('');
    var key = html + '|' + JSON.stringify(visible.map(function (s) { return s.elements || {}; })) + JSON.stringify(settings().transition) + JSON.stringify(settings().animation) + settings().slideDuration +
      JSON.stringify(settings().header) + settings().tickerEnabled + settings().progressEnabled +
      settings().accentStyle + settings().accentAnim + JSON.stringify(settings().newBadge) + JSON.stringify(settings().colors) + JSON.stringify(settings().palette) + JSON.stringify(settings().bg); // шапка и строка меняют высоту сцены
    if (!force && key === state.renderKey) return;
    state.renderKey = key;
    buildSlider(visible, html);
  }

  /* ---------- Бегущая строка ---------- */

  function buildTicker(force) {
    var items = settings().tickerEnabled === false ? [] : ((state.data && state.data.ticker) || []);
    var key = JSON.stringify(items) + '|' + settings().tickerSpeed;
    if (!force && key === state.tickerKey) return;
    state.tickerKey = key;
    if (state.tickerTween) state.tickerTween.kill();
    state.tickerTween = null;
    gsap.set(els.tickerTrack, { xPercent: 0, x: 0 });
    els.ticker.style.display = items.length ? '' : 'none';
    if (!items.length) return;

    var group = '<div class="ticker__group">' + items.map(function (t) {
      return '<span class="ticker__item">' + esc(t) + '</span><span class="ticker__sep"></span>';
    }).join('') + '</div>';
    els.tickerTrack.innerHTML = group;
    var reps = Math.max(1, Math.ceil(W / Math.max(els.tickerTrack.firstChild.offsetWidth, 1)));
    var half = new Array(reps + 1).join(group);
    els.tickerTrack.innerHTML = half + half;
    var distance = els.tickerTrack.scrollWidth / 2;
    state.tickerTween = gsap.to(els.tickerTrack, { xPercent: -50, ease: 'none', duration: distance / settings().tickerSpeed, repeat: -1 });
  }

  /* ---------- Шапка, тема, часы ---------- */

  function applyBrand() {
    var cafe = state.data.cafe || {};
    var st = settings();
    els.name.textContent = cafe.name || '';
    els.tagline.textContent = cafe.tagline || '';
    if (cafe.logo) els.logo.src = cafe.logo;

    // Шапка: целиком или по частям. Если скрыто всё — шапка убирается, слайды занимают её высоту.
    var hd = Object.assign(M.defaultHeader(), st.header || {});
    var show = function (el, on) { el.style.display = on ? '' : 'none'; };
    show(els.name, hd.name);
    show(els.tagline, hd.tagline && !!cafe.tagline);
    show(els.logo, hd.logo && !!cafe.logo);
    show(els.brand, hd.name || (hd.tagline && !!cafe.tagline) || (hd.logo && !!cafe.logo));
    show(els.time, hd.clock);
    show(els.date, hd.date);
    show(els.clock, hd.clock || hd.date);
    show(els.topbar, hd.enabled && (els.brand.style.display !== 'none' || els.clock.style.display !== 'none'));
    document.title = (cafe.name || 'Кафе') + ' — витрина';
    document.body.className = 'theme-' + (st.theme === 'light' ? 'light' : 'dark') + ' accent-' + (M.ACCENT_STYLES[st.accentStyle] ? st.accentStyle : 'pill');
    var f = Object.assign(M.defaultFonts(), st.fonts || {});
    var root = document.documentElement.style;
    function font(key, fallback) { return M.FONTS[f[key]] || M.FONTS[fallback]; }
    root.setProperty('--heading', font('heading', 'Nunito').stack);
    root.setProperty('--heading-weight', font('heading', 'Nunito').weight);
    root.setProperty('--display', font('dish', 'Montserrat').stack);
    root.setProperty('--display-weight', f.dish === 'Montserrat' ? 500 : font('dish', 'Montserrat').weight);
    root.setProperty('--font', font('text', 'Calibri').stack);
    root.setProperty('--title-scale', Number(f.headingScale) || 1);
    root.setProperty('--dish-scale', Number(f.dishScale) || 1);
    root.setProperty('--text-scale', Number(f.textScale) || 1);
    // цвета надписей из палитры (пусто — цвет темы)
    Object.keys(M.TEXT_ROLES).forEach(function (role) {
      var c = M.resolveColor((st.colors || {})[role], st.palette);
      if (c) root.setProperty(M.TEXT_ROLES[role].css, c); else root.removeProperty(M.TEXT_ROLES[role].css);
    });
    document.documentElement.style.setProperty('--accent', st.accent);
    document.documentElement.style.setProperty('--on-accent', isLight(st.accent) ? '#151412' : '#ffffff');
  }

  var timeFmt = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
  var dateFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  function tickClock() {
    var now = new Date();
    els.time.textContent = timeFmt.format(now);
    els.date.textContent = dateFmt.format(now);
  }

  /* ---------- Данные ---------- */

  function applyData(text, save) {
    if (text === state.dataText) return;
    state.data = JSON.parse(text);
    state.dataText = text;
    if (save) { try { localStorage.setItem(CACHE_KEY, text); } catch (e) { /* нет хранилища */ } }
    applyBrand();
    refreshSlides(true);
    buildTicker(true);
  }

  function fetchText(url) {
    return fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status + ' ' + url); return r.text(); });
  }

  function fetchData() {
    var list = state.source ? [state.source] : DATA_SOURCES.slice();
    function next(i) {
      return fetchText(list[i]).then(function (text) {
        JSON.parse(text); // на хостинге без PHP api/data.php вернётся не JSON — пробуем следующий источник
        state.source = list[i];
        return text;
      }).catch(function (err) {
        if (i + 1 < list.length) return next(i + 1);
        if (state.source) { state.source = null; }
        throw err;
      });
    }
    return next(0);
  }

  function loadData() {
    return fetchData().then(function (text) {
      applyData(text, true);
      showStatus('');
    }).catch(function (err) {
      if (!state.data) {
        var fallback = window.__TORSHER_DATA__ ? JSON.stringify(window.__TORSHER_DATA__) : null;
        if (!fallback) { try { fallback = localStorage.getItem(CACHE_KEY); } catch (e) { /* нет */ } }
        if (fallback) { applyData(fallback, false); return; }
      }
      console.warn('Не удалось загрузить данные:', err);
      showStatus(state.data ? 'офлайн · показан сохранённый контент' : 'нет данных: проверьте content/data.json');
    });
  }

  /* build.json создаётся при сборке и содержит id версии. Сменилась версия — перезагружаем страницу. */
  function checkBuild() {
    return fetchText('build.json').then(function (text) {
      var v = JSON.parse(text).commit;
      if (state.build && v && v !== state.build) location.reload();
      state.build = v;
    }).catch(function () { /* нет build.json — пропускаем */ });
  }

  function checkDailyReload() {
    var at = M.minutes(settings().dailyReloadAt);
    var now = new Date();
    if (at != null && now.getHours() * 60 + now.getMinutes() === at && performance.now() > 120000) location.reload();
  }

  /* ---------- Предпросмотр из админки ---------- */

  function setupPreview() {
    window.addEventListener('message', function (e) {
      var m = e.data || {};
      if (m.type === 'torsher:data') {
        state.preview.slideId = m.slideId || null;
        state.preview.ignoreSchedule = !!m.ignoreSchedule;
        state.dataText = '';
        applyData(JSON.stringify(m.data), false);
      } else if (m.type === 'torsher:replay') {
        if (state.swiper) animateSlide(state.swiper.slides[state.swiper.activeIndex], true);
      }
    });
    if (window.parent !== window) window.parent.postMessage({ type: 'torsher:ready' }, '*');
  }

  /* ---------- Управление ---------- */

  function setupControls() {
    document.addEventListener('keydown', function (e) {
      var k = e.key.toLowerCase();
      if (k === 'f' || k === 'а') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen().catch(function () {});
      }
      if ((k === 'r' || k === 'к') && !PREVIEW) loadData();
    });
    document.addEventListener('dblclick', function () {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function () {});
    });
    var hideTimer;
    function wake() {
      document.body.classList.remove('hide-cursor');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { document.body.classList.add('hide-cursor'); }, 3000);
    }
    if (!PREVIEW) { document.addEventListener('mousemove', wake); wake(); }

    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        layoutCanvas();
        if (state.swiper) state.swiper.update();
        fitAll();
      }, 200);
    });
  }

  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var sample = 'Меню Menu 0123 ₽';
    var loads = Promise.all(['800 1em Nunito', '700 1em Comfortaa', '500 1em Montserrat', '600 1em Montserrat', '700 1em Montserrat', '400 1em Calibri', '700 1em Calibri']
      .map(function (f) { return document.fonts.load(f, sample); })).then(function () { return document.fonts.ready; });
    return Promise.race([loads, new Promise(function (r) { setTimeout(r, 3000); })]).catch(function () {});
  }

  function start() {
    layoutCanvas();
    tickClock();
    setInterval(function () { tickClock(); tickCountdowns(); }, 1000);
    setupControls();

    fontsReady().then(function () {
      if (PREVIEW) { setupPreview(); return; }
      gsap.from('.topbar', { y: -30, autoAlpha: 0, duration: 1, ease: 'soft' });
      return loadData().then(function () {
        checkBuild();
        setInterval(function () { loadData(); checkBuild(); }, settings().refreshInterval * 1000);
        setInterval(function () { refreshSlides(false); checkDailyReload(); }, 30000);
      });
    });
  }

  start();
})();
