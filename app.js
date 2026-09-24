/*
 * Плеер рекламной витрины (вертикальный FullHD 1080×1920).
 * Swiper 14 переключает слайды, GSAP 3.15 анимирует содержимое активного слайда и бегущую строку.
 * Данные: content/data.json (или window.__TORSHER_DATA__ из content/data.js при запуске с диска).
 * В режиме ?preview=1 данные приходят из админки через postMessage.
 */
(function () {
  'use strict';

  var M = window.TorsherModel;
  gsap.registerPlugin(SplitText, CustomEase);
  CustomEase.create('soft', 'M0,0 C0.16,0.84 0.3,1 1,1');

  var W = 1080, H = 1920;
  var params = new URLSearchParams(location.search);
  var PREVIEW = params.get('preview') === '1';
  var DATA_URL = params.get('src') || 'content/data.json';
  var CACHE_KEY = 'torsher-display-data';
  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    canvas: $('canvas'), logo: $('logo'), name: $('cafeName'), tagline: $('cafeTagline'),
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
      ? esc(price.toLocaleString('ru-RU')) + (cur ? '<span class="price__cur">' + esc(cur) + '</span>' : '')
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
    return '<header class="s-head s-head--' + (s.titleAlign || 'left') + '">' +
      (s.subtitle ? '<div class="s-kicker a-kick">' + esc(s.subtitle) + '</div>' : '') +
      '<h1 class="s-title a-title">' + esc(s.title || '') + '</h1>' +
    '</header>';
  }

  function row(d) {
    return '<div class="row a-row">' +
      '<div class="row__line"><span class="row__name">' + esc(d.name) + chip(d.tag) + '</span>' +
      '<span class="row__dots"></span><span class="row__price price a-price">' + priceHTML(d.price, null, d.oldPrice) + '</span></div>' +
      (d.description ? '<div class="row__desc">' + esc(d.description) + '</div>' : '') +
      (d.weight ? '<div class="row__w">(' + esc(d.weight) + ')</div>' : '') +
    '</div>';
  }

  function list(ids, size) {
    var items = ids.map(dishById).filter(Boolean);
    if (!items.length) return '';
    return '<div class="list list--' + size + (size === 'sm' || size === '2col' ? '' : ' grow') + '">' + items.map(row).join('') + '</div>';
  }

  /* Главное блюдо: рамка с «перекрестьем» по углам, крупная цена под рамкой — как в печатном меню. */
  function frame(d, extra) {
    return '<div class="feat' + (extra || '') + ' a-card">' +
      '<div class="frame"><div class="frame__name">' + esc(d.name) + chip(d.tag) + '</div>' +
        (d.description ? '<div class="frame__desc">' + esc(d.description) + '</div>' : '') + '</div>' +
      '<div class="feat__price price a-price shine-host">' + priceHTML(d.price, d.weight, d.oldPrice) + '<span class="shine"></span></div>' +
    '</div>';
  }

  function nearBlock(s, now) {
    if (!s.nearest || !s.nearest.enabled) return '';
    var evs = M.nearestEvents(state.data.events, now, s.nearest.count);
    if (!evs.length) return '';
    return '<div class="near a-near"><div class="near__label">Скоро у нас</div>' + evs.map(function (e) {
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
    return '<div class="groups grow">' + groups.map(function (g) {
      return '<section class="group"><div class="group__head a-row">' + esc(g) + '</div>' +
        '<div class="list list--sm">' + byName[g].map(row).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  /* Обтравленная тарелка в своей области сетки; вылет за край задаётся в CSS. */
  function plate(d, n) {
    return '<div class="plate plate--' + n + ' a-img"><img class="plate__img a-plate" src="' + esc(d.photo) + '" alt=""></div>';
  }
  function feat(d, n, small) {
    return frame(d, ' feat--' + n + (small ? ' feat--sm' : ''));
  }
  function txt(ids, n, size) {
    var l = list(ids, size || 'sm');
    return l ? '<div class="txt txt--' + n + '">' + l + '</div>' : '';
  }

  /* Композиции «фото : текст» по мотивам печатного меню. */
  function composition(layout, photos, texts) {
    var p = photos, t = texts, out = '';
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
    }
    return '<div class="comp comp--' + layout + ' comp--n' + p.length + '">' + out + '</div>';
  }

  function renderDishes(s, now) {
    var L = M.LAYOUTS[s.layout] || M.LAYOUTS['text-10'];
    var photos = (s.photoDishes || []).map(dishById).filter(function (d) { return d && d.photo; }).slice(0, L.photos);
    var texts = (s.textDishes || []).filter(Boolean).slice(0, L.texts);
    var near = nearBlock(s, now);
    var view = L.view;
    var fit = function (body, extra) { return '<div class="slide__fit' + (extra || '') + '">' + head(s) + body + near + '</div>'; };

    if (view === 'comp') {
      if (photos.length === L.photos) {
        return { cls: 'comp-slide', html: fit(composition(s.layout, photos, texts), ' slide__fit--comp') };
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
      html = '<div class="events grow events--' + style + (evs.length > 5 ? ' events--dense' : '') + '">' + evs.map(function (e) {
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
      '<div class="info-grid grow">' + (s.lines || []).map(function (l) {
        return '<div class="info-card a-row"><div class="info-card__label">' + esc(l.label) + '</div><div class="info-card__value">' + esc(l.value) + '</div></div>';
      }).join('') + '</div>' + nearBlock(s, now) + '</div>' };
  }

  function renderSlide(s, now) {
    var r = s.type === 'events' ? renderEvents(s, now) : s.type === 'info' ? renderInfo(s, now) : renderDishes(s, now);
    var dur = Math.round((Number(s.duration) || settings().slideDuration) * 1000);
    var style = s.accent ? ' style="--accent-local:' + esc(s.accent) + '"' : '';
    return '<div class="swiper-slide" data-swiper-autoplay="' + dur + '" data-slide-id="' + esc(s.id) + '">' +
      '<div class="slide slide--' + r.cls + '"' + style + '>' + r.html + '</div></div>';
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

  function slideData(el) {
    var id = el.getAttribute('data-slide-id');
    for (var i = 0; i < state.slideMeta.length; i++) if (state.slideMeta[i].id === id) return state.slideMeta[i];
    return null;
  }

  function animationFor(s) {
    var a = M.clone(settings().animation || M.defaultAnimation());
    if (s && s.animation) Object.keys(s.animation).forEach(function (k) { if (s.animation[k] != null && s.animation[k] !== '') a[k] = s.animation[k]; });
    return a;
  }

  function animateSlide(slideEl, force) {
    if (!slideEl || (slideEl === state.activeEl && !force)) return;
    state.activeEl = slideEl;
    if (state.slideCtx) state.slideCtx.revert();
    state.slideCtx = null;
    var s = slideData(slideEl);
    var a = animationFor(s);
    if (REDUCED || a.preset === 'none') return;
    var P = PRESETS[a.preset] || PRESETS.rise;
    var duration = (Number(s && s.duration) || settings().slideDuration);

    state.slideCtx = gsap.context(function () {
      var q = gsap.utils.selector(slideEl);
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
      var plates = q('.a-plate');
      if (plates.length) tl.from(plates, { autoAlpha: 0, scale: 0.8, rotation: -12, duration: 1.3, ease: 'soft', stagger: 0.2 }, 0.05);
      from(q('.a-card'), P.item, at('>-0.45'));
      from(q('.a-row'), P.item, at('>-0.5'));
      from(q('.a-near'), { y: 50, autoAlpha: 0 }, at('>-0.3'));

      var imgs = q('.a-img');
      if (imgs.length) {
        if (a.photo === 'kenburns') gsap.fromTo(imgs, { scale: 1.16 }, { scale: 1, duration: duration + 2, ease: 'none' });
        else if (a.photo === 'zoom') tl.from(imgs, { scale: 1.4, duration: 1.6, ease: 'power3.out', stagger: stagger }, 0);
        else if (a.photo === 'float') gsap.to(imgs, { y: -16, scale: 1.03, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1, stagger: 0.4 });
      }

      var prices = q('.a-price');
      if (prices.length) {
        if (a.price === 'pop') tl.from(prices, { scale: 0.3, autoAlpha: 0, transformOrigin: '0% 50%', ease: 'back.out(2.6)', duration: 0.6, stagger: stagger / 2 }, seq ? '>-0.3' : 0.4);
        else if (a.price === 'pulse') gsap.to(prices, { scale: 1.07, transformOrigin: '0% 50%', duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1, repeatDelay: 0.6, delay: 1.5 });
        else if (a.price === 'shine') gsap.to(q('.shine'), { xPercent: 520, duration: 1.1, ease: 'power2.inOut', repeat: -1, repeatDelay: 2.2, delay: 1.2, stagger: 0.25 });
      }

      tl.timeScale(Math.max(0.25, Number(a.speed) || 1));
    }, slideEl);
  }

  /* ---------- Swiper ---------- */

  function setProgress(p) { gsap.set(els.progress, { scaleX: p }); }

  function buildSlider(visible, html) {
    if (state.swiper) { state.swiper.autoplay.stop(); state.swiper.destroy(true, true); state.swiper = null; }
    if (state.slideCtx) state.slideCtx.revert();
    state.slideCtx = null;
    state.activeEl = null;
    state.slideMeta = visible;

    els.slides.innerHTML = html;
    fitAll();

    var st = settings();
    var multi = visible.length > 1;
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
    return all.filter(function (s) { return (PREVIEW && state.preview.ignoreSchedule) || M.isScheduled(s, now); });
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
    var key = html + '|' + JSON.stringify(settings().transition) + JSON.stringify(settings().animation) + settings().slideDuration;
    if (!force && key === state.renderKey) return;
    state.renderKey = key;
    buildSlider(visible, html);
  }

  /* ---------- Бегущая строка ---------- */

  function buildTicker(force) {
    var items = (state.data && state.data.ticker) || [];
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
    els.logo.hidden = !cafe.logo;
    if (cafe.logo) els.logo.src = cafe.logo;
    document.title = (cafe.name || 'Кафе') + ' — витрина';
    document.body.className = 'theme-' + (st.theme === 'light' ? 'light' : 'dark');
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

  function loadData() {
    return fetchText(DATA_URL).then(function (text) {
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
    var loads = Promise.all(['600 1em Oswald', '500 1em Oswald', '400 1em Manrope', '500 1em Manrope', '700 1em Manrope']
      .map(function (f) { return document.fonts.load(f, sample); })).then(function () { return document.fonts.ready; });
    return Promise.race([loads, new Promise(function (r) { setTimeout(r, 3000); })]).catch(function () {});
  }

  function start() {
    layoutCanvas();
    tickClock();
    setInterval(tickClock, 1000);
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
