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
    'p4t4':         { label: '4 : 4 · тарелки по углам',              photos: 4, texts: 4,  view: 'comp' },
    // Только фото и фото + 1–2 позиции текстом
    'p1-center':    { label: '1 : 0 · одно блюдо, тарелка по центру', photos: 1, texts: 0,  view: 'comp' },
    'p2':           { label: '2 : 0 · два блюда по диагонали',        photos: 2, texts: 0,  view: 'comp' },
    'p3':           { label: '3 : 0 · три блюда зигзагом',            photos: 3, texts: 0,  view: 'comp' },
    'p1t1':         { label: '1 : 1 · тарелка внизу + одно текстом',  photos: 1, texts: 1,  view: 'comp' },
    'p2t1':         { label: '2 : 1 · по диагонали + одно текстом',   photos: 2, texts: 1,  view: 'comp' },
    'p3t1':         { label: '3 : 1 · зигзаг + одно текстом',        photos: 3, texts: 1,  view: 'comp' },
    'p1t2-center':  { label: '1 : 2 · тарелка по центру',             photos: 1, texts: 2,  view: 'comp' },
    'p2t2':         { label: '2 : 2 · зигзаг + два текстом',          photos: 2, texts: 2,  view: 'comp' },
    'p3t2':         { label: '3 : 2 · зигзаг + два текстом',          photos: 3, texts: 2,  view: 'comp' }
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
  /* Изображения: появление + постоянный «живой» эффект. */
  var PHOTO_IN = {
    rise: 'Всплытие снизу', slide: 'Выезд сбоку', zoom: 'Приближение', spin: 'Разворот с увеличением',
    drop: 'Падение с отскоком', roll: 'Выкатывание', flip: '3D-поворот', fade: 'Проявление', none: 'Без появления'
  };
  var PHOTO_LOOP = {
    kenburns: 'Медленный наезд (Ken Burns)', float: 'Парение', breathe: 'Дыхание (лёгкий масштаб)',
    sway: 'Покачивание', drift: 'Дрейф в сторону', none: 'Статично'
  };
  /* Название блюда. */
  var NAME_EFFECTS = {
    none: 'Вместе со строкой', chars: 'По буквам из маски', words: 'По словам', typewriter: 'Печатная машинка',
    wave: 'Волна от центра', scramble: 'Перебор символов', highlight: 'Подчёркивание акцентом', blur: 'Из размытия'
  };
  /* Цена: появление + постоянный эффект. */
  var PRICE_IN = {
    pop: 'Выпрыгивание', count: 'Счётчик от нуля', stamp: 'Штамп', slide: 'Выезд справа', flip: '3D-переворот', fade: 'Проявление', none: 'Вместе со строкой'
  };
  var PRICE_LOOP = { none: 'Без эффекта', shine: 'Блик', pulse: 'Пульс', glow: 'Свечение', swing: 'Покачивание', bounce: 'Подпрыгивание' };
  /* Акцент на блюде: оформление и анимация. */
  var ACCENT_STYLES = { pill: 'Цена на яркой плашке', band: 'Подсветка строки', glow: 'Свечение названия и цены', mark: 'Звезда и крупная цена' };
  var NEW_ANIMS = { pulse: 'Пульс', spin: 'Вращение', wobble: 'Покачивание', bounce: 'Подпрыгивание', shine: 'Блик', none: 'Без анимации' };
  var ACCENT_ANIMS = { pulse: 'Пульс', glow: 'Мерцающее свечение', shine: 'Блик', bounce: 'Подпрыгивание', none: 'Без анимации' };
  // старые названия (до расширения) — для совместимости сохранённых данных
  var PHOTO_EFFECTS = PHOTO_LOOP, PRICE_EFFECTS = PRICE_IN;
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

  /* Шрифты: все лежат локально в assets/fonts (Calibri — системный, с запасным Carlito). */
  var FONTS = {
    Nunito:     { label: 'Nunito — округлый',                   stack: '"Nunito", "Segoe UI", Arial, sans-serif',          weight: 800 },
    Comfortaa:  { label: 'Comfortaa — округлый геометрический', stack: '"Comfortaa", "Segoe UI", Arial, sans-serif',       weight: 700 },
    Montserrat: { label: 'Montserrat — строгий геометрический', stack: '"Montserrat", "Segoe UI", Arial, sans-serif',      weight: 600 },
    Calibri:    { label: 'Calibri — спокойный гротеск',         stack: '"Calibri", Carlito, "Segoe UI", Arial, sans-serif', weight: 700 }
  };
  /* Элементы слайда, которые можно настраивать по отдельности (эффект, время, показ, смещение). */
  var TXT_BLOCKS = { hero: 0, 'p1-center': 0, p2: 0, p3: 0, 'p2t4': 2, 'p2t2': 2, 'p3t6': 3 };
  /* Переименованные раскладки (старые сохранённые данные). */
  var LAYOUT_ALIASES = { 'p1t2-left': 'p1t2-center' };

  function slideElements(s) {
    var out = [];
    if (s.showTitle !== false) out.push({ key: 'head', label: 'Заголовок' });
    if (s.type === 'dishes') {
      var L = LAYOUTS[s.layout] || LAYOUTS['text-10'];
      if (L.view === 'comp') {
        for (var i = 1; i <= L.photos; i++) {
          out.push({ key: 'feat-' + i, label: 'Блюдо ' + i + ': рамка и цена' });
          out.push({ key: 'plate-' + i, label: 'Блюдо ' + i + ': фото' });
        }
        var t = TXT_BLOCKS[s.layout] != null ? TXT_BLOCKS[s.layout] : (L.texts ? 1 : 0);
        for (var j = 1; j <= t; j++) out.push({ key: 'txt-' + j, label: 'Текстовый список ' + (t > 1 ? j : '') });
      } else {
        if (L.view === 'list-feature') out.push({ key: 'feat-1', label: 'Главное блюдо в рамке' });
        out.push({ key: 'list', label: 'Список блюд' });
      }
    } else if (s.type === 'events') out.push({ key: 'events', label: 'Список событий' });
    else if (s.type === 'info') out.push({ key: 'info', label: 'Карточки информации' });
    else if (s.type === 'countdown') {
      out.push({ key: 'photo', label: 'Изображение' });
      out.push({ key: 'evname', label: 'Название мероприятия' });
      out.push({ key: 'evtime', label: 'Время начала' });
      out.push({ key: 'timer', label: 'Счётчик «до начала»' });
    }
    else if (s.type === 'announce') {
      out.push({ key: 'body', label: 'Текст объявления' });
      if (s.photo) out.push({ key: 'photo', label: 'Фото объявления' });
    }
    out.push({ key: 'near', label: 'Блок «Скоро у нас»' });
    return out;
  }
  function defaultElement() { return { visible: true, effect: '', duration: null, delay: null, x: 0, y: 0, size: 100 }; }

  function defaultPhotoPos() { return { x: 0, y: 0, scale: 1, rotate: 0, flip: false }; }
  /* Цвета надписей: роль → CSS-переменная. Значение роли — id цвета из палитры или #hex; пусто — цвет темы. */
  var TEXT_ROLES = {
    title:   { label: 'Заголовок слайда',            css: '--c-title' },
    kicker:  { label: 'Подзаголовок и разделы',       css: '--c-kicker' },
    name:    { label: 'Названия блюд',                css: '--c-name' },
    desc:    { label: 'Описания блюд',                css: '--c-desc' },
    weight:  { label: 'Вес и мелкие пометки',         css: '--c-weight' },
    price:   { label: 'Цены',                         css: '--c-price' },
    frame:   { label: 'Рамки блюд',                   css: '--c-frame' },
    evDate:  { label: 'Дата события',                 css: '--c-ev-date' },
    evTime:  { label: 'Время события',                css: '--c-ev-time' },
    evTitle: { label: 'Название события',             css: '--c-ev-title' },
    evDesc:  { label: 'Описание события',             css: '--c-ev-desc' },
    brand:   { label: 'Название в шапке',             css: '--c-brand' },
    tagline: { label: 'Подпись в шапке',              css: '--c-tagline' },
    clock:   { label: 'Часы и дата',                  css: '--c-clock' },
    ticker:  { label: 'Бегущая строка',               css: '--c-ticker' }
  };
  function defaultPalette() {
    return [
      { id: 'lime',   name: 'Лайм (акцент)',  color: '#d4df3f' },
      { id: 'white',  name: 'Белый',          color: '#ffffff' },
      { id: 'cream',  name: 'Сливочный',      color: '#f2eee7' },
      { id: 'sand',   name: 'Песочный',       color: '#c9a86a' },
      { id: 'orange', name: 'Тыквенный',      color: '#e0873a' },
      { id: 'berry',  name: 'Ягодный',        color: '#d6344c' },
      { id: 'grey',   name: 'Серый',          color: '#9a938a' },
      { id: 'coffee', name: 'Кофейный',       color: '#2a2119' }
    ];
  }
  /* id из палитры или #hex → цвет CSS; иначе пусто. */
  function resolveColor(value, palette) {
    if (!value) return '';
    if (/^#[0-9a-f]{3,8}$/i.test(value)) return value;
    var p = (palette || []).filter(function (x) { return x.id === value; })[0];
    return p ? p.color : '';
  }

  /* Шапка экрана: целиком и по частям (название, подпись, логотип, часы, дата). */
  function defaultHeader() {
    return { enabled: true, name: true, tagline: true, logo: true, clock: true, date: true };
  }
  function defaultFonts() {
    return { heading: 'Nunito', dish: 'Montserrat', text: 'Calibri', headingScale: 1, dishScale: 1, textScale: 1 };
  }
  var ANNOUNCE_STYLES = { center: 'Крупный текст по центру', 'photo-top': 'Фото сверху, текст снизу', 'photo-bg': 'Фото на весь экран, текст поверх' };
  var COUNTDOWN_MODES = { today: 'Ближайшее мероприятие сегодня', next: 'Ближайшее мероприятие (в любой день)', event: 'Выбранное мероприятие' };
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
    return {
      preset: 'rise', title: 'chars', order: 'sequence', speed: 1, stagger: 0.08,
      photoIn: 'rise', photoLoop: 'kenburns', photoDur: 1.3,
      name: 'none', nameDur: 0.6,
      priceIn: 'pop', priceLoop: 'none', priceDur: 0.6
    };
  }

  /* Приводит настройки анимации к текущему формату (старые поля photo/price → новые). */
  function normalizeAnimation(a) {
    if (!a) return a;
    var out = Object.assign(defaultAnimation(), a);
    if (a.photo && !a.photoIn && !a.photoLoop) {
      if (a.photo === 'zoom') { out.photoIn = 'zoom'; out.photoLoop = 'none'; }
      else { out.photoIn = 'rise'; out.photoLoop = PHOTO_LOOP[a.photo] ? a.photo : 'none'; }
    }
    if (a.price && !a.priceIn && !a.priceLoop) {
      if (a.price === 'shine' || a.price === 'pulse') { out.priceIn = 'pop'; out.priceLoop = a.price; }
      else out.priceIn = PRICE_IN[a.price] ? a.price : 'pop';
    }
    delete out.photo; delete out.price;
    return out;
  }

  function defaultSettings() {
    return {
      theme: 'dark',
      header: defaultHeader(),
      tickerEnabled: true,
      progressEnabled: true,
      accentStyle: 'pill',
      accentAnim: 'pulse',
      newBadge: { text: 'NEW', anim: 'pulse' },
      palette: defaultPalette(),
      colors: {},
      bgGradient: true,
      bg: { color1: 'lime', color2: 'orange', speed: 1, intensity: 1 },
      fonts: defaultFonts(),
      accent: '#d4df3f',
      slideDuration: 12,
      transition: { effect: 'fade', speed: 1100 },
      animation: defaultAnimation(),
      currency: '',
      refreshInterval: 60,
      autoRefreshMinutes: 30,
      tickerSpeed: 80,
      dailyReloadAt: '04:00'
    };
  }

  /* Заполняет слайд с блюдами подходящими блюдами: с фото — в фото-слоты, остальные — в текст. */
  function fillSlide(s, data) {
    var L = LAYOUTS[s.layout] || LAYOUTS['text-10'];
    var dishes = (data.dishes || []).filter(function (d) { return d.active !== false; });
    var photo = dishes.filter(function (d) { return !!d.photo; }).map(function (d) { return d.id; });
    var text = dishes.filter(function (d) { return !d.photo; }).map(function (d) { return d.id; });
    s.photoDishes = photo.slice(0, L.photos);
    var pool = L.photos ? text.concat(photo.slice(L.photos)) : dishes.map(function (d) { return d.id; });
    s.textDishes = pool.slice(0, L.texts);
    return s;
  }

  function newDish() {
    return { id: uid('dish'), name: 'Новое блюдо', category: '', description: '', weight: '', price: 0, oldPrice: null, tag: '', accent: false, isNew: false, photo: null, active: true };
  }

  function newEvent() {
    var d = new Date(); d.setDate(d.getDate() + 1);
    return { id: uid('ev'), title: 'Новое мероприятие', date: dateKey(d), time: '19:00', endTime: '', description: '', price: 'Вход свободный', tag: '', photo: null, highlight: false, active: true };
  }

  function newSlide(type) {
    var base = {
      id: uid('slide'), type: type, name: '', enabled: true, showTitle: true, titleAlign: 'left', bgGradient: null, duration: null, accent: null,
      schedule: { days: [], from: '', to: '', dateFrom: '', dateTo: '' },
      nearest: { enabled: false, count: 2 },
      sizes: { title: null, dish: null, text: null },
      colors: {},
      photoPos: [],
      elements: {},
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
    } else if (type === 'countdown') {
      base.name = 'Обратный отсчёт'; base.title = 'Сегодня'; base.subtitle = '';
      base.eventMode = 'today'; base.eventId = ''; base.photo = null;
      base.label = 'До начала'; base.startedText = 'Уже началось!';
    } else if (type === 'announce') {
      base.name = 'Объявление'; base.title = 'Объявление'; base.subtitle = '';
      base.text = 'Текст объявления'; base.note = ''; base.photo = null; base.variant = 'center';
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
    var start = minutes(ev.time);
    var end = minutes(ev.endTime) != null ? minutes(ev.endTime) : (start != null ? start + 180 : 24 * 60 - 1);
    if (start != null && end <= start) end += 24 * 60; // окончание после полуночи — на следующий день
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

  function eventStart(ev) {
    var d = parseDate(ev.date);
    d.setMinutes(minutes(ev.time) != null ? minutes(ev.time) : 0);
    return d;
  }

  /* Мероприятие для слайда обратного отсчёта (или null — тогда слайд не показывается). */
  function countdownEvent(events, slide, now) {
    var list = upcoming(events, now);
    if (slide.eventMode === 'event') {
      return list.filter(function (e) { return e.id === slide.eventId; })[0] || null;
    }
    if (slide.eventMode === 'next') return list[0] || null;
    var today = dateKey(now);
    return list.filter(function (e) { return e.date === today; })[0] || null;
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
      { layout: 'p1t2-bottom',  title: 'Блюдо дня',          anim: { preset: 'rise', title: 'chars', photoIn: 'drop', photoLoop: 'float', name: 'chars', priceIn: 'count', priceLoop: 'shine' }, nearest: true },
      { layout: 'text-10',      title: 'Меню', subtitle: 'Основные позиции', anim: { preset: 'rise', title: 'chars' } },
      { align: 'right', layout: 'p2t4',         title: 'Рекомендует шеф',    anim: { preset: 'slide', title: 'words', photoIn: 'slide', photoLoop: 'drift', name: 'highlight', priceIn: 'slide' } },
      { layout: 'p1t2-side',    title: 'Горячее',            anim: { preset: 'cascade', title: 'chars', photoIn: 'spin', photoLoop: 'kenburns', name: 'wave', priceIn: 'stamp', priceLoop: 'glow' } },
      { layout: 'p3t6',         title: 'Хиты кухни',         anim: { preset: 'zoom', title: 'words', photoIn: 'zoom', photoLoop: 'breathe', priceIn: 'pop', priceLoop: 'bounce' } },
      { layout: 'text-groups',  title: 'Меню дня', subtitle: 'По разделам', anim: { preset: 'slide', title: 'words' } },
      { layout: 'p1t2-top',     title: 'Сезонное',           anim: { preset: 'blur', title: 'lines', photoIn: 'roll', photoLoop: 'sway', name: 'blur', priceIn: 'flip' } },
      { align: 'right', layout: 'p2t4-bottom',  title: 'Попробуйте',         anim: { preset: 'flip', title: 'lines', photo: 'float' } },
      { layout: 'hero',         title: 'Блюдо недели',       anim: { preset: 'zoom', title: 'words', photo: 'kenburns', price: 'shine' }, nearest: true },
      { layout: 'p1t2-bottom',  title: 'С пылу с жару',      anim: { preset: 'typewriter', title: 'chars', photoIn: 'zoom', photoLoop: 'float', name: 'scramble', priceIn: 'count', priceLoop: 'pulse' } },
      { layout: 'p3t6-row',     title: 'Выбор гостей',       anim: { preset: 'rise', title: 'words', photo: 'float' } },
      { layout: 'p1t8-2col',    title: 'Кухня', subtitle: 'Всё меню на одном экране', anim: { preset: 'fade', title: 'lines', photo: 'kenburns' } },
      { align: 'right', layout: 'p1t4',         title: 'Рыба и мясо',        anim: { preset: 'slide', title: 'chars', photo: 'kenburns' } },
      { layout: 'p2t4',         title: 'К столу',            anim: { preset: 'cascade', title: 'words', photo: 'float', price: 'pop' } },
      { layout: 'p1t6',         title: 'Весь день',          anim: { preset: 'fade', title: 'words', photo: 'kenburns' }, nearest: true },
      { layout: 'text-8',       title: 'Наш выбор', subtitle: 'Готовим весь день', anim: { preset: 'typewriter', title: 'chars' } },
      { layout: 'p1t2-side',    title: 'Новинка',            anim: { preset: 'zoom', title: 'chars', photoIn: 'flip', photoLoop: 'breathe', name: 'typewriter', priceIn: 'stamp', priceLoop: 'shine' } },
      { layout: 'p4t4',         title: 'Всё самое вкусное',  anim: { preset: 'blur', title: 'words', photo: 'float' } },
      { layout: 'text-feature', title: 'Горячее',            anim: { preset: 'zoom', title: 'words', price: 'shine' } },
      { align: 'right', layout: 'p3t6',         title: 'Большой обед',       anim: { preset: 'flip', title: 'lines', photo: 'zoom' } },
      { layout: 'p1-center',    title: 'Шеф рекомендует',    anim: { preset: 'zoom', title: 'words', photoIn: 'spin', photoLoop: 'breathe', name: 'wave', priceIn: 'stamp', priceLoop: 'shine' }, nearest: true },
      { align: 'right', layout: 'p2', title: 'Выбор дня',     anim: { preset: 'slide', title: 'chars', photoIn: 'slide', photoLoop: 'float', name: 'chars', priceIn: 'count' } },
      { layout: 'p3',           title: 'Три хита',           anim: { preset: 'rise', title: 'words', photoIn: 'drop', photoLoop: 'sway', name: 'highlight', priceIn: 'pop', priceLoop: 'pulse' } },
      { layout: 'p1t1',         title: 'Горячее дня',        anim: { preset: 'cascade', title: 'chars', photoIn: 'roll', photoLoop: 'kenburns', name: 'typewriter', priceIn: 'slide' } },
      { align: 'right', layout: 'p2t1', title: 'Пара вкусов', anim: { preset: 'fade', title: 'lines', photoIn: 'zoom', photoLoop: 'drift', name: 'blur', priceIn: 'flip' } },
      { layout: 'p3t1',         title: 'На компанию',        anim: { preset: 'zoom', title: 'words', photoIn: 'rise', photoLoop: 'float', name: 'words', priceIn: 'count', priceLoop: 'bounce' } },
      { align: 'right', layout: 'p1t2-center', title: 'С огня', anim: { preset: 'slide', title: 'chars', photoIn: 'flip', photoLoop: 'breathe', name: 'scramble', priceIn: 'stamp', priceLoop: 'glow' } },
      { layout: 'p2t2',         title: 'Сытный обед',        anim: { preset: 'flip', title: 'lines', photoIn: 'spin', photoLoop: 'sway', name: 'chars', priceIn: 'pop', priceLoop: 'swing' } },
      { layout: 'p3t2',         title: 'Всё к столу',        anim: { preset: 'blur', title: 'words', photoIn: 'drop', photoLoop: 'float', name: 'wave', priceIn: 'count', priceLoop: 'shine' } }
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
      s.animation = normalizeAnimation(p.anim);
      if (p.nearest) s.nearest = { enabled: true, count: 2 };
      if (p.align) s.titleAlign = p.align;
      slides.push(s);
    });

    var week = newSlide('events');
    week.animation = Object.assign(defaultAnimation(), { preset: 'rise', title: 'words' });
    slides.push(week);

    var weekCards = newSlide('events');
    weekCards.name = 'Афиша на неделю · карточки'; weekCards.title = 'На этой неделе'; weekCards.style = 'cards'; weekCards.max = 5;
    weekCards.animation = normalizeAnimation({ preset: 'zoom', title: 'chars', photo: 'kenburns' });
    slides.push(weekCards);

    var cd = newSlide('countdown');
    cd.animation = normalizeAnimation({ preset: 'zoom', title: 'words', photoIn: 'zoom', photoLoop: 'kenburns' });
    slides.push(cd);

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
    LAYOUTS: LAYOUTS, LAYOUT_ALIASES: LAYOUT_ALIASES, TITLE_ALIGNS: TITLE_ALIGNS, ANIMATION_PRESETS: ANIMATION_PRESETS, TITLE_EFFECTS: TITLE_EFFECTS,
    PHOTO_EFFECTS: PHOTO_EFFECTS, PRICE_EFFECTS: PRICE_EFFECTS, ORDERS: ORDERS,
    PHOTO_IN: PHOTO_IN, PHOTO_LOOP: PHOTO_LOOP, NAME_EFFECTS: NAME_EFFECTS, PRICE_IN: PRICE_IN, PRICE_LOOP: PRICE_LOOP,
    ACCENT_STYLES: ACCENT_STYLES, ACCENT_ANIMS: ACCENT_ANIMS, NEW_ANIMS: NEW_ANIMS, normalizeAnimation: normalizeAnimation,
    TRANSITIONS: TRANSITIONS, THEMES: THEMES, ANNOUNCE_STYLES: ANNOUNCE_STYLES, FONTS: FONTS, defaultFonts: defaultFonts, TEXT_ROLES: TEXT_ROLES, defaultPalette: defaultPalette, resolveColor: resolveColor, defaultHeader: defaultHeader, defaultPhotoPos: defaultPhotoPos, fillSlide: fillSlide, slideElements: slideElements, defaultElement: defaultElement, EVENT_STYLES: EVENT_STYLES,
    uid: uid, clone: clone, defaultAnimation: defaultAnimation, defaultSettings: defaultSettings,
    newDish: newDish, newEvent: newEvent, newSlide: newSlide, generateSlides: generateSlides,
    dateKey: dateKey, parseDate: parseDate, addDays: addDays, minutes: minutes,
    isScheduled: isScheduled, upcoming: upcoming, eventsForSlide: eventsForSlide,
    nearestEvents: nearestEvents, countdownEvent: countdownEvent, eventStart: eventStart, COUNTDOWN_MODES: COUNTDOWN_MODES, formatEventDate: formatEventDate
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TorsherModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
