/*
 * Общая модель данных витрины: используется плеером (index.html), админкой (admin/) и tools/build.mjs.
 * Без зависимостей, подключается обычным <script> или через require() в Node.
 */
(function (root) {
  'use strict';

  /* Раскладки слайдов с блюдами: сколько позиций с фото и сколько текстом. */
  var LAYOUTS = {
    // Только текст
    'text-10':      { label: 'Текст · 8–10 позиций списком',          photos: 0, texts: 10, view: 'list' },
    'text-8':       { label: 'Текст · 6–8 позиций крупно',            photos: 0, texts: 8,  view: 'list-lg' },
    'text-2col':    { label: 'Текст · 10 позиций в две колонки',      photos: 0, texts: 10, view: 'list-2col' },
    'text-groups':  { label: 'Текст · 8–10 позиций по категориям',    photos: 0, texts: 10, view: 'list-groups' },
    'text-feature': { label: 'Текст · главное блюдо в рамке + 8',     photos: 0, texts: 9,  view: 'list-feature' },
    // Фото (обтравленные) раскиданы по слайду, соотношение фото : текст
    'hero':         { label: '1 : 0 · одно блюдо крупно',             photos: 1, texts: 0,  view: 'comp' },
    'p1t2-bottom':  { label: '1 : 2 · тарелка внизу в край',          photos: 1, texts: 2,  view: 'comp' },
    'p1t2-side':    { label: '1 : 2 · тарелка справа в край',         photos: 1, texts: 2,  view: 'comp' },
    'p1t2-top':     { label: '1 : 2 · тарелка сверху, афишный',       photos: 1, texts: 2,  view: 'comp' },
    'p1t4':         { label: '1 : 4 · тарелка слева в край',          photos: 1, texts: 4,  view: 'comp' },
    'p1t6':         { label: '1 : 6 · тарелка справа, список слева',  photos: 1, texts: 6,  view: 'comp' },
    'p2t4':         { label: '2 : 4 · зигзаг',                        photos: 2, texts: 4,  view: 'comp' },
    'p2t4-bottom':  { label: '2 : 4 · по диагонали',                  photos: 2, texts: 4,  view: 'comp' },
    'p1t8-2col':    { label: '1 : 8 · две колонки текста + тарелка',  photos: 1, texts: 8,  view: 'comp' },
    'p3t6':         { label: '3 : 6 · зигзаг',                        photos: 3, texts: 6,  view: 'comp' },
    'p3t6-row':     { label: '3 : 6 · три тарелки внизу',             photos: 3, texts: 6,  view: 'comp' },
    'p4t4':         { label: '4 : 4 · тарелки по углам',              photos: 4, texts: 4,  view: 'comp' }
  };



  /* Появление информации на слайде (GSAP). */
  var ANIMATION_PRESETS = {
    rise:       'Подъём снизу из маски',
    fade:       'Мягкое проявление',
    slide:      'Выезд справа',
    zoom:       'Масштаб с пружиной',
    flip:       '3D-переворот строк',
    blur:       'Фокусировка из размытия',
    typewriter: 'Печатная машинка',
    cascade:    'Каскад слева/справа',
    none:       'Без анимации'
  };
  var TITLE_ALIGNS = { left: 'Слева', right: 'Справа', center: 'По центру' };
  var TITLE_EFFECTS = { chars: 'По буквам', words: 'По словам', lines: 'По строкам', none: 'Без эффекта' };
  var PHOTO_EFFECTS = { kenburns: 'Медленный наезд (Ken Burns)', float: 'Парение', zoom: 'Приближение при появлении', none: 'Статично' };
  var PRICE_EFFECTS = { pop: 'Выпрыгивание', shine: 'Блик', pulse: 'Пульс', none: 'Без эффекта' };
  var ORDERS = { sequence: 'По очереди: заголовок → фото → список', together: 'Всё вместе' };

  /* Переключение между слайдами (Swiper 14). */
  var TRANSITIONS = {
    fade:        { label: 'Перекрёстное затухание', opts: { effect: 'fade', fadeEffect: { mode: 'cross-fade' } } },
    'fade-out-in': { label: 'Затухание через фон', opts: { effect: 'fade', fadeEffect: { mode: 'out-in' } } },
    'slide-up':  { label: 'Лента вверх', opts: { effect: 'slide', direction: 'vertical' } },
    'slide-left': { label: 'Лента влево', opts: { effect: 'slide', direction: 'horizontal' } },
    zoom:        { label: 'Наплыв (zoom)', opts: { effect: 'creative', creativeEffect: {
      prev: { scale: 0.85, opacity: 0 }, next: { scale: 1.15, opacity: 0 } } } },
    push:        { label: 'Выталкивание в глубину', opts: { effect: 'creative', creativeEffect: {
      prev: { translate: [0, '-20%', -500], opacity: 0 }, next: { translate: [0, '100%', 0] } } } },
    parallax:    { label: 'Параллакс вверх', opts: { effect: 'creative', creativeEffect: {
      prev: { translate: [0, '-35%', -1], opacity: 0.2 }, next: { translate: [0, '100%', 0] } } } },
    rotate:      { label: 'Поворот карточки', opts: { effect: 'creative', creativeEffect: {
      prev: { translate: ['-120%', 0, -300], rotate: [0, 0, -12], opacity: 0 }, next: { translate: ['120%', 0, -300], rotate: [0, 0, 12], opacity: 0 } } } },
    cube:        { label: 'Куб', opts: { effect: 'cube', cubeEffect: { shadow: false, slideShadows: false } } },
    flip:        { label: 'Переворот', opts: { effect: 'flip', flipEffect: { slideShadows: false } } },
    cards:       { label: 'Колода карт', opts: { effect: 'cards', cardsEffect: { slideShadows: false, rotate: true } } }
  };

  var THEMES = { dark: 'Тёмная (как в печатном меню)', light: 'Светлая (крафт)' };
  var EVENT_STYLES = { list: 'Список с датами', cards: 'Карточки', timeline: 'Таймлайн' };

  var WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  function uid(prefix) {
    return (prefix || 'id') + '-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function defaultAnimation() {
    return { preset: 'rise', title: 'chars', photo: 'kenburns', price: 'pop', order: 'sequence', speed: 1, stagger: 0.08 };
  }

  function defaultSettings() {
    return {
      theme: 'dark',
      accent: '#d4df3f',
      slideDuration: 12,
      transition: { effect: 'fade', speed: 1100 },
      animation: defaultAnimation(),
      currency: '',
      refreshInterval: 60,
      tickerSpeed: 80,
      dailyReloadAt: '04:00'
    };
  }

  function newDish() {
    return { id: uid('dish'), name: 'Новое блюдо', category: '', description: '', weight: '', price: 0, oldPrice: null, tag: '', photo: null, active: true };
  }

  function newEvent() {
    var d = new Date(); d.setDate(d.getDate() + 1);
    return { id: uid('ev'), title: 'Новое мероприятие', date: dateKey(d), time: '19:00', endTime: '', description: '', price: 'Вход свободный', tag: '', photo: null, highlight: false, active: true };
  }

  function newSlide(type) {
    var base = {
      id: uid('slide'), type: type, name: '', enabled: true, showTitle: true, titleAlign: 'left', duration: null, accent: null,
      schedule: { days: [], from: '', to: '', dateFrom: '', dateTo: '' },
      nearest: { enabled: false, count: 2 },
      animation: null
    };
    if (type === 'dishes') {
      base.name = 'Меню'; base.title = 'Меню'; base.subtitle = ''; base.layout = 'text-10';
      base.photoDishes = []; base.textDishes = [];
    } else if (type === 'events') {
      base.name = 'Афиша на неделю'; base.title = 'Афиша недели'; base.subtitle = '';
      base.range = 'week'; base.start = 'today'; base.max = 7; base.style = 'list';
      base.show = { photo: true, description: true, price: true, tag: true };
      base.emptyText = 'Скоро анонсируем новые события';
    } else if (type === 'info') {
      base.name = 'Информация'; base.title = 'Мы рядом'; base.subtitle = '';
      base.lines = [{ label: 'Часы работы', value: 'Ежедневно 8:00–22:00' }];
    }
    return base;
  }

  /* ---------- Даты и расписание ---------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(key) { var p = String(key).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function minutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }
  function addDays(d, n) { var r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; }

  /* Показывать ли слайд сейчас: дни недели (1 = пн … 7 = вс), интервал времени, диапазон дат. */
  function isScheduled(slide, now) {
    var sc = slide.schedule;
    if (!sc) return true;
    var day = now.getDay() || 7;
    if (sc.days && sc.days.length && sc.days.indexOf(day) === -1) return false;
    var today = dateKey(now);
    if (sc.dateFrom && today < sc.dateFrom) return false;
    if (sc.dateTo && today > sc.dateTo) return false;
    var from = minutes(sc.from), to = minutes(sc.to);
    var cur = now.getHours() * 60 + now.getMinutes();
    if (from != null && to != null) return from <= to ? (cur >= from && cur < to) : (cur >= from || cur < to);
    if (from != null) return cur >= from;
    if (to != null) return cur < to;
    return true;
  }

  function eventEnd(ev) {
    var d = parseDate(ev.date);
    var end = minutes(ev.endTime) != null ? minutes(ev.endTime) : (minutes(ev.time) != null ? minutes(ev.time) + 180 : 24 * 60 - 1);
    d.setMinutes(end);
    return d;
  }

  function upcoming(events, now) {
    return (events || []).filter(function (e) { return e.active !== false && e.date && eventEnd(e) > now; })
      .sort(function (a, b) { return (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')); });
  }

  /* События для слайда-афиши: неделя или две недели от сегодня / от понедельника, не больше max (≤ 7). */
  function eventsForSlide(events, slide, now) {
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (slide.start === 'monday') start = addDays(start, -((start.getDay() || 7) - 1));
    var days = slide.range === '2weeks' ? 14 : 7;
    var endKey = dateKey(addDays(start, days));
    var startKey = dateKey(start);
    var max = Math.max(1, Math.min(7, Number(slide.max) || 7));
    return upcoming(events, now).filter(function (e) { return e.date >= startKey && e.date < endKey; }).slice(0, max);
  }

  function nearestEvents(events, now, count) {
    return upcoming(events, now).slice(0, Math.max(1, Math.min(3, Number(count) || 1)));
  }

  function formatEventDate(ev, now) {
    var d = parseDate(ev.date);
    var today = dateKey(now), tomorrow = dateKey(addDays(now, 1));
    var rel = ev.date === today ? 'сегодня' : ev.date === tomorrow ? 'завтра' : WEEKDAYS[d.getDay()];
    return {
      day: d.getDate(),
      month: MONTHS_GEN[d.getMonth()],
      weekday: WEEKDAYS_SHORT[d.getDay()],
      relative: rel,
      time: ev.time ? ev.time + (ev.endTime ? '–' + ev.endTime : '') : ''
    };
  }

  /* ---------- Генератор комбинаций слайдов ---------- */

  function takeRound(list, n, offset) {
    var out = [];
    if (!list.length) return out;
    for (var i = 0; i < Math.min(n, list.length); i++) out.push(list[(offset + i) % list.length]);
    return out;
  }

  /*
   * Генерирует набор слайдов по ассортименту: от чисто текстовых (8–10 позиций)
   * до 3–4 фото + 3–4 текстом, плюс афиши на неделю и две недели.
   * Каждому слайду назначается своя настройка появления, чтобы показать варианты.
   */
  function generateSlides(data) {
    var dishes = (data.dishes || []).filter(function (d) { return d.active !== false; });
    dishes.sort(function (x, y) { return String(x.category || '').localeCompare(String(y.category || ''), 'ru'); });
    var withPhoto = dishes.filter(function (d) { return !!d.photo; }).map(function (d) { return d.id; });
    var textOnly = dishes.filter(function (d) { return !d.photo; }).map(function (d) { return d.id; });
    var all = dishes.map(function (d) { return d.id; });

    var plan = [
      { layout: 'p1t2-bottom',  title: 'Блюдо дня',          anim: { preset: 'rise', title: 'chars', photo: 'float', price: 'pop' }, nearest: true },
      { layout: 'text-10',      title: 'Меню', subtitle: 'Основные позиции', anim: { preset: 'rise', title: 'chars' } },
      { align: 'right', layout: 'p2t4',         title: 'Рекомендует шеф',    anim: { preset: 'slide', title: 'words', photo: 'zoom' } },
      { layout: 'p1t2-side',    title: 'Горячее',            anim: { preset: 'cascade', title: 'chars', photo: 'kenburns', price: 'shine' } },
      { layout: 'p3t6',         title: 'Хиты кухни',         anim: { preset: 'zoom', title: 'words', photo: 'float' } },
      { layout: 'text-groups',  title: 'Меню дня', subtitle: 'По разделам', anim: { preset: 'slide', title: 'words' } },
      { layout: 'p1t2-top',     title: 'Сезонное',           anim: { preset: 'blur', title: 'lines', photo: 'zoom' } },
      { align: 'right', layout: 'p2t4-bottom',  title: 'Попробуйте',         anim: { preset: 'flip', title: 'lines', photo: 'float' } },
      { layout: 'hero',         title: 'Блюдо недели',       anim: { preset: 'zoom', title: 'words', photo: 'kenburns', price: 'shine' }, nearest: true },
      { layout: 'p1t2-bottom',  title: 'С пылу с жару',      anim: { preset: 'typewriter', title: 'chars', photo: 'zoom', price: 'pulse' } },
      { layout: 'p3t6-row',     title: 'Выбор гостей',       anim: { preset: 'rise', title: 'words', photo: 'float' } },
      { layout: 'p1t8-2col',    title: 'Кухня', subtitle: 'Всё меню на одном экране', anim: { preset: 'fade', title: 'lines', photo: 'kenburns' } },
      { align: 'right', layout: 'p1t4',         title: 'Рыба и мясо',        anim: { preset: 'slide', title: 'chars', photo: 'kenburns' } },
      { layout: 'p2t4',         title: 'К столу',            anim: { preset: 'cascade', title: 'words', photo: 'float', price: 'pop' } },
      { layout: 'p1t6',         title: 'Весь день',          anim: { preset: 'fade', title: 'words', photo: 'kenburns' }, nearest: true },
      { layout: 'text-8',       title: 'Наш выбор', subtitle: 'Готовим весь день', anim: { preset: 'typewriter', title: 'chars' } },
      { layout: 'p1t2-side',    title: 'Новинка',            anim: { preset: 'zoom', title: 'chars', photo: 'zoom', price: 'shine' } },
      { layout: 'p4t4',         title: 'Всё самое вкусное',  anim: { preset: 'blur', title: 'words', photo: 'float' } },
      { layout: 'text-feature', title: 'Горячее',            anim: { preset: 'zoom', title: 'words', price: 'shine' } },
      { align: 'right', layout: 'p3t6',         title: 'Большой обед',       anim: { preset: 'flip', title: 'lines', photo: 'zoom' } }
    ];



    var slides = [];
    var pOff = 0, tOff = 0;
    plan.forEach(function (p) {
      var L = LAYOUTS[p.layout];
      if (L.photos && !withPhoto.length) return;
      var s = newSlide('dishes');
      s.name = L.label; s.title = p.title; s.subtitle = p.subtitle || ''; s.layout = p.layout;
      s.photoDishes = takeRound(withPhoto, L.photos, pOff); pOff += L.photos;
      var pool = !L.photos ? all : textOnly.length >= L.texts ? textOnly : all.filter(function (id) { return s.photoDishes.indexOf(id) === -1; });
      s.textDishes = takeRound(pool, L.texts, tOff); tOff += L.texts;
      var a = defaultAnimation();
      Object.keys(p.anim).forEach(function (k) { a[k] = p.anim[k]; });
      s.animation = a;
      if (p.nearest) s.nearest = { enabled: true, count: 2 };
      if (p.align) s.titleAlign = p.align;
      slides.push(s);
    });

    var week = newSlide('events');
    week.animation = Object.assign(defaultAnimation(), { preset: 'rise', title: 'words' });
    slides.push(week);

    var weekCards = newSlide('events');
    weekCards.name = 'Афиша на неделю · карточки'; weekCards.title = 'На этой неделе'; weekCards.style = 'cards'; weekCards.max = 5;
    weekCards.animation = Object.assign(defaultAnimation(), { preset: 'zoom', title: 'chars', photo: 'kenburns' });
    slides.push(weekCards);

    var two = newSlide('events');
    two.name = 'Афиша на две недели'; two.title = 'Афиша'; two.subtitle = 'Ближайшие две недели';
    two.range = '2weeks'; two.style = 'timeline';
    two.animation = Object.assign(defaultAnimation(), { preset: 'cascade', title: 'chars' });
    slides.push(two);

    var twoList = newSlide('events');
    twoList.name = 'Афиша на две недели · список'; twoList.title = 'Скоро'; twoList.subtitle = 'Две недели событий';
    twoList.range = '2weeks'; twoList.start = 'monday'; twoList.style = 'list';
    twoList.show = { photo: false, description: true, price: true, tag: true };
    twoList.animation = Object.assign(defaultAnimation(), { preset: 'flip', title: 'lines' });
    slides.push(twoList);

    return slides;
  }

  var api = {
    LAYOUTS: LAYOUTS, TITLE_ALIGNS: TITLE_ALIGNS, ANIMATION_PRESETS: ANIMATION_PRESETS, TITLE_EFFECTS: TITLE_EFFECTS,
    PHOTO_EFFECTS: PHOTO_EFFECTS, PRICE_EFFECTS: PRICE_EFFECTS, ORDERS: ORDERS,
    TRANSITIONS: TRANSITIONS, THEMES: THEMES, EVENT_STYLES: EVENT_STYLES,
    uid: uid, clone: clone, defaultAnimation: defaultAnimation, defaultSettings: defaultSettings,
    newDish: newDish, newEvent: newEvent, newSlide: newSlide, generateSlides: generateSlides,
    dateKey: dateKey, parseDate: parseDate, addDays: addDays, minutes: minutes,
    isScheduled: isScheduled, upcoming: upcoming, eventsForSlide: eventsForSlide,
    nearestEvents: nearestEvents, formatEventDate: formatEventDate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TorsherModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
