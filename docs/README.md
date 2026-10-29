# Документация витрины «Торшер»

Инструкции по установке, настройке, публикации, разработке и передаче проекта.

| Документ | О чём |
|---|---|
| [01-overview.md](01-overview.md) | Архитектура и структура репозитория |
| [02-install-server.md](02-install-server.md) | Установка на PHP-хостинг, хранилище, обновление |
| [03-admin-guide.md](03-admin-guide.md) | Панель управления для сотрудников |
| [04-layouts-and-animation.md](04-layouts-and-animation.md) | Раскладки, эффекты, шрифты и настройки |
| [05-data-model.md](05-data-model.md) | `content/data.json`, таблицы MySQL и API |
| [06-publishing.md](06-publishing.md) | Сервер, FTP, ZIP, GitHub Pages и rsync |
| [07-development.md](07-development.md) | Локальный запуск, проверки и расширение проекта |
| [08-handover.md](08-handover.md) | Передача проекта другому владельцу или команде |
| [09-changelog.md](09-changelog.md) | Последние изменения и принятые решения |
| [SERVER.md](SERVER.md) | Памятка, которая попадает в статическую сборку |
| [nginx.conf.example](nginx.conf.example) | Пример конфигурации nginx |

Таблицы в `04-layouts-and-animation.md` генерируются из `shared/model.js` командой
`node tools/docs.mjs`; вручную их не редактируйте.
