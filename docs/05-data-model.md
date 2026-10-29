# 5. Данные: `data.json`, MySQL, API

## Формат `content/data.json`

Единый документ, который читает экран. Админка редактирует именно его, а сервер хранит его
по таблицам.

```jsonc
{
  "version": 2,
  "revision": 12,                  // только от сервера: номер публикации
  "cafe": { "name": "Торшер", "tagline": "кафе · кухня весь день", "logo": "assets/img/logo.svg" },
  "settings": { /* см. «Настройки по умолчанию» в 04-layouts-and-animation.md */ },
  "ticker": ["Строка 1", "Строка 2"],
  "dishes": [
    { "id": "dish-01", "name": "Омлет с креветками", "category": "Завтраки", "description": "…",
      "weight": "250 г", "price": 540, "oldPrice": null, "tag": "хит",
      "accent": false, "isNew": false, "photo": "assets/dishes/omelette.webp", "active": true }
  ],
  "events": [
    { "id": "ev-01", "title": "Джазовый вечер", "date": "2026-09-25", "time": "19:30", "endTime": "22:00",
      "description": "…", "price": "500 ₽", "tag": "Музыка", "photo": null, "highlight": true, "active": true }
  ],
  "slides": [ /* см. ниже */ ],
  "displays": [ /* см. ниже */ ]
}
```

- `price` — число (форматируется, `settings.currency` добавляется после него) или строка («220 / 260»).
- `photo` — относительный путь (`assets/…`, `uploads/…`, `media/…`), `https://…` или `data:`.
- Время мероприятия задаётся в формате `HH:MM`. Если `endTime` меньше `time`, окончание переносится
  на следующий день. Без `endTime` мероприятие считается идущим 3 часа.

### Слайд

Общие поля:

| Поле | Значение |
|---|---|
| `id`, `type`, `name`, `enabled` | Идентификатор; тип `dishes`, `events`, `info`, `announce` или `countdown`; название в списке; показ |
| `title`, `subtitle`, `showTitle`, `titleAlign` | Заголовок, надстрочник, показ заголовка, выравнивание |
| `duration` | Длительность показа, с (пусто — `settings.slideDuration`) |
| `accent`, `bgGradient`, `bg` | Акцентный цвет слайда; фоновый градиент (`null` — как в общих); `bg: { color1, color2, speed, intensity }` — свои цвета и скорость градиента (пустые поля — как в `settings.bg`) |
| `schedule` | `{ days: [1..7], from, to, dateFrom, dateTo }` — когда показывать. `from`/`to` — `HH:MM`; пустые — все сутки; `from > to` — через полночь |
| `nearest` | `{ enabled, count }` — блок «Скоро у нас» |
| `animation` | `null` (как в общих) или объект анимации (см. справочник) |
| `elements` | `{ [ключ]: { visible, effect, duration, delay, x, y, size } }` — настройки элементов |
| `photoPos` | `[{ x, y, scale, rotate, flip }]` — положение тарелок по слотам |
| `sizes` | `{ title, dish, text }` — масштабы текста (`null` — общий) |
| `colors` | `{ [роль]: id палитры или #hex }` — цвета надписей слайда |

Поля по типам:

| Тип | Поля |
|---|---|
| `dishes` | `layout`, `photoDishes: [id]`, `textDishes: [id]` |
| `events` | `range` (`week`/`2weeks`), `start` (`today`/`monday`), `max` (1–7), `style`, `show: { photo, description, price, tag }`, `emptyText` |
| `info` | `lines: [{ label, value }]` |
| `announce` | `variant` (`center`/`photo-top`/`photo-bg`), `text`, `note`, `photo` |
| `countdown` | `eventMode` (`today`/`next`/`event`), `eventId`, `label`, `startedText`, `photo` |

Ключи элементов (`elements`): `head`, `feat-N`, `plate-N`, `txt-N`, `list`, `events`, `info`,
`body`, `photo`, `evname`, `evtime`, `timer`, `near`. Список для конкретного слайда возвращает
`TorsherModel.slideElements(slide)`.

### Дисплей

Физический экран витрины. Слайды остаются общими для всех дисплеев — у дисплея имя,
ориентация, разрешение, своя программа (набор и порядок слайдов), а также свои настройки
оформления, шапка и бегущая строка.

| Поле | Значение |
|---|---|
| `id` | Идентификатор (открывается как `index.html?display=<id>`) |
| `name` | Название в админке («Зал», «Витрина у входа»…) |
| `orientation` | `vertical` (логический холст 1080×1920) или `horizontal` (1920×1080) |
| `resolution` | `1920` (2K, значение по умолчанию) или `3840` (4K) — размер по длинной стороне |
| `slides` | Массив `id` слайдов в порядке показа. Пустой — все слайды, как без дисплея |
| `slideEnabled` | Объект `{id слайда: true/false}` — своё вкл/выкл на этом дисплее. Нет ключа — действует общий `slides[].enabled` |
| `settings` | Свои настройки оформления и работы экрана (все поля `data.settings`). `null` — наследовать общие |
| `cafe` | Свои `name`, `tagline`, `logo` для шапки. `null` — общий `data.cafe` |
| `ticker` | Свои строки бегущей строки. `null` — общий `data.ticker`; пустой массив — выключить строки у дисплея |

Плеер без `?display=` показывает все включённые слайды вертикально — это прежнее поведение,
старые экраны менять не нужно. Разрешение задаёт физический размер холста: для вертикали 2K/4K это
1080×1920 / 2160×3840, для горизонтали — 1920×1080 / 3840×2160. Все элементы масштабируются
пропорционально; горизонтальная раскладка строится из тех же слайдов и данных (см. `04-layouts-and-animation.md`).

В админке выбранный в «Экранах» дисплей задаёт, какой программой (`slides`) управляет список:
добавление, порядок и удаление из набора относятся только к нему, содержимое самих слайдов общее.
Пустой `slides` означает «все слайды»; при первом изменении набора админка записывает его явно.

В «Анимации и оформлении» выбранный дисплей задаёт объекты `settings`, `cafe` и `ticker`: изменения
сохраняются только в нём. Плеер берёт `defaultSettings()` → `data.settings` → `display.settings`,
а шапку и бегущую строку — из `display.cafe` / `display.ticker`, если они заданы. Поэтому старые
данные без этих полей работают как раньше, а новые поля общих настроек автоматически попадают
в дисплеи, у которых своего значения ещё нет.

Видимость слайда (`slideEnabled`) устроена так же: общий `slides[].enabled` — значение по умолчанию,
а ключ в `display.slideEnabled` переопределяет его только для этого дисплея. Поэтому один и тот же
слайд можно выключить на одном экране и оставить на другом.

## Хранилище

Сервер хранит данные в одном из двух режимов (`api/storage.php`):

- **db** — таблицы MySQL (ниже);
- **files** — JSON в папке `data/`: `site.json` (весь документ, как `data.json`, плюс `revision`, `updatedAt`),
  `users.json` (`id`, `login`, `password_hash`), `options.json` (например, `deploy_ftp`), `media.json`
  (реестр загруженных фото), `storage.json` (`{"mode": "db"|"files"}`). Запись атомарная
  (временный файл + `rename`, `flock`).

Переключение (`POST api/store.php`) переносит всё содержимое и не удаляет старое хранилище.
Номер ревизии при переносе только растёт.

## Таблицы MySQL (`sql/schema.mysql.sql`)

| Таблица | Содержимое |
|---|---|
| `users` | Администраторы: `login`, `password_hash` (bcrypt через `password_hash`) |
| `site` | Одна строка: `cafe`, `settings`, `ticker`, `displays` (JSON), `version` (ревизия), `updated_at` |
| `dishes` | Блюда: колонки по полям, `position` задаёт порядок; поля без своей колонки (`accent`, `isNew`…) — в JSON `extra` |
| `events` | Мероприятия: `event_date`, `time_start`, `time_end` и т. д.; прочие поля — в `extra` |
| `slides` | `id`, `position`, `type`, `enabled`, `config` (JSON со всеми остальными полями слайда) |
| `media` | Загруженные фото: путь, тип, размеры, признак прозрачности |
| `options` | Настройки сервера, например `deploy_ftp` (пароль зашифрован libsodium ключом `app_key`) |

Публикация (`PUT api/data.php`) заменяет блюда, мероприятия и слайды целиком в одной транзакции
и увеличивает `site.version`.

## API

| Запрос | Доступ | Ответ |
|---|---|---|
| `GET api/data.php` | публично | Весь документ (как `data.json`, плюс `revision`, `updatedAt`) |
| `GET api/data.php?revision=1` | публично | `{ revision }` |
| `PUT api/data.php` | вход + `X-CSRF-Token` | `{ ok, revision }` |
| `POST api/update.php` | вход + `X-CSRF-Token` | `{ ok, revision }` — записывает `content/data.json` в хранилище |
| `GET api/auth.php` | — | `{ user, csrf }` или 401 с `{ csrf }` |
| `POST api/auth.php` `{action:"login", login, password}` | — | `{ user, csrf }` |
| `POST api/auth.php` `{action:"logout"}` / `{action:"password", current, next}` | вход + CSRF | `{ ok }` |
| `POST api/upload.php` (multipart `file`, `hasAlpha`) | вход + CSRF | `{ path, width, height, hasAlpha }` |
| `GET api/store.php` | вход | `{ mode, db: {ok, error}, files: {ok, error, dir}, revision }` |
| `POST api/store.php` `{action:"switch", mode}` | вход + CSRF | Перенос данных: `{ from, to, dishes, events, slides, users }` |
| `GET api/deploy.php` | вход | Настройки FTP (без пароля) |
| `POST api/deploy.php` `{action:"save" / "test" / "upload"}` | вход + CSRF | Результат и журнал |

Ошибки приходят с HTTP-кодом и телом `{ "error": "текст" }`.
