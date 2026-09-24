# 6. Публикация

| Способ | Когда подходит | Как |
|---|---|---|
| **Сервер PHP + MySQL** | Постоянная работа, правки с любого компьютера | Админка → «Опубликовать на экраны». Экраны читают `api/data.php` |
| **FTP / FTPS** | Экран крутится на другом хостинге без PHP | Админка (серверный режим) → Публикация → «Выгрузка на удалённый сервер (FTP)» |
| **ZIP** | Разовая выгрузка, флешка, любой хостинг | Админка → Публикация → «Скачать сборку .zip» |
| **GitHub Pages** | Бесплатный хостинг статики | Пуш в `main` → workflow `pages.yml` |
| **rsync / SSH** | Свой сервер, автоматическая выкладка из Git | Workflow `deploy-server.yml` или `tools/deploy.sh` |
| **Сайт целиком на хостинг по FTP** | Хостинг PHP + MySQL (display.torsher-cafe.ru), выкладка из Git | Workflow `deploy-ftp.yml` |

## FTP

- Настройки хранятся на сервере в таблице `options`. Пароль шифруется ключом `app_key` из
  `api/config.php` и в браузер не возвращается.
- Сборка: файлы плеера из `build-files.json`, фото, на которые ссылаются данные,
  `content/data.json` и `content/data.js` из MySQL, `build.json` с версией.
- Файлы, размер которых не изменился, пропускаются. Данные и `build.json` выгружаются последними,
  поэтому экран не увидит новую версию раньше файлов.
- Выгружаются **опубликованные** данные, а не черновик.

## Сайт целиком на хостинг по FTP (`deploy-ftp.yml`)

Выкладывает **весь сайт** (экран, админку, `api/`, `sql/`) на обычный хостинг PHP + MySQL и сам
его устанавливает. Работает на серверах GitHub, поэтому пароли нигде в репозитории не хранятся.

1. Settings → Secrets and variables → Actions → **Secrets**:
   `FTP_USER`, `FTP_PASSWORD`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (если не задан — как `DB_USER`),
   `ADMIN_LOGIN`, `ADMIN_PASSWORD` (администратор админки для первой установки), по желанию `APP_KEY`.
2. **Variables** (по желанию): `FTP_HOST` (по умолчанию `display.torsher-cafe.ru`), `FTP_DIR` (`/`) —
   папка сайта на FTP, `SITE_URL` (`https://display.torsher-cafe.ru`), `DB_HOST` (`localhost`),
   `FTP_SSL_VERIFY` (`no`, если у FTP сертификат на другое имя).
3. Actions → «Витрина → хостинг по FTP» → **Run workflow**. Дальше выкладка идёт при каждом push в `main`.

Что делает workflow:
- собирает `node tools/build.mjs --server`;
- создаёт `api/config.php` из секретов (`tools/ftp-config.php`);
- заливает файлы через `lftp mirror` (`tools/ftp-upload.sh`): только новые и изменённые, `uploads/` с фото не трогает;
- вызывает `api/install.php`: если сайт не установлен — создаёт таблицы, администратора и загружает
  стартовые данные; если установлен — ничего не меняет;
- заливает `config.php` с `install_enabled => false` и проверяет, что `api/data.php` отвечает.

Хранение — в MySQL. В логе шага выгрузки виден список файлов в `FTP_DIR`: по нему можно проверить,
что это корень сайта. Если `APP_KEY` не задан, ключ выводится из `DB_PASSWORD`. После смены пароля
базы пароль FTP в админке (раздел «Выгрузка на удалённый сервер») нужно ввести заново.

## GitHub Pages

1. Settings → Pages → Source: **GitHub Actions**.
2. Каждый пуш в `main` запускает `pages.yml`: `node tools/build.mjs --with-admin` и публикацию `dist/`.
3. Адрес: `https://<владелец>.github.io/<репозиторий>/`, админка — `/admin/` (в локальном режиме).
4. Кнопка «Опубликовать в Git» в админке коммитит `content/data.json` и фото. Нужен токен GitHub
   с правом *Contents: Read and write* на этот репозиторий.

## rsync / SSH

- Секреты репозитория: `DEPLOY_TARGET` (`user@host:/var/www/display`), `DEPLOY_SSH_KEY`
  (приватный ключ), при желании `DEPLOY_KNOWN_HOSTS`. Без них workflow пропускает выгрузку.
- Вручную: `DEPLOY_TARGET=user@host:/путь tools/deploy.sh` (`WITH_ADMIN=1` — вместе с админкой).

## Кеш браузера

При сборке (`tools/build.mjs`) ко всем локальным `.js` и `.css` в `index.html` и `admin/index.html`,
а также к адресу предпросмотра в админке добавляется параметр версии `?v=<коммит>`. После каждой
публикации браузер гарантированно загружает новые файлы и не смешивает их со старыми из кеша.
Если вы открываете проект без сборки (прямо из репозитория), параметров нет: обновляйте страницу
через Ctrl+F5.

## Сборка из консоли

```bash
node tools/build.mjs              # только экран → dist/
node tools/build.mjs --with-admin # экран + админка (для GitHub Pages)
node tools/build.mjs --server     # полный сайт для PHP-хостинга (без config.php)
node tools/build.mjs --manifest   # только обновить build-files.json
```
