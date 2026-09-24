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
  "slides": [ /* см. ниже */ ]
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
| `schedule` | `{ days: [1..7], from, to, dateFrom, dateTo }` — когда показывать |
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

## Таблицы MySQL (`sql/schema.mysql.sql`)

| Таблица | Содержимое |
|---|---|
| `users` | Администраторы: `login`, `password_hash` (bcrypt через `password_hash`) |
| `site` | Одна строка: `cafe`, `settings`, `ticker` (JSON), `version` (ревизия), `updated_at` |
| `dishes` | Блюда: колонки по полям, `position` задаёт порядок |
| `events` | Мероприятия: `event_date`, `time_start`, `time_end` и т. д. |
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
| `GET api/auth.php` | — | `{ user, csrf }` или 401 с `{ csrf }` |
| `POST api/auth.php` `{action:"login", login, password}` | — | `{ user, csrf }` |
| `POST api/auth.php` `{action:"logout"}` / `{action:"password", current, next}` | вход + CSRF | `{ ok }` |
| `POST api/upload.php` (multipart `file`, `hasAlpha`) | вход + CSRF | `{ path, width, height, hasAlpha }` |
| `GET api/deploy.php` | вход | Настройки FTP (без пароля) |
| `POST api/deploy.php` `{action:"save" / "test" / "upload"}` | вход + CSRF | Результат и журнал |

Ошибки приходят с HTTP-кодом и телом `{ "error": "текст" }`.
