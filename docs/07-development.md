# 7. Разработка

## Локальный запуск

```bash
python3 -m http.server 8080           # только статика: админка в локальном режиме (вход admin / pass123)
php -S 127.0.0.1:8080 -t .            # с бэкендом (нужен api/config.php)
```

Для разработки бэкенда подойдёт SQLite: в `api/config.php` укажите
`'dsn' => 'sqlite:/tmp/torsher.sqlite', 'user' => null, 'password' => null`, затем выполните
`php api/install.php admin 'пароль'`. Схема — `sql/schema.sqlite.sql`. Путь к конфигу можно
подменить переменной окружения `TORSHER_CONFIG`.

## Проверки перед коммитом

- Синтаксис: `php -l api/*.php`; для JS — `node -e "new (require('vm').Script)(require('fs').readFileSync('app.js','utf8'))"` (и так же для `admin/admin.js`, `shared/model.js`).
- `node tools/build.mjs --manifest`: обновить список файлов плеера, если добавились файлы в `vendor/`, `assets/fonts`, `assets/img`, `shared/`.
- `node tools/docs.mjs`: обновить справочник в документации, если менялись раскладки, эффекты или настройки.
- Визуальная проверка: откройте `index.html?preview=1` и пришлите данные через `postMessage`
  (так делает админка) или просто откройте админку. Раньше слайды проверялись Playwright-скриптами:
  скриншот каждого слайда 1080×1920 и проверка, что после анимации все элементы видимы.

## Как добавить…

### раскладку слайда с блюдами

1. `shared/model.js` → `LAYOUTS`: ключ, подпись, `photos`, `texts`, `view: 'comp'`. Если текстовых
   блоков несколько, добавьте ключ в `TXT_BLOCKS`. Если нужно, добавьте раскладку в план `generateSlides`.
2. `app.js` → `composition()`: HTML из `feat()`, `plate()`, `txt()`. Можно переиспользовать сетку
   готовой композиции через `base`.
3. `styles.css` → блок `/* Композиции */`: `grid-template-areas` и вылеты тарелок через переменные
   `--l --r --t --b --pos`.
4. Обновите `node tools/docs.mjs` и `docs/03-admin-guide.md`.

### эффект анимации

1. Название — в соответствующий словарь `shared/model.js` (`PHOTO_IN`, `NAME_EFFECTS`, `PRICE_LOOP`…).
2. Реализация — в `app.js`: таблицы `PHOTO_IN`/`PHOTO_LOOP` или функции `nameEffect`, `priceIn`, `priceLoop`, `newLoop`.
3. `node tools/docs.mjs`.

### тип слайда

`newSlide()` и `slideElements()` в модели, функция `renderXxx()` в `app.js` и ветка в `renderSlide()`,
редактор в `slideEditor()` админки, тип в белом списке `save_data()` в `api/lib.php`, описание в `docs/`.

## Устройство кода (коротко)

- `app.js`: `layoutCanvas` — масштаб холста; `render*` — HTML слайдов; `buildSlider` — Swiper;
  `animateSlide` — GSAP-последовательность (контекст на каждый показ); `applyElements` — показ,
  сдвиги и размеры элементов; `tickCountdowns` — счётчики; `loadData`/`checkBuild` — обновления.
- `admin/admin.js`: хелперы `h()`, `input()`, `select()`, `checkbox()`, `range()` связывают поля
  с объектом данных. `changed()` сохраняет черновик и обновляет предпросмотр. Вкладки: `render*`.
- `shared/model.js` подключается в браузере как `window.TorsherModel` и в Node через `require`.

## Демо-фото

Демо-фото блюд вырезаны из присланного примера меню (PDF) и обтравлены моделью удаления фона
(`@imgly/background-removal-node`), затем сохранены в WebP. Инструмент в проект не входит.
Перед запуском в работу замените фото своими.
